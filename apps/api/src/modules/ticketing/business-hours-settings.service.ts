import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UpdateBusinessHoursDto } from './business-hours-settings.dto';

const COLUMNS =
  'business_hours_start_minute AS "startMinute", business_hours_end_minute AS "endMinute", business_hours_days AS days, business_hours_timezone AS timezone';

/**
 * Reads/writes the tenant's business-hours window (columns on `tenants`,
 * same home as the cost settings). Consumed by SLA due-date calculation for
 * business_hours_only policies. Not tenant-RLS-scoped because `tenants`
 * itself carries no RLS policy -- it's what current_tenant means.
 */
@Injectable()
export class BusinessHoursSettingsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async get(tenantId: string) {
    const [row] = await this.dataSource.query(
      `SELECT ${COLUMNS} FROM tenants WHERE id = $1`,
      [tenantId],
    );
    if (!row) throw new NotFoundException(`Tenant ${tenantId} not found`);
    return row;
  }

  async update(tenantId: string, dto: UpdateBusinessHoursDto) {
    const sets: string[] = [];
    const params: unknown[] = [];
    const assign = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if (dto.startMinute !== undefined)
      assign('business_hours_start_minute', dto.startMinute);
    if (dto.endMinute !== undefined)
      assign('business_hours_end_minute', dto.endMinute);
    if (dto.days !== undefined) assign('business_hours_days', dto.days);
    if (dto.timezone !== undefined) {
      if (!isValidTimezone(dto.timezone)) {
        throw new BadRequestException(`Unknown timezone: ${dto.timezone}`);
      }
      assign('business_hours_timezone', dto.timezone);
    }

    if (sets.length === 0) return this.get(tenantId);

    params.push(tenantId);
    const [rows] = await this.dataSource.query(
      `UPDATE tenants SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
      params,
    );
    if (!rows || rows.length === 0) {
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }
    return rows[0];
  }
}

/** Rejects a bogus IANA zone before it can poison every future SLA calc. */
function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
