import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { AutomationRulesService } from './automation/automation-rules.service';
import { AddTicketMessageDto } from './dto/add-ticket-message.dto';
import { ComposeOutboundDto } from './dto/compose-outbound.dto';
import { CreateTicketDto, InlineContactDto } from './dto/create-ticket.dto';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { calculateDueDates, SlaTargets } from './sla/calculate-due-dates';

/**
 * Postgres FK constraints don't consult RLS when checking referential
 * integrity, so a groupId/agentId/etc. belonging to a different tenant would
 * otherwise satisfy the FK and insert successfully. Every foreign id coming
 * from a request body goes through this first — an RLS-scoped SELECT that
 * returns zero rows for anything outside the caller's tenant, closing that
 * gap explicitly rather than relying on FK checks alone.
 */
async function assertBelongsToTenant(
  queryRunner: QueryRunner,
  table: string,
  id: string,
  label: string,
): Promise<void> {
  const rows = await queryRunner.query(`SELECT 1 FROM ${table} WHERE id = $1`, [
    id,
  ]);
  if (rows.length === 0) {
    throw new BadRequestException(`${label} ${id} not found for this tenant`);
  }
}

async function upsertContactByEmail(
  queryRunner: QueryRunner,
  tenantId: string,
  contact: InlineContactDto,
): Promise<string> {
  const [existing] = await queryRunner.query(
    `SELECT id FROM contacts WHERE email = $1`,
    [contact.email],
  );
  if (existing) {
    return existing.id;
  }
  const [created] = await queryRunner.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, contact.name, contact.email],
  );
  return created.id;
}

async function nextTicketNumber(
  queryRunner: QueryRunner,
  tenantId: string,
): Promise<number> {
  const [row] = await queryRunner.query(
    `INSERT INTO ticket_number_counters (tenant_id, next_value) VALUES ($1, 2)
     ON CONFLICT (tenant_id) DO UPDATE SET next_value = ticket_number_counters.next_value + 1
     RETURNING next_value - 1 AS ticket_number`,
    [tenantId],
  );
  return row.ticket_number;
}

async function fetchSlaPolicy(
  queryRunner: QueryRunner,
  slaPolicyId: string | null,
): Promise<SlaTargets | null> {
  if (!slaPolicyId) return null;
  const [policy] = await queryRunner.query(
    `SELECT first_response_target_minutes, resolution_target_minutes, business_hours_only FROM sla_policies WHERE id = $1`,
    [slaPolicyId],
  );
  return policy ?? null;
}

