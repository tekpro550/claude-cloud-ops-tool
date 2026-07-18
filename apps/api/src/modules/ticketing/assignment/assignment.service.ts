import { QueryRunner } from 'typeorm';

const OPEN_STATUSES = ['new', 'open', 'pending'];

interface GroupAssignmentConfig {
  assignment_strategy: 'manual' | 'round_robin' | 'load_based' | 'skill_based';
  max_open_tickets_per_agent: number | null;
}

/**
 * Auto-assignment strategies, invoked from within an already-open tenant
 * transaction (same pattern as CustomFieldsService.loadDefs / apply-action.ts
 * -- a plain helper taking the caller's QueryRunner rather than opening its
 * own withTenantContext), so it composes cleanly inside
 * TicketsService.create()'s single transaction.
 */
export class AssignmentService {
  static async loadGroupConfig(
    queryRunner: QueryRunner,
    groupId: string,
  ): Promise<GroupAssignmentConfig | null> {
    const [group] = await queryRunner.query(
      `SELECT assignment_strategy, max_open_tickets_per_agent FROM groups WHERE id = $1`,
      [groupId],
    );
    return group ?? null;
  }

  private static async activeGroupAgents(
    queryRunner: QueryRunner,
    groupId: string,
  ): Promise<string[]> {
    const rows = await queryRunner.query(
      `SELECT id FROM agents WHERE $1::uuid = ANY(group_ids) AND is_active = true ORDER BY id`,
      [groupId],
    );
    return rows.map((r: { id: string }) => r.id);
  }

  private static async openTicketCounts(
    queryRunner: QueryRunner,
    agentIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>(agentIds.map((id) => [id, 0]));
    if (agentIds.length === 0) return counts;
    const rows = await queryRunner.query(
      `SELECT agent_id, count(*)::int AS n FROM tickets
       WHERE agent_id = ANY($1::uuid[]) AND status::text = ANY($2::text[])
       GROUP BY agent_id`,
      [agentIds, OPEN_STATUSES],
    );
    for (const row of rows) {
      counts.set(row.agent_id, row.n);
    }
    return counts;
  }

  /** Least-loaded first (ties broken by id for determinism); agents at/above the cap are excluded. */
  private static leastLoaded(
    agentIds: string[],
    counts: Map<string, number>,
    cap: number | null,
  ): string | null {
    const eligible = agentIds.filter(
      (id) => cap == null || (counts.get(id) ?? 0) < cap,
    );
    if (eligible.length === 0) return null;
    eligible.sort((a, b) => {
      const diff = (counts.get(a) ?? 0) - (counts.get(b) ?? 0);
      return diff !== 0 ? diff : a.localeCompare(b);
    });
    return eligible[0];
  }

  private static async roundRobin(
    queryRunner: QueryRunner,
    tenantId: string,
    groupId: string,
    agentIds: string[],
  ): Promise<string | null> {
    if (agentIds.length === 0) return null;
    const [cursor] = await queryRunner.query(
      `SELECT last_agent_id FROM group_assignment_cursor WHERE tenant_id = $1 AND group_id = $2`,
      [tenantId, groupId],
    );
    const lastIndex = cursor ? agentIds.indexOf(cursor.last_agent_id) : -1;
    // Wraps to the start when the last-assigned agent left the group (or
    // there's no prior cursor) as well as at the natural end of the list.
    const nextIndex = (lastIndex + 1) % agentIds.length;
    const chosen = agentIds[nextIndex];

    await queryRunner.query(
      `INSERT INTO group_assignment_cursor (tenant_id, group_id, last_agent_id, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (tenant_id, group_id)
       DO UPDATE SET last_agent_id = EXCLUDED.last_agent_id, updated_at = now()`,
      [tenantId, groupId, chosen],
    );
    return chosen;
  }

  /**
   * Resolves the next assignee for a new ticket landing in `groupId`, per the
   * group's configured strategy. Returns null when the strategy is 'manual',
   * the group has no eligible agents, or (skill_based) no agent has the
   * required skill -- callers leave the ticket unassigned in that case rather
   * than erroring, same as today's default behavior.
   */
  static async pickAssignee(
    queryRunner: QueryRunner,
    tenantId: string,
    groupId: string,
    requiredSkill?: string | null,
  ): Promise<string | null> {
    const config = await this.loadGroupConfig(queryRunner, groupId);
    if (!config || config.assignment_strategy === 'manual') return null;

    let agentIds = await this.activeGroupAgents(queryRunner, groupId);
    if (agentIds.length === 0) return null;

    if (config.assignment_strategy === 'skill_based') {
      if (!requiredSkill) return null;
      const skilled = await queryRunner.query(
        `SELECT agent_id FROM agent_skills WHERE tenant_id = $1 AND skill = $2`,
        [tenantId, requiredSkill],
      );
      const skilledIds = new Set(
        skilled.map((r: { agent_id: string }) => r.agent_id),
      );
      agentIds = agentIds.filter((id) => skilledIds.has(id));
      if (agentIds.length === 0) return null;
      const counts = await this.openTicketCounts(queryRunner, agentIds);
      return this.leastLoaded(
        agentIds,
        counts,
        config.max_open_tickets_per_agent,
      );
    }

    if (config.assignment_strategy === 'load_based') {
      const counts = await this.openTicketCounts(queryRunner, agentIds);
      return this.leastLoaded(
        agentIds,
        counts,
        config.max_open_tickets_per_agent,
      );
    }

    // round_robin
    return this.roundRobin(queryRunner, tenantId, groupId, agentIds);
  }
}
