import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { AlertEvaluationService } from './alert-evaluation.service';
import { evaluateCloudMetrics } from './checks/cloud-metric-check';
import { credentialsEncryptionKey } from './credentials-crypto';
import {
  CLOUD_PROVIDER_CLIENT_FACTORY,
  CloudProviderClientFactory,
  CloudResourceRef,
} from './cloud/cloud-provider-client';

interface CloudCredentialRow {
  id: string;
  provider: 'aws' | 'azure';
  config: Record<string, unknown>;
}

interface CloudMetricMonitorRow {
  id: string;
  name: string;
  resource_id: string;
  config: Record<string, unknown>;
  consecutive_failures_to_alert: number;
}

/**
 * Internal/pull-based only (see section 4 of the Sprint 4 scope) -- there is
 * no public endpoint for this, unlike the agent's push-based
 * /agent/heartbeat and /agent/report. Runs on its own, coarser timer (cloud
 * APIs are rate-limited and comparatively slow; polling every 15s the way
 * MonitorSchedulerService does for http/ping/etc would be wasteful and
 * risks throttling).
 *
 * Each pass: list every enabled cloud_credentials row per tenant, ask its
 * provider client for the current resource inventory, upsert each into
 * `resources` keyed by external_ref (populating it with the real provider
 * ID for the first time -- see section 2 of the scope doc), then for any
 * resource that also has an enabled 'cloud_metric' monitor, pull metrics
 * and run them through the same monitor_checks + AlertEvaluationService
 * path every other monitor type uses.
 */
@Injectable()
export class CloudResourcePollerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CloudResourcePollerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly alertEvaluation: AlertEvaluationService,
    @Inject(CLOUD_PROVIDER_CLIENT_FACTORY)
    private readonly clientFactory: CloudProviderClientFactory,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.get<number>(
      'CLOUD_POLLER_INTERVAL_MS',
      300000,
    );
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async pollOnce(): Promise<number> {
    if (this.running) {
      this.logger.warn('cloud poll already in progress, skipping this tick');
      return 0;
    }
    this.running = true;
    try {
      const tenants = await this.dataSource.query(`SELECT id FROM tenants`);
      let checkedCount = 0;
      for (const tenant of tenants) {
        checkedCount += await this.pollTenant(tenant.id);
      }
      return checkedCount;
    } finally {
      this.running = false;
    }
  }

  private async pollTenant(tenantId: string): Promise<number> {
    const key = credentialsEncryptionKey(this.config);
    const credentials: CloudCredentialRow[] = await withTenantContext(
      this.dataSource,
      tenantId,
      (queryRunner) =>
        queryRunner.query(
          `SELECT id, provider, pgp_sym_decrypt(config_encrypted, $1)::jsonb AS config
           FROM cloud_credentials WHERE is_enabled = true`,
          [key],
        ),
    );

    let checkedCount = 0;
    for (const credential of credentials) {
      try {
        checkedCount += await this.pollCredential(tenantId, credential);
      } catch (err) {
        this.logger.error(
          `polling cloud_credentials ${credential.id} (${credential.provider}) failed: ${(err as Error).message}`,
        );
      }
    }
    return checkedCount;
  }

  private async pollCredential(
    tenantId: string,
    credential: CloudCredentialRow,
  ): Promise<number> {
    const client = this.clientFactory(credential.provider, credential.config);
    const remoteResources = await client.listResources();

    const resourceIdByExternalId = new Map<string, string>();
    for (const remote of remoteResources) {
      resourceIdByExternalId.set(
        remote.externalId,
        await this.upsertResource(tenantId, remote, credential.id),
      );
    }

    await withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `UPDATE cloud_credentials SET last_polled_at = now() WHERE id = $1`,
        [credential.id],
      ),
    );

    let checkedCount = 0;
    for (const [externalId, resourceId] of resourceIdByExternalId) {
      const monitor = await this.findCloudMetricMonitor(tenantId, resourceId);
      if (!monitor) continue;

      const samples = await client.getMetrics(externalId);
      const result = evaluateCloudMetrics(monitor.config ?? {}, samples);

      await withTenantContext(this.dataSource, tenantId, (queryRunner) =>
        queryRunner.query(
          `INSERT INTO monitor_checks (tenant_id, monitor_id, status, response_time_ms, raw_output)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            tenantId,
            monitor.id,
            result.status,
            result.responseTimeMs,
            JSON.stringify(result.rawOutput),
          ],
        ),
      );

      await this.alertEvaluation.evaluate(
        tenantId,
        {
          id: monitor.id,
          name: monitor.name,
          resourceId: monitor.resource_id,
          consecutiveFailuresToAlert: monitor.consecutive_failures_to_alert,
        },
        result,
      );
      checkedCount++;
    }
    return checkedCount;
  }

  private async findCloudMetricMonitor(
    tenantId: string,
    resourceId: string,
  ): Promise<CloudMetricMonitorRow | null> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [row] = await queryRunner.query(
        `SELECT id, name, resource_id, config, consecutive_failures_to_alert
         FROM monitors
         WHERE resource_id = $1 AND monitor_type = 'cloud_metric' AND is_enabled = true
         LIMIT 1`,
        [resourceId],
      );
      return row ?? null;
    });
  }

  private async upsertResource(
    tenantId: string,
    remote: CloudResourceRef,
    cloudCredentialId: string,
  ): Promise<string> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const externalRef = JSON.stringify({
        externalId: remote.externalId,
        provider: remote.provider,
        region: remote.region,
      });

      const [existing] = await queryRunner.query(
        `SELECT id FROM resources WHERE external_ref->>'externalId' = $1 AND external_ref->>'provider' = $2`,
        [remote.externalId, remote.provider],
      );
      if (existing) {
        await queryRunner.query(
          `UPDATE resources SET name = $2, external_ref = $3, cloud_credential_id = $4, updated_at = now() WHERE id = $1`,
          [existing.id, remote.name, externalRef, cloudCredentialId],
        );
        return existing.id;
      }

      const [created] = await queryRunner.query(
        `INSERT INTO resources (tenant_id, name, resource_type, external_ref, cloud_credential_id) VALUES ($1, $2, 'server', $3, $4) RETURNING id`,
        [tenantId, remote.name, externalRef, cloudCredentialId],
      );
      return created.id;
    });
  }
}
