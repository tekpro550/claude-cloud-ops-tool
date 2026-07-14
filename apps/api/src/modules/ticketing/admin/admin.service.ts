import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';

export interface SetupItem {
  key: string;
  label: string;
  count: number;
  complete: boolean;
}

/** Backs the admin settings page's setup-completeness checklist. */
@Injectable()
export class AdminService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  setupStatus(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const counts: Record<string, number> = {};
      const tables: Array<[key: string, table: string, label: string]> = [
        ['groups', 'groups', 'At least one group'],
        ['agents', 'agents', 'At least one agent'],
        ['ticketTypes', 'ticket_types', 'At least one ticket type'],
        ['slaPolicies', 'sla_policies', 'At least one SLA policy'],
        ['automationRules', 'automation_rules', 'At least one automation rule'],
        ['cannedResponses', 'canned_responses', 'At least one canned response'],
      ];

      for (const [key, table] of tables) {
        const [{ count }] = await queryRunner.query(
          `SELECT count(*)::int AS count FROM ${table}`,
        );
        counts[key] = count;
      }

      const items: SetupItem[] = tables.map(([key, , label]) => ({
        key,
        label,
        count: counts[key],
        complete: counts[key] > 0,
      }));

      return {
        items,
        complete: items.every((i) => i.complete),
        completedCount: items.filter((i) => i.complete).length,
        totalCount: items.length,
      };
    });
  }
}
