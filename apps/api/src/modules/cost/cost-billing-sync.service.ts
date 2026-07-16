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
import {
  CLOUD_PROVIDER_CLIENT_FACTORY,
  CloudProviderClientFactory,
} from '../monitoring/cloud/cloud-provider-client';
import { credentialsEncryptionKey } from '../monitoring/credentials-crypto';
import { CostPaceCheckService } from './cost-pace-check.service';

interface CloudCredentialRow {
  id: string;
  provider: 'aws' | 'azure';
  config: Record<string, unknown>;
}

// Enough trailing months to cover the MSP dashboard's "previous month" +
// "current MTD" + "6-7 month trend" needs (Sprint 3) in one pull per
// credential per run, rather than a narrower window that would need
// widening again once that sprint starts.
const TRAILING_MONTHS = 7;

/**
 * Internal/pull-based only, same shape as Module 2's
 * CloudResourcePollerService (see docs/Cloud-Ops-Tool-Module3-Cost-FinOps-Scope.md
 * section 4) -- there is no public endpoint for this. Runs on its own daily
 * timer, coarser even than the resource poller's, since billing APIs settle
 * on a daily cadence anyway and finer polling would just re-fetch the same
 * not-yet-finalized numbers.
 *
 * Each pass: for every enabled cloud_credentials row, ask its provider
 * client for cost line items over a trailing window and upsert them into
 * cost_line_items. Idempotent by construction -- see the migration's unique
 * index -- so a rerun (or a provider revising an earlier day's estimated
 * cost) always converges to the latest numbers rather than duplicating
 * rows.
 */
@Injectable()
export class CostBillingSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CostBillingSyncService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(CLOUD_PROVIDER_CLIENT_FACTORY)
    private readonly clientFactory: CloudProviderClientFactory,
    private readonly config: ConfigService,
    private readonly paceCheck: CostPaceCheckService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.get<number>(
      'COST_BILLING_SYNC_INTERVAL_MS',
      86400000,
    );
    this.timer = setInterval(() => {
      void this.syncOnce();
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async syncOnce(): Promise<number> {
    if (this.running) {
      this.logger.warn(
        'cost billing sync already in progress, skipping this tick',
      );
      return 0;
    }
    this.running = true;
    try {
      const tenants = await this.dataSource.query(`SELECT id FROM tenants`);
      let syncedCount = 0;
      for (const tenant of tenants) {
        syncedCount += await this.syncTenant(tenant.id);
      }
      return syncedCount;
    } finally {
      this.running = false;
    }
  }

  private async syncTenant(tenantId: string): Promise<number> {
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

    let syncedCount = 0;
    for (const credential of credentials) {
      try {
        syncedCount += await this.syncCredential(tenantId, credential);
      } catch (err) {
        this.logger.error(
          `billing sync for cloud_credentials ${credential.id} (${credential.provider}) failed: ${(err as Error).message}`,
        );
      }
    }

    try {
      await this.paceCheck.checkTenant(tenantId);
    } catch (err) {
      this.logger.error(
        `pace check for tenant ${tenantId} failed: ${(err as Error).message}`,
      );
    }

    return syncedCount;
  }

  private async syncCredential(
    tenantId: string,
    credential: CloudCredentialRow,
  ): Promise<number> {
    const client = this.clientFactory(credential.provider, credential.config);
    const { startDate, endDate } = this.syncWindow();
    const lineItems = await client.getCostAndUsage(startDate, endDate);

    await withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      for (const item of lineItems) {
        await queryRunner.query(
          `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, region, usage_date, amount, currency, raw, synced_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
           ON CONFLICT (cloud_credential_id, service, COALESCE(region, ''), usage_date)
           DO UPDATE SET amount = EXCLUDED.amount, currency = EXCLUDED.currency, raw = EXCLUDED.raw, synced_at = now()`,
          [
            tenantId,
            credential.id,
            item.service,
            item.region ?? null,
            item.usageDate,
            item.amount,
            item.currency,
            JSON.stringify(item.raw),
          ],
        );
      }
      // Same column Module 2's resource poller stamps -- a broken
      // credential shows up as stale to both, one config-error signal, not
      // two (scope doc section 5).
      await queryRunner.query(
        `UPDATE cloud_credentials SET last_polled_at = now() WHERE id = $1`,
        [credential.id],
      );
    });

    return lineItems.length;
  }

  private syncWindow(): { startDate: string; endDate: string } {
    const now = new Date();
    const start = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth() - (TRAILING_MONTHS - 1),
        1,
      ),
    );
    // Tomorrow, exclusive -- matches GetCostAndUsage's own end-exclusive
    // TimePeriod semantics, so "today" is always included.
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return { startDate: fmt(start), endDate: fmt(end) };
  }
}
