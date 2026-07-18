import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { credentialsEncryptionKey } from '../credentials-crypto';
import {
  CreateNetworkDeviceDto,
  UpdateNetworkDeviceDto,
} from './network-devices.dto';

// community_encrypted is never selected -- same "never returned by the API"
// contract as cloud_credentials.config_encrypted.
const SAFE_COLUMNS =
  'id, name, host, snmp_version, port, is_active, last_polled_at, created_at';

@Injectable()
export class NetworkDevicesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT ${SAFE_COLUMNS} FROM network_devices ORDER BY created_at`,
      ),
    );
  }

  create(tenantId: string, dto: CreateNetworkDeviceDto) {
    const key = credentialsEncryptionKey(this.config);
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [row] = await queryRunner.query(
        `INSERT INTO network_devices (tenant_id, name, host, snmp_version, community_encrypted, port)
         VALUES ($1, $2, $3, $4, pgp_sym_encrypt($5, $6), $7)
         RETURNING ${SAFE_COLUMNS}`,
        [
          tenantId,
          dto.name,
          dto.host,
          dto.snmpVersion ?? '2c',
          dto.community,
          key,
          dto.port ?? 161,
        ],
      );
      return row;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateNetworkDeviceDto) {
    const key = credentialsEncryptionKey(this.config);
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM network_devices WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Network device ${id} not found`);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.name !== undefined) assign('name', dto.name);
      if (dto.host !== undefined) assign('host', dto.host);
      if (dto.port !== undefined) assign('port', dto.port);
      if (dto.isActive !== undefined) assign('is_active', dto.isActive);
      if (dto.community !== undefined) {
        // Same two-param encrypt-in-place pattern as
        // CloudCredentialsService.update: the community string goes in as
        // $n, the key as $n+1, wrapped in pgp_sym_encrypt.
        params.push(dto.community);
        const communityParam = params.length;
        params.push(key);
        const keyParam = params.length;
        sets.push(
          `community_encrypted = pgp_sym_encrypt($${communityParam}, $${keyParam})`,
        );
      }

      if (sets.length === 0) {
        const [row] = await queryRunner.query(
          `SELECT ${SAFE_COLUMNS} FROM network_devices WHERE id = $1`,
          [id],
        );
        return row;
      }

      sets.push(`updated_at = now()`);
      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE network_devices SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${SAFE_COLUMNS}`,
        params,
      );
      return rows[0];
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM network_devices WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Network device ${id} not found`);
      }
    });
  }

  /** Latest sample per interface for the device, for the dashboard table. */
  latestSamples(tenantId: string, deviceId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT DISTINCT ON (if_index) *
         FROM network_interface_samples
         WHERE network_device_id = $1
         ORDER BY if_index, ts DESC`,
        [deviceId],
      ),
    );
  }

  /** Recent samples for one interface, oldest first -- a throughput sparkline's data source. */
  interfaceHistory(
    tenantId: string,
    deviceId: string,
    ifIndex: number,
    limit = 30,
  ) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const rows = await queryRunner.query(
        `SELECT * FROM network_interface_samples
         WHERE network_device_id = $1 AND if_index = $2
         ORDER BY ts DESC LIMIT $3`,
        [deviceId, ifIndex, limit],
      );
      return rows.reverse();
    });
  }
}
