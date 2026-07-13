import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';

/**
 * Read-only lookups backing the ticket properties panel's dropdowns (group,
 * agent, ticket type). Kept separate from TicketsService since these aren't
 * ticket operations -- just tenant-scoped reference data the UI needs to
 * render editable selects instead of asking for raw UUIDs.
 */
@Injectable()
export class ReferenceDataService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  listGroups(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(`SELECT id, name FROM groups ORDER BY name`),
    );
  }

  listAgents(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT a.id, u.name, u.email
         FROM agents a JOIN users u ON u.id = a.user_id
         WHERE a.is_active = true
         ORDER BY u.name`,
      ),
    );
  }

  listTicketTypes(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT id, name, default_group_id, default_sla_policy_id
         FROM ticket_types
         ORDER BY name`,
      ),
    );
  }
}
