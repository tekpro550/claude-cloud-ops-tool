import { BadRequestException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';

export interface AutomationAction {
  type:
    | 'set_status'
    | 'set_priority'
    | 'set_group'
    | 'set_agent'
    | 'set_platform'
    | 'add_note'
    | 'add_tag';
  value: string;
}

const ACTION_FIELD: Partial<Record<AutomationAction['type'], string>> = {
  set_status: 'status',
  set_priority: 'priority',
  set_group: 'group_id',
  set_agent: 'agent_id',
  set_platform: 'platform',
};

export async function assertActionTargetsBelongToTenant(
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
 * Applies one action to a ticket, shared by both the automation rule engine
 * (rules evaluated automatically on create/update) and scenarios (the same
 * action shape, applied on demand via a single button click -- section 3's
 * scenarios.actions doc comment). Property-changing actions write a
 * ticket_activities row too, same as a direct PATCH via TicketsService, so
 * the Timeline shows what an automation/scenario changed, not just what an
 * agent changed by hand.
 */
export async function applyAction(
  tenantId: string,
  ticket: Record<string, any>,
  action: AutomationAction,
  queryRunner: QueryRunner,
): Promise<Record<string, any>> {
  const field = ACTION_FIELD[action.type];
  if (field) {
    const oldValue = ticket[field] ?? null;
    if (oldValue === action.value) {
      return ticket;
    }
    let resolvedAtClause = '';
    if (action.type === 'set_status') {
      const closing = action.value === 'resolved' || action.value === 'closed';
      resolvedAtClause = closing
        ? ', resolved_at = now()'
        : ', resolved_at = NULL';
    }
    const [rows] = await queryRunner.query(
      `UPDATE tickets SET ${field} = $1, updated_at = now()${resolvedAtClause} WHERE id = $2 RETURNING *`,
      [action.value, ticket.id],
    );
    await queryRunner.query(
      `INSERT INTO ticket_activities (tenant_id, ticket_id, field, old_value, new_value) VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, ticket.id, field, oldValue, action.value],
    );
    return rows[0];
  }

  if (action.type === 'add_note') {
    await queryRunner.query(
      `INSERT INTO ticket_messages (tenant_id, ticket_id, type, author_type, body) VALUES ($1, $2, 'note', 'system', $3)`,
      [tenantId, ticket.id, action.value],
    );
    return ticket;
  }

  if (action.type === 'add_tag') {
    const tag = action.value.trim();
    if (!tag) return ticket;
    const existing: string[] = Array.isArray(ticket.tags) ? ticket.tags : [];
    if (existing.includes(tag)) return ticket;
    // array_append + a uniqueness guard above keeps tags a set; no activity
    // row (tag changes are intentionally kept off the timeline, same as a
    // manual tag edit in TicketsService.update).
    const [rows] = await queryRunner.query(
      `UPDATE tickets SET tags = array_append(tags, $1), updated_at = now() WHERE id = $2 RETURNING *`,
      [tag, ticket.id],
    );
    return rows[0];
  }

  return ticket;
}
