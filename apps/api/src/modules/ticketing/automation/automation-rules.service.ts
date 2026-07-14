import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import {
  CreateAutomationRuleDto,
  UpdateAutomationRuleDto,
} from './automation-rules.dto';

export type AutomationTrigger = 'ticket_created' | 'ticket_updated';

interface AutomationCondition {
  field:
    | 'status'
    | 'priority'
    | 'source'
    | 'subject'
    | 'ticket_type_id'
    | 'group_id'
    | 'platform';
  operator: 'equals' | 'contains';
  value: string;
}

interface AutomationAction {
  type:
    | 'set_status'
    | 'set_priority'
    | 'set_group'
    | 'set_agent'
    | 'set_platform'
    | 'add_note';
  value: string;
}

function conditionMatches(
  ticket: Record<string, any>,
  condition: AutomationCondition,
): boolean {
  const raw = ticket[condition.field];
  const actual = raw === null || raw === undefined ? '' : String(raw);
  if (condition.operator === 'equals') return actual === condition.value;
  return actual.toLowerCase().includes(condition.value.toLowerCase());
}

async function assertActionTargetsBelongToTenant(
  queryRunner: QueryRunner,
  actions: AutomationAction[],
): Promise<void> {
  for (const action of actions) {
    if (action.type === 'set_group') {
      const rows = await queryRunner.query(
        `SELECT 1 FROM groups WHERE id = $1`,
        [action.value],
      );
      if (rows.length === 0) {
        throw new BadRequestException(
          `set_group action references group ${action.value}, which does not exist for this tenant`,
        );
      }
    }
    if (action.type === 'set_agent') {
      const rows = await queryRunner.query(
        `SELECT 1 FROM agents WHERE id = $1`,
        [action.value],
      );
      if (rows.length === 0) {
        throw new BadRequestException(
          `set_agent action references agent ${action.value}, which does not exist for this tenant`,
        );
      }
    }
  }
}

/**
 * CRUD for automation rules plus the execution engine (runRules) that
 * TicketsService calls on create/update. Kept as one service since the two
 * halves share the same row shape and there's no separate consumer of just
 * the CRUD half yet.
 */
@Injectable()
export class AutomationRulesService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  create(tenantId: string, dto: CreateAutomationRuleDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      await assertActionTargetsBelongToTenant(queryRunner, dto.actions);
      const [rule] = await queryRunner.query(
        `INSERT INTO automation_rules (tenant_id, name, trigger, position, is_active, conditions, actions)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          tenantId,
          dto.name,
          dto.trigger,
          dto.position ?? 0,
          dto.isActive ?? true,
          JSON.stringify(dto.conditions),
          JSON.stringify(dto.actions),
        ],
      );
      return rule;
    });
  }

  list(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, (queryRunner) =>
      queryRunner.query(
        `SELECT * FROM automation_rules ORDER BY trigger, position, created_at`,
      ),
    );
  }

  async update(tenantId: string, id: string, dto: UpdateAutomationRuleDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM automation_rules WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Automation rule ${id} not found`);
      }
      if (dto.actions) {
        await assertActionTargetsBelongToTenant(queryRunner, dto.actions);
      }

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };

      if (dto.name !== undefined) assign('name', dto.name);
      if (dto.trigger !== undefined) assign('trigger', dto.trigger);
      if (dto.position !== undefined) assign('position', dto.position);
      if (dto.isActive !== undefined) assign('is_active', dto.isActive);
      if (dto.conditions !== undefined)
        assign('conditions', JSON.stringify(dto.conditions));
      if (dto.actions !== undefined)
        assign('actions', JSON.stringify(dto.actions));

      if (sets.length === 0) {
        const [rule] = await queryRunner.query(
          `SELECT * FROM automation_rules WHERE id = $1`,
          [id],
        );
        return rule;
      }

      sets.push('updated_at = now()');
      params.push(id);
      const [rows] = await queryRunner.query(
        `UPDATE automation_rules SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      return rows[0];
    });
  }

  async remove(tenantId: string, id: string): Promise<void> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [rows] = await queryRunner.query(
        `DELETE FROM automation_rules WHERE id = $1 RETURNING id`,
        [id],
      );
      if (rows.length === 0) {
        throw new NotFoundException(`Automation rule ${id} not found`);
      }
    });
  }

  /**
   * Runs every active rule for `trigger`, in position order, against the
   * given ticket row. A matching rule's actions are applied via SQL and
   * folded back into the in-memory ticket so later rules in the same pass
   * (and the caller) see the cumulative effect. Not stop-on-first-match --
   * all matching rules apply, in order, same as Freshdesk-style automations.
   */
  async runRules(
    tenantId: string,
    trigger: AutomationTrigger,
    ticket: Record<string, any>,
    queryRunner: QueryRunner,
  ): Promise<Record<string, any>> {
    const rules: Array<{
      id: string;
      conditions: AutomationCondition[];
      actions: AutomationAction[];
    }> = await queryRunner.query(
      `SELECT id, conditions, actions FROM automation_rules WHERE trigger = $1 AND is_active = true ORDER BY position, created_at`,
      [trigger],
    );

    let current = ticket;
    for (const rule of rules) {
      const conditionsMet = rule.conditions.every((c) =>
        conditionMatches(current, c),
      );
      if (!conditionsMet) continue;

      for (const action of rule.actions) {
        current = await this.applyAction(
          tenantId,
          current,
          action,
          queryRunner,
        );
      }
    }
    return current;
  }

  private async applyAction(
    tenantId: string,
    ticket: Record<string, any>,
    action: AutomationAction,
    queryRunner: QueryRunner,
  ): Promise<Record<string, any>> {
    switch (action.type) {
      case 'set_status': {
        const closing =
          action.value === 'resolved' || action.value === 'closed';
        const [rows] = await queryRunner.query(
          `UPDATE tickets SET status = $1, resolved_at = $2, updated_at = now() WHERE id = $3 RETURNING *`,
          [action.value, closing ? new Date() : null, ticket.id],
        );
        return rows[0];
      }
      case 'set_priority': {
        const [rows] = await queryRunner.query(
          `UPDATE tickets SET priority = $1, updated_at = now() WHERE id = $2 RETURNING *`,
          [action.value, ticket.id],
        );
        return rows[0];
      }
      case 'set_group': {
        const [rows] = await queryRunner.query(
          `UPDATE tickets SET group_id = $1, updated_at = now() WHERE id = $2 RETURNING *`,
          [action.value, ticket.id],
        );
        return rows[0];
      }
      case 'set_agent': {
        const [rows] = await queryRunner.query(
          `UPDATE tickets SET agent_id = $1, updated_at = now() WHERE id = $2 RETURNING *`,
          [action.value, ticket.id],
        );
        return rows[0];
      }
      case 'set_platform': {
        const [rows] = await queryRunner.query(
          `UPDATE tickets SET platform = $1, updated_at = now() WHERE id = $2 RETURNING *`,
          [action.value, ticket.id],
        );
        return rows[0];
      }
      case 'add_note': {
        await queryRunner.query(
          `INSERT INTO ticket_messages (tenant_id, ticket_id, type, author_type, body) VALUES ($1, $2, 'note', 'system', $3)`,
          [tenantId, ticket.id, action.value],
        );
        return ticket;
      }
      default:
        return ticket;
    }
  }
}
