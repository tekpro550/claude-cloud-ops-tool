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
import { withTenantContext } from '../../../database/context/tenant-context';
import { credentialsEncryptionKey } from '../credentials-crypto';
import { SNMP_CLIENT, SnmpClient, SnmpInterfaceReading } from './snmp-client';

interface NetworkDeviceRow {
  id: string;
  name: string;
  host: string;
  snmp_version: '1' | '2c' | '3';
  port: number;
  community: string;
}

/**
 * Mirrors CloudResourcePollerService's shape (own coarser timer, per-tenant
 * transaction, an exposed pollOnce for deterministic tests) but doesn't
 * route through monitors/monitor_checks/AlertEvaluationService the way
 * cloud_metric or synthetic monitors do -- an interface isn't a "resource"
 * a tenant explicitly provisions a monitor for, it's auto-discovered by
 * walking the device's ifTable. Instead, a device-down transition opens a
 * ticket directly via the internal contract, the same simpler pattern
 * LogAlertSweepService uses for a log-alert breach, rather than requiring
 * every discovered interface to get its own monitors row.
 */
@Injectable()
export class NetworkPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NetworkPollerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(SNMP_CLIENT) private readonly snmpClient: SnmpClient,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const intervalMs = this.config.get<number>(
      'NETWORK_POLLER_INTERVAL_MS',
      120000,
    );
    this.timer = setInterval(() => {
      void this.pollOnce().catch((err) =>
        this.logger.error(`pollOnce tick failed: ${(err as Error).message}`),
      );
    }, intervalMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async pollOnce(): Promise<number> {
    if (this.running) {
      this.logger.warn('network poll already in progress, skipping this tick');
      return 0;
    }
    this.running = true;
    try {
      const tenants = await this.dataSource.query(`SELECT id FROM tenants`);
      let polledCount = 0;
      for (const tenant of tenants) {
        try {
          polledCount += await this.pollTenant(tenant.id);
        } catch (err) {
          this.logger.error(
            `tenant ${tenant.id} sweep failed: ${(err as Error).message}`,
          );
        }
      }
      return polledCount;
    } finally {
      this.running = false;
    }
  }

  private async pollTenant(tenantId: string): Promise<number> {
    const key = credentialsEncryptionKey(this.config);
    const devices: NetworkDeviceRow[] = await withTenantContext(
      this.dataSource,
      tenantId,
      (queryRunner) =>
        queryRunner.query(
          `SELECT id, name, host, snmp_version, port, pgp_sym_decrypt(community_encrypted, $1) AS community
           FROM network_devices WHERE is_active = true`,
          [key],
        ),
    );

    let polledCount = 0;
    for (const device of devices) {
      try {
        polledCount += await this.pollDevice(tenantId, device);
      } catch (err) {
        this.logger.error(
          `polling network device ${device.id} (${device.host}) failed: ${(err as Error).message}`,
        );
      }
    }
    return polledCount;
  }

  private async pollDevice(
    tenantId: string,
    device: NetworkDeviceRow,
  ): Promise<number> {
    const readings = await this.snmpClient.walkInterfaces({
      host: device.host,
      port: device.port,
      community: device.community,
      version: device.snmp_version,
    });

    for (const reading of readings) {
      await this.recordReading(tenantId, device, reading);
    }

    await withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `UPDATE network_devices SET last_polled_at = now() WHERE id = $1`,
        [device.id],
      ),
    );
    return readings.length;
  }

  private async recordReading(
    tenantId: string,
    device: NetworkDeviceRow,
    reading: SnmpInterfaceReading,
  ): Promise<void> {
    // The previous sample must be read *before* the new one is inserted --
    // it's what tells an "up" -> "down" transition apart from an interface
    // that was already down (which shouldn't re-open a ticket every tick).
    const previousStatus = await withTenantContext(
      this.dataSource,
      tenantId,
      async (queryRunner) => {
        const [row] = await queryRunner.query(
          `SELECT oper_status FROM network_interface_samples
           WHERE network_device_id = $1 AND if_index = $2
           ORDER BY ts DESC LIMIT 1`,
          [device.id, reading.ifIndex],
        );
        return row?.oper_status as string | undefined;
      },
    );

    await withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `INSERT INTO network_interface_samples
           (tenant_id, network_device_id, if_index, if_name, oper_status, in_octets, out_octets)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          tenantId,
          device.id,
          reading.ifIndex,
          reading.ifName,
          reading.operStatus,
          reading.inOctets,
          reading.outOctets,
        ],
      ),
    );

    if (previousStatus === 'up' && reading.operStatus === 'down') {
      await this.openInterfaceDownTicket(tenantId, device, reading);
    }
  }

  private async openInterfaceDownTicket(
    tenantId: string,
    device: NetworkDeviceRow,
    reading: SnmpInterfaceReading,
  ): Promise<void> {
    try {
      await this.callInternalApi('/internal/tickets/from_alert', {
        tenantId,
        subject: `[Network] ${device.name}: interface ${reading.ifName} is down`,
        description: `Interface ${reading.ifName} (ifIndex ${reading.ifIndex}) on ${device.name} (${device.host}) transitioned from up to down.`,
        priority: 'high',
      });
    } catch (err) {
      this.logger.error(
        `failed to open ticket for ${device.id} interface ${reading.ifIndex}: ${(err as Error).message}`,
      );
    }
  }

  private async callInternalApi(
    path: string,
    body: Record<string, unknown>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const baseUrl = this.config.get<string>(
      'INTERNAL_API_BASE_URL',
      'http://localhost:3000/api/v1',
    );
    const apiKey = this.config.get<string>(
      'INTERNAL_API_KEY',
      'dev-internal-api-key',
    );

    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Api-Key': apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(
        `internal API ${path} returned ${response.status}: ${await response.text()}`,
      );
    }
    return response.json();
  }
}
