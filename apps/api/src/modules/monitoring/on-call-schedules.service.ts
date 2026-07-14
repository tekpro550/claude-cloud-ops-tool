import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import {
  CreateOnCallScheduleDto,
  UpdateOnCallScheduleDto,
} from './on-call-schedules.dto';

@Injectable()
export class OnCallSchedulesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`SELECT * FROM on_call_schedules ORDER BY name`),
    );
  }

  /** The agent on call right now, if any -- entries are just a flat list, so this checks each against the current time. */
  async currentOnCall(
    tenantId: string,
    id: string,
  ): Promise<{ agentId: string } | null> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [schedule] = await queryRunner.query(
        `SELECT entries FROM on_call_schedules WHERE id = $1`,
        [id],
      );
      if (!schedule) {
        throw new NotFoundException(`On-call schedule ${id} not found`);
      }
      const now = Date.now();
      const active = (
        schedule.entries as {
          agentId: string;
          startsAt: string;
          endsAt: string;
        }[]
      ).find(
        (entry) =>
          new Date(entry.startsAt).getTime() <= now &&
          now < new Date(entry.endsAt).getTime(),
      );
      return active ? { agentId: active.agentId } : null;
    });
  }

  create(tenantId: string, dto: CreateOnCallScheduleDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [schedule] = await queryRunner.query(
        `INSERT INTO on_call_schedules (tenant_id, name, entries) VALUES ($1, $2, $3) RETURNING *`,
        [tenantId, dto.name, JSON.stringify(dto.entries)],
      );
      return schedule;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateOnCallScheduleDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM on_call_schedules WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`On-call schedule ${id} not found`);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (dto.name !== undefined) assign('name', dto.name);
      if (dto.entries !== undefined)
        assign('entries', JSON.stringify(dto.entries));

      if (sets.length === 0) {
        const [schedule] = await queryRunner.query(
          `SELECT * FROM on_call_schedules WHERE id = $1`,
          [id],
        );
        return schedule;
      }

      sets.push(`updated_at = now()`);
      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE on_call_schedules SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM on_call_schedules WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`On-call schedule ${id} not found`);
      }
    });
  }
}
