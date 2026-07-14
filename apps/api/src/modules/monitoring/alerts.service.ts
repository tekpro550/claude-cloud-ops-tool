import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';

const ALERT_STATUSES = ['open', 'acknowledged', 'resolved'] as const;

@Injectable()
export class AlertsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  list(tenantId: string, status?: string) {
    if (
      status &&
      !ALERT_STATUSES.includes(status as (typeof ALERT_STATUSES)[number])
    ) {
      throw new BadRequestException(
        `status must be one of ${ALERT_STATUSES.join(', ')}`,
      );
    }
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      status
        ? queryRunner.query(
            `SELECT * FROM alerts WHERE status = $1 ORDER BY opened_at DESC`,
            [status],
          )
        : queryRunner.query(`SELECT * FROM alerts ORDER BY opened_at DESC`),
    );
  }

  async get(tenantId: string, id: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [alert] = await queryRunner.query(
        `SELECT * FROM alerts WHERE id = $1`,
        [id],
      );
      if (!alert) {
        throw new NotFoundException(`Alert ${id} not found`);
      }
      return alert;
    });
  }

  async acknowledge(tenantId: string, id: string) {
    return this.transition(tenantId, id, {
      status: 'acknowledged',
      column: 'acknowledged_at',
      allowedFrom: ['open'],
    });
  }

  async resolve(tenantId: string, id: string) {
    return this.transition(tenantId, id, {
      status: 'resolved',
      column: 'resolved_at',
      allowedFrom: ['open', 'acknowledged'],
    });
  }

  async linkTicket(tenantId: string, id: string, ticketId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [alert] = await queryRunner.query(
        `SELECT * FROM alerts WHERE id = $1`,
        [id],
      );
      if (!alert) {
        throw new NotFoundException(`Alert ${id} not found`);
      }
      if (alert.ticket_id) {
        throw new BadRequestException(
          `Alert ${id} is already linked to ticket ${alert.ticket_id}`,
        );
      }
      const [ticket] = await queryRunner.query(
        `SELECT id FROM tickets WHERE id = $1`,
        [ticketId],
      );
      if (!ticket) {
        throw new NotFoundException(`Ticket ${ticketId} not found`);
      }

      const [rows] = await queryRunner.query(
        `UPDATE alerts SET ticket_id = $2 WHERE id = $1 RETURNING *`,
        [id, ticketId],
      );
      return rows[0];
    });
  }

  private async transition(
    tenantId: string,
    id: string,
    opts: { status: string; column: string; allowedFrom: string[] },
  ) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [alert] = await queryRunner.query(
        `SELECT * FROM alerts WHERE id = $1`,
        [id],
      );
      if (!alert) {
        throw new NotFoundException(`Alert ${id} not found`);
      }
      if (!opts.allowedFrom.includes(alert.status)) {
        throw new BadRequestException(
          `Alert ${id} cannot move to '${opts.status}' from '${alert.status}'`,
        );
      }

      const [rows] = await queryRunner.query(
        `UPDATE alerts SET status = $2, ${opts.column} = now() WHERE id = $1 RETURNING *`,
        [id, opts.status],
      );
      return rows[0];
    });
  }
}