@Injectable()
export class TicketsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly automationRules: AutomationRulesService,
  ) {}

  async create(tenantId: string, dto: CreateTicketDto) {
    if (!dto.contactId && !dto.contact) {
      throw new BadRequestException(
        'Either contactId or contact { name, email } is required',
      );
    }

    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      let contactId: string;
      if (dto.contactId) {
        await assertBelongsToTenant(
          queryRunner,
          'contacts',
          dto.contactId,
          'contact',
        );
        contactId = dto.contactId;
      } else {
        contactId = await upsertContactByEmail(
          queryRunner,
          tenantId,
          dto.contact!,
        );
      }

      // SLA policy is only ever derived from the ticket type's default, not
      // settable directly -- matches the documented PATCH contract (section
      // 4), which lists ticket_type_id as editable but not sla_policy_id.
      let groupId = dto.groupId ?? null;
      let slaPolicyId: string | null = null;
      if (dto.ticketTypeId) {
        await assertBelongsToTenant(
          queryRunner,
          'ticket_types',
          dto.ticketTypeId,
          'ticket type',
        );
        const [ticketType] = await queryRunner.query(
          `SELECT default_group_id, default_sla_policy_id FROM ticket_types WHERE id = $1`,
          [dto.ticketTypeId],
        );
        if (!groupId) groupId = ticketType?.default_group_id ?? null;
        slaPolicyId = ticketType?.default_sla_policy_id ?? null;
      }
      if (groupId) {
        await assertBelongsToTenant(queryRunner, 'groups', groupId, 'group');
      }
      if (dto.agentId) {
        await assertBelongsToTenant(
          queryRunner,
          'agents',
          dto.agentId,
          'agent',
        );
      }
      if (dto.resourceId) {
        await assertBelongsToTenant(
          queryRunner,
          'resources',
          dto.resourceId,
          'resource',
        );
      }

      const slaPolicy = await fetchSlaPolicy(queryRunner, slaPolicyId);
      const ticketNumber = await nextTicketNumber(queryRunner, tenantId);
      // Computed from the same Date instance used for the created_at column
      // below, so the due dates are never a few milliseconds off from what
      // "created_at + target_minutes" would say if recomputed later.
      const createdAt = new Date();
      const { firstResponseDueAt, resolutionDueAt } = calculateDueDates(
        createdAt,
        slaPolicy,
      );

      const [ticket] = await queryRunner.query(
        `INSERT INTO tickets (tenant_id, ticket_number, subject, contact_id, ticket_type_id, group_id, agent_id, resource_id, priority, source, source_detail, sla_policy_id, first_response_due_at, resolution_due_at, created_at, updated_at, platform)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15, $16)
         RETURNING *`,
        [
          tenantId,
          ticketNumber,
          dto.subject,
          contactId,
          dto.ticketTypeId ?? null,
          groupId,
          dto.agentId ?? null,
          dto.resourceId ?? null,
          dto.priority ?? 'medium',
          dto.source,
          dto.sourceDetail ?? null,
          slaPolicyId,
          firstResponseDueAt,
          resolutionDueAt,
          createdAt,
          dto.platform ?? null,
        ],
      );
      return this.automationRules.runRules(
        tenantId,
        'ticket_created',
        ticket,
        queryRunner,
      );
    });
  }

  /**
   * The agent-initiated outbound path from section 1: an agent proactively
   * emails a contact and a ticket gets created and associated with that
   * contact automatically, reusing the same create()/addMessage() logic the
   * customer-facing paths use rather than a separate code path. Unlike a
   * regular reply, the very first message is the ticket's opening move, not
   * a response to something the contact sent in.
   */
  async composeOutbound(tenantId: string, dto: ComposeOutboundDto) {
    if (!dto.contactId && !dto.contact) {
      throw new BadRequestException(
        'Either contactId or contact { name, email } is required',
      );
    }
    const ticket = await this.create(tenantId, {
      subject: dto.subject,
      contactId: dto.contactId,
      contact: dto.contact,
      source: 'agent_outbound',
      groupId: dto.groupId,
      agentId: dto.agentId,
    });
    await this.addMessage(tenantId, ticket.id, {
      type: 'reply',
      authorType: 'agent',
      body: dto.body,
    });
    return this.get(tenantId, ticket.id);
  }

  async list(tenantId: string, query: ListTicketsQueryDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (query.status) {
        params.push(query.status);
        conditions.push(`status = $${params.length}`);
      }
      if (query.priority) {
        params.push(query.priority);
        conditions.push(`priority = $${params.length}`);
      }
      if (query.platform) {
        params.push(query.platform);
        conditions.push(`platform = $${params.length}`);
      }
      if (query.groupId) {
        params.push(query.groupId);
        conditions.push(`group_id = $${params.length}`);
      }
      if (query.agentId) {
        params.push(query.agentId);
        conditions.push(`agent_id = $${params.length}`);
      }

      const where = conditions.length
        ? `WHERE ${conditions.join(' AND ')}`
        : '';
      const limit = query.limit ?? 25;
      const offset = query.offset ?? 0;

      const items = await queryRunner.query(
        `SELECT * FROM tickets ${where} ORDER BY ticket_number DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      const [{ count }] = await queryRunner.query(
        `SELECT count(*)::int AS count FROM tickets ${where}`,
        params,
      );

      return { items, total: count };
    });
  }

  async get(tenantId: string, id: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [ticket] = await queryRunner.query(
        `SELECT * FROM tickets WHERE id = $1`,
        [id],
      );
      if (!ticket) {
        throw new NotFoundException(`Ticket ${id} not found`);
      }
      return ticket;
    });
  }

  /** Used by email intake to correlate a reply's "[Ticket #N]" subject tag back to the ticket. */
  async findByTicketNumber(tenantId: string, ticketNumber: number) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [ticket] = await queryRunner.query(
        `SELECT * FROM tickets WHERE ticket_number = $1`,
        [ticketNumber],
      );
      return ticket ?? null;
    });
  }

  async update(tenantId: string, id: string, dto: UpdateTicketDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT * FROM tickets WHERE id = $1`,
        [id],
      );
      if (!existing) {
        throw new NotFoundException(`Ticket ${id} not found`);
      }

      if (dto.groupId)
        await assertBelongsToTenant(
          queryRunner,
          'groups',
          dto.groupId,
          'group',
        );
      if (dto.agentId)
        await assertBelongsToTenant(
          queryRunner,
          'agents',
          dto.agentId,
          'agent',
        );
      if (dto.ticketTypeId)
        await assertBelongsToTenant(
          queryRunner,
          'ticket_types',
          dto.ticketTypeId,
          'ticket type',
        );

      const sets: string[] = [];
      const params: unknown[] = [];
      const assign = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };

      // Tracked separately from `sets` -- one row per changed field, written
      // to ticket_activities after the UPDATE succeeds, so the ticket detail
      // UI can show a timeline of property changes (who/what/when), not just
      // the message thread.
      const activityChanges: {
        field: string;
        oldValue: unknown;
        newValue: unknown;
      }[] = [];
      const trackChange = (
        field: string,
        oldValue: unknown,
        newValue: unknown,
      ) => {
        if (oldValue !== newValue) {
          activityChanges.push({ field, oldValue, newValue });
        }
      };

      if (dto.status !== undefined) {
        trackChange('status', existing.status, dto.status);
        assign('status', dto.status);
        const closing = dto.status === 'resolved' || dto.status === 'closed';
        assign('resolved_at', closing ? new Date() : null);
      }
      if (dto.priority !== undefined) {
        trackChange('priority', existing.priority, dto.priority);
        assign('priority', dto.priority);
      }
      if (dto.platform !== undefined) {
        trackChange('platform', existing.platform, dto.platform);
        assign('platform', dto.platform);
      }
      if (dto.groupId !== undefined) {
        trackChange('group_id', existing.group_id, dto.groupId);
        assign('group_id', dto.groupId);
      }
      if (dto.agentId !== undefined) {
        trackChange('agent_id', existing.agent_id, dto.agentId);
        assign('agent_id', dto.agentId);
      }
      if (dto.ticketTypeId !== undefined) {
        trackChange(
          'ticket_type_id',
          existing.ticket_type_id,
          dto.ticketTypeId,
        );
        assign('ticket_type_id', dto.ticketTypeId);

        // Changing ticket type can change which SLA policy applies (section
        // 5: "recalculates ... whenever a ticket's SLA policy ... changes").
        // Due dates stay anchored to the ticket's original created_at, not
        // the moment of this update.
        const [ticketType] = await queryRunner.query(
          `SELECT default_sla_policy_id FROM ticket_types WHERE id = $1`,
          [dto.ticketTypeId],
        );
        const newSlaPolicyId: string | null =
          ticketType?.default_sla_policy_id ?? null;

        if (newSlaPolicyId !== existing.sla_policy_id) {
          const slaPolicy = await fetchSlaPolicy(queryRunner, newSlaPolicyId);
          const { firstResponseDueAt, resolutionDueAt } = calculateDueDates(
            existing.created_at,
            slaPolicy,
          );
          assign('sla_policy_id', newSlaPolicyId);
          assign('first_response_due_at', firstResponseDueAt);
          assign('resolution_due_at', resolutionDueAt);
        }
      }

      if (sets.length === 0) {
        return existing;
      }

      sets.push('updated_at = now()');
      params.push(id);

      // TypeORM's postgres driver returns UPDATE/DELETE results as
      // [rows, rowCount] (unlike SELECT/INSERT, which just return rows) —
      // destructure accordingly, not [ticket] = ... like the INSERT calls
      // elsewhere in this file.
      const [rows] = await queryRunner.query(
        `UPDATE tickets SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );

      for (const change of activityChanges) {
        await queryRunner.query(
          `INSERT INTO ticket_activities (tenant_id, ticket_id, field, old_value, new_value) VALUES ($1, $2, $3, $4, $5)`,
          [
            tenantId,
            id,
            change.field,
            change.oldValue ?? null,
            change.newValue ?? null,
          ],
        );
      }
      return this.automationRules.runRules(
        tenantId,
        'ticket_updated',
        rows[0],
        queryRunner,
      );
    });
  }

  async addMessage(
    tenantId: string,
    ticketId: string,
    dto: AddTicketMessageDto,
  ) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [ticket] = await queryRunner.query(
        `SELECT id, first_response_at FROM tickets WHERE id = $1`,
        [ticketId],
      );
      if (!ticket) {
        throw new NotFoundException(`Ticket ${ticketId} not found`);
      }

      if (dto.authorId && dto.authorType === 'agent') {
        await assertBelongsToTenant(
          queryRunner,
          'agents',
          dto.authorId,
          'agent',
        );
      }
      if (dto.authorId && dto.authorType === 'contact') {
        await assertBelongsToTenant(
          queryRunner,
          'contacts',
          dto.authorId,
          'contact',
        );
      }

      const [message] = await queryRunner.query(
        `INSERT INTO ticket_messages (tenant_id, ticket_id, type, author_type, author_id, body, cc)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          tenantId,
          ticketId,
          dto.type,
          dto.authorType,
          dto.authorId ?? null,
          dto.body,
          dto.cc ?? [],
        ],
      );

      // First-response tracking for SLA purposes: the first agent reply
      // specifically, not the first message of any kind -- a system note or
      // the contact's own initial message (from email intake) shouldn't count.
      if (
        dto.type === 'reply' &&
        dto.authorType === 'agent' &&
        !ticket.first_response_at
      ) {
        await queryRunner.query(
          `UPDATE tickets SET first_response_at = now() WHERE id = $1`,
          [ticketId],
        );
      }

      return message;
    });
  }

  async listMessages(tenantId: string, ticketId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [ticket] = await queryRunner.query(
        `SELECT id FROM tickets WHERE id = $1`,
        [ticketId],
      );
      if (!ticket) {
        throw new NotFoundException(`Ticket ${ticketId} not found`);
      }

      return queryRunner.query(
        `SELECT * FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC`,
        [ticketId],
      );
    });
  }

  /** Property-change history (status/priority/group/agent/ticket type/platform) for the Timeline side panel section. */
  async listActivities(tenantId: string, ticketId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [ticket] = await queryRunner.query(
        `SELECT id FROM tickets WHERE id = $1`,
        [ticketId],
      );
      if (!ticket) {
        throw new NotFoundException(`Ticket ${ticketId} not found`);
      }

      return queryRunner.query(
        `SELECT * FROM ticket_activities WHERE ticket_id = $1 ORDER BY created_at ASC`,
        [ticketId],
      );
    });
  }

  /**
   * Merged view of messages, property changes, and time logs (section 4's
   * GET /tickets/:id/timeline), each tagged with a `kind` discriminator so
   * the frontend can render each differently while sharing one chronological
   * feed. Time logs sort by logged_at (when the work happened) rather than
   * created_at (when the log entry was recorded), which can differ if an
   * agent logs time after the fact.
   */
  async getTimeline(tenantId: string, ticketId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [ticket] = await queryRunner.query(
        `SELECT id FROM tickets WHERE id = $1`,
        [ticketId],
      );
      if (!ticket) {
        throw new NotFoundException(`Ticket ${ticketId} not found`);
      }

      // Sequential, not Promise.all: queryRunner holds one connection, and
      // node-postgres doesn't support concurrent queries on the same client.
      const messages = await queryRunner.query(
        `SELECT * FROM ticket_messages WHERE ticket_id = $1`,
        [ticketId],
      );
      const activities = await queryRunner.query(
        `SELECT * FROM ticket_activities WHERE ticket_id = $1`,
        [ticketId],
      );
      const timeLogs = await queryRunner.query(
        `SELECT * FROM ticket_time_logs WHERE ticket_id = $1`,
        [ticketId],
      );

      const items = [
        ...messages.map((m: Record<string, any>) => ({
          kind: 'message' as const,
          timestamp: m.created_at,
          ...m,
        })),
        ...activities.map((a: Record<string, any>) => ({
          kind: 'activity' as const,
          timestamp: a.created_at,
          ...a,
        })),
        ...timeLogs.map((t: Record<string, any>) => ({
          kind: 'time_log' as const,
          timestamp: t.logged_at,
          ...t,
        })),
      ];
      items.sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
      return items;
    });
  }
}
