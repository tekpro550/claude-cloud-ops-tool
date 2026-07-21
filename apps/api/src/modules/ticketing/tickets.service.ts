import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { NotificationsService } from '../../notifications/notifications.service';
import { SolutionsService } from './solutions.service';
import { AutomationRulesService } from './automation/automation-rules.service';
import { AssignmentService } from './assignment/assignment.service';
import { CustomFieldsService } from './custom-fields/custom-fields.service';
import { validateCustomFields } from './custom-fields/custom-field-validate';
import { TicketWatchersService } from './ticket-watchers/ticket-watchers.service';
import { TicketTriageService } from './ai/ticket-triage.service';
import { TicketSentimentService } from './ai/ticket-sentiment.service';
import { AddTicketMessageDto } from './dto/add-ticket-message.dto';
import { ComposeOutboundDto } from './dto/compose-outbound.dto';
import { CreateTicketDto, InlineContactDto } from './dto/create-ticket.dto';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';
import { sanitizeTicketBody, htmlToPlainText } from './sanitize-html';
import { BusinessHours } from './sla/business-hours';
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

/** The tenant's configured working window, used for business_hours_only SLA math. */
async function fetchBusinessHours(
  queryRunner: QueryRunner,
  tenantId: string,
): Promise<BusinessHours | null> {
  const [row] = await queryRunner.query(
    `SELECT business_hours_start_minute, business_hours_end_minute, business_hours_days, business_hours_timezone
     FROM tenants WHERE id = $1`,
    [tenantId],
  );
  if (!row) return null;
  return {
    startMinute: row.business_hours_start_minute,
    endMinute: row.business_hours_end_minute,
    days: row.business_hours_days,
    timezone: row.business_hours_timezone,
  };
}

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly automationRules: AutomationRulesService,
    private readonly notifications: NotificationsService,
    private readonly solutions: SolutionsService,
    private readonly triage: TicketTriageService,
    private readonly sentiment: TicketSentimentService,
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
      const businessHours = slaPolicy?.business_hours_only
        ? await fetchBusinessHours(queryRunner, tenantId)
        : null;
      const ticketNumber = await nextTicketNumber(queryRunner, tenantId);
      // Computed from the same Date instance used for the created_at column
      // below, so the due dates are never a few milliseconds off from what
      // "created_at + target_minutes" would say if recomputed later.
      const createdAt = new Date();
      const { firstResponseDueAt, resolutionDueAt } = calculateDueDates(
        createdAt,
        slaPolicy,
        businessHours,
      );

      const customFieldDefs = await CustomFieldsService.loadDefs(queryRunner);
      let customFields: Record<string, unknown>;
      try {
        customFields = validateCustomFields(customFieldDefs, dto.customFields);
      } catch (err) {
        throw new BadRequestException((err as Error).message);
      }

      // Auto-assignment only kicks in when the caller didn't pin an agent and
      // the ticket resolved into a group -- an explicit agentId always wins.
      let agentId = dto.agentId ?? null;
      if (!agentId && groupId) {
        agentId = await AssignmentService.pickAssignee(
          queryRunner,
          tenantId,
          groupId,
          dto.requiredSkill,
        );
      }

      const [ticket] = await queryRunner.query(
        `INSERT INTO tickets (tenant_id, ticket_number, subject, contact_id, ticket_type_id, group_id, agent_id, resource_id, priority, source, source_detail, sla_policy_id, first_response_due_at, resolution_due_at, created_at, updated_at, platform, tags, custom_fields, required_skill)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15, $16, $17, $18, $19)
         RETURNING *`,
        [
          tenantId,
          ticketNumber,
          dto.subject,
          contactId,
          dto.ticketTypeId ?? null,
          groupId,
          agentId,
          dto.resourceId ?? null,
          dto.priority ?? 'medium',
          dto.source,
          dto.sourceDetail ?? null,
          slaPolicyId,
          firstResponseDueAt,
          resolutionDueAt,
          createdAt,
          dto.platform ?? null,
          dto.tags ?? [],
          JSON.stringify(customFields),
          dto.requiredSkill ?? null,
        ],
      );
      const result = await this.automationRules.runRules(
        tenantId,
        'ticket_created',
        ticket,
        queryRunner,
      );
      // Fire triage async after commit — never block ticket creation on AI
      void this.triage.triageTicket(tenantId, ticket.id).catch(() => {});
      return result;
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
      if (query.unassigned) {
        conditions.push(`agent_id IS NULL`);
      }
      if (query.tag) {
        params.push(query.tag);
        conditions.push(`tags @> ARRAY[$${params.length}]::text[]`);
      }
      if (query.overdue) {
        conditions.push(`(
          status NOT IN ('resolved', 'closed') AND (
            (first_response_due_at IS NOT NULL AND first_response_at IS NULL AND first_response_due_at < now()) OR
            (resolution_due_at IS NOT NULL AND resolved_at IS NULL AND resolution_due_at < now())
          )
        )`);
      }
      if (query.createdFrom) {
        params.push(query.createdFrom);
        conditions.push(`created_at >= $${params.length}`);
      }
      if (query.createdTo) {
        params.push(query.createdTo);
        conditions.push(`created_at <= $${params.length}`);
      }
      if (query.resolvedFrom) {
        params.push(query.resolvedFrom);
        conditions.push(`resolved_at >= $${params.length}`);
      }
      if (query.resolvedTo) {
        params.push(query.resolvedTo);
        conditions.push(`resolved_at <= $${params.length}`);
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

  /**
   * Distinct tags in use across the tenant's tickets, sorted, for tag
   * autocomplete and the ticket-list tag filter. unnest() flattens the
   * text[] columns; the GIN index keeps this cheap even at scale.
   */
  async distinctTags(tenantId: string): Promise<string[]> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const rows = await queryRunner.query(
        `SELECT DISTINCT unnest(tags) AS tag FROM tickets ORDER BY tag ASC`,
      );
      return rows.map((r: { tag: string }) => r.tag);
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

  /**
   * Merges one or more duplicate source tickets into a primary: each source's
   * conversation (messages + attachments) is carried over to the primary, the
   * source is closed and stamped with merged_into_id, and both sides get a
   * system note so the history is legible. Idempotent-ish: a source already
   * merged (or that is the primary) is skipped rather than double-processed.
   */
  async merge(
    tenantId: string,
    primaryId: string,
    sourceTicketIds: string[],
  ): Promise<Record<string, unknown>> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [primary] = await queryRunner.query(
        `SELECT * FROM tickets WHERE id = $1`,
        [primaryId],
      );
      if (!primary) {
        throw new NotFoundException(`Ticket ${primaryId} not found`);
      }

      const mergedNumbers: number[] = [];
      for (const sourceId of sourceTicketIds) {
        if (sourceId === primaryId) continue;
        const [source] = await queryRunner.query(
          `SELECT id, ticket_number, merged_into_id FROM tickets WHERE id = $1`,
          [sourceId],
        );
        if (!source) {
          throw new NotFoundException(`Ticket ${sourceId} not found`);
        }
        if (source.merged_into_id) continue; // already merged elsewhere

        // Carry the conversation over to the primary.
        await queryRunner.query(
          `UPDATE ticket_messages SET ticket_id = $1 WHERE ticket_id = $2`,
          [primaryId, sourceId],
        );
        await queryRunner.query(
          `UPDATE ticket_attachments SET ticket_id = $1 WHERE ticket_id = $2`,
          [primaryId, sourceId],
        );

        // Close the source and point it at the primary.
        await queryRunner.query(
          `UPDATE tickets SET status = 'closed', resolved_at = COALESCE(resolved_at, now()),
             merged_into_id = $1, updated_at = now() WHERE id = $2`,
          [primaryId, sourceId],
        );
        await queryRunner.query(
          `INSERT INTO ticket_messages (tenant_id, ticket_id, type, author_type, body)
           VALUES ($1, $2, 'note', 'system', $3)`,
          [
            tenantId,
            sourceId,
            `This ticket was merged into #${primary.ticket_number}.`,
          ],
        );
        mergedNumbers.push(source.ticket_number);
      }

      if (mergedNumbers.length > 0) {
        await queryRunner.query(
          `INSERT INTO ticket_messages (tenant_id, ticket_id, type, author_type, body)
           VALUES ($1, $2, 'note', 'system', $3)`,
          [
            tenantId,
            primaryId,
            `Merged in ticket(s): ${mergedNumbers
              .map((n) => `#${n}`)
              .join(', ')}.`,
          ],
        );
      }

      const [updated] = await queryRunner.query(
        `SELECT * FROM tickets WHERE id = $1`,
        [primaryId],
      );
      return updated;
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

  async update(
    tenantId: string,
    id: string,
    dto: UpdateTicketDto,
    actorAgentId?: string,
  ) {
    const { result, assignedAgentId, resolvedNow } = await withTenantContext(
      this.dataSource,
      tenantId,
      async (queryRunner) => {
        const [existing] = await queryRunner.query(
          `SELECT * FROM tickets WHERE id = $1`,
          [id],
        );
        if (!existing) {
          throw new NotFoundException(`Ticket ${id} not found`);
        }
        // Capture a genuine (re)assignment to a real agent so the assigned
        // agent can be emailed after the transaction commits.
        const assignedAgentId =
          dto.agentId !== undefined &&
          dto.agentId &&
          dto.agentId !== existing.agent_id
            ? dto.agentId
            : null;

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

        // Whether this update transitions the ticket into 'resolved' -- drives
        // auto-seeding a knowledge-base draft from the resolving reply, below.
        let resolvedNow = false;

        if (dto.status !== undefined) {
          trackChange('status', existing.status, dto.status);
          assign('status', dto.status);
          const closing = dto.status === 'resolved' || dto.status === 'closed';
          assign('resolved_at', closing ? new Date() : null);
          resolvedNow =
            dto.status === 'resolved' && existing.status !== 'resolved';
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
        if (dto.tags !== undefined) {
          // Normalize: trimmed, de-duplicated, no empties. Tag changes aren't
          // added to the activity timeline (they'd be noisy and low-signal).
          const tags = Array.from(
            new Set(dto.tags.map((t) => t.trim()).filter((t) => t.length > 0)),
          );
          assign('tags', tags);
        }
        if (dto.customFields !== undefined) {
          // Partial merge: the submitted keys overlay whatever's stored, then
          // the whole map is re-validated so required fields already set stay
          // satisfied and each value still matches its (possibly changed) def.
          const defs = await CustomFieldsService.loadDefs(queryRunner);
          const merged = {
            ...((existing.custom_fields as Record<string, unknown>) ?? {}),
            ...dto.customFields,
          };
          let validated: Record<string, unknown>;
          try {
            validated = validateCustomFields(defs, merged);
          } catch (err) {
            throw new BadRequestException((err as Error).message);
          }
          assign('custom_fields', JSON.stringify(validated));
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
            const businessHours = slaPolicy?.business_hours_only
              ? await fetchBusinessHours(queryRunner, tenantId)
              : null;
            const { firstResponseDueAt, resolutionDueAt } = calculateDueDates(
              existing.created_at,
              slaPolicy,
              businessHours,
            );
            assign('sla_policy_id', newSlaPolicyId);
            assign('first_response_due_at', firstResponseDueAt);
            assign('resolution_due_at', resolutionDueAt);
          }
        }

        if (sets.length === 0) {
          return { result: existing, assignedAgentId: null };
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
            `INSERT INTO ticket_activities (tenant_id, ticket_id, field, old_value, new_value, actor_agent_id) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              tenantId,
              id,
              change.field,
              change.oldValue ?? null,
              change.newValue ?? null,
              actorAgentId ?? null,
            ],
          );
        }
        const result = await this.automationRules.runRules(
          tenantId,
          'ticket_updated',
          rows[0],
          queryRunner,
        );
        return { result, assignedAgentId, resolvedNow };
      },
    );

    // Notify the newly-assigned agent, after commit (fire-and-forget).
    if (assignedAgentId) {
      await this.notifyAgentAssignment(tenantId, assignedAgentId, result).catch(
        (err) =>
          this.logger.error(
            `failed to enqueue assignment email for ticket ${id}: ${(err as Error).message}`,
          ),
      );
    }

    // Seed a draft knowledge-base article from the resolving reply, after
    // commit and best-effort: a KB failure must never fail resolving a ticket.
    if (resolvedNow) {
      await this.solutions
        .createFromResolvedTicket(tenantId, id)
        .catch((err) =>
          this.logger.error(
            `failed to auto-create KB article for resolved ticket ${id}: ${(err as Error).message}`,
          ),
        );
    }

    return result;
  }

  /** Emails the agent a ticket was just assigned to. */
  private async notifyAgentAssignment(
    tenantId: string,
    agentId: string,
    ticket: Record<string, unknown>,
  ): Promise<void> {
    const email = await this.resolveAgentEmail(tenantId, agentId);
    if (!email) return;
    await this.notifications.enqueue({
      tenantId,
      channel: 'email',
      recipient: email,
      templateName: 'ticket.assigned',
      payload: {
        ticketNumber: ticket.ticket_number,
        subject: ticket.subject,
      },
    });
  }

  private resolveAgentEmail(
    tenantId: string,
    agentId: string,
  ): Promise<string | null> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [row] = await queryRunner.query(
        `SELECT u.email FROM agents a JOIN users u ON u.id = a.user_id WHERE a.id = $1`,
        [agentId],
      );
      return row?.email ?? null;
    });
  }

  async addMessage(
    tenantId: string,
    ticketId: string,
    dto: AddTicketMessageDto,
  ) {
    const { message, outbound, agentNotify, watcherNotify } =
      await withTenantContext(
        this.dataSource,
        tenantId,
        async (queryRunner) => {
          const [ticket] = await queryRunner.query(
            `SELECT id, ticket_number, subject, contact_id, agent_id, first_response_at FROM tickets WHERE id = $1`,
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

          // The composer now emits rich-text HTML, so every body is a stored
          // XSS surface -- sanitize to a formatting allowlist before it's
          // persisted and later rendered in the thread, the portal, and email.
          const safeBody = sanitizeTicketBody(dto.body);

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
              safeBody,
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

          // A public agent reply is the only message type that leaves the
          // helpdesk: notes are private, forwards go through the compose flow.
          // Gather the recipient + agent name now, inside the tenant-scoped
          // transaction, so the actual dispatch can happen after commit.
          let outbound: {
            recipient: string;
            agentName: string;
            ticketNumber: number;
            subject: string;
            body: string;
            cc: string[];
          } | null = null;
          if (dto.type === 'reply' && dto.authorType === 'agent') {
            const [contact] = await queryRunner.query(
              `SELECT email FROM contacts WHERE id = $1`,
              [ticket.contact_id],
            );
            let agentName = 'Support';
            if (dto.authorId) {
              const [agent] = await queryRunner.query(
                `SELECT u.name FROM agents a JOIN users u ON u.id = a.user_id WHERE a.id = $1`,
                [dto.authorId],
              );
              if (agent?.name) agentName = agent.name;
            }
            if (contact?.email) {
              outbound = {
                recipient: contact.email,
                agentName,
                ticketNumber: ticket.ticket_number,
                subject: ticket.subject,
                // The sanitized HTML rides the email's html part; a plain-text
                // rendering rides the text part for clients that prefer it.
                body: safeBody,
                cc: dto.cc ?? [],
              };
            }
          }

          // A contact reply on an assigned ticket notifies the assigned agent.
          let agentNotify: {
            agentId: string;
            ticketNumber: number;
            subject: string;
            contactName: string;
            body: string;
          } | null = null;
          if (
            dto.type === 'reply' &&
            dto.authorType === 'contact' &&
            ticket.agent_id
          ) {
            const [c] = await queryRunner.query(
              `SELECT name FROM contacts WHERE id = $1`,
              [ticket.contact_id],
            );
            agentNotify = {
              agentId: ticket.agent_id,
              ticketNumber: ticket.ticket_number,
              subject: ticket.subject,
              contactName: c?.name ?? 'The customer',
              body: htmlToPlainText(safeBody),
            };
          }

          // Watchers get notified of any reply (agent or contact), except the
          // agent who authored it. Gathered here inside the transaction so the
          // dispatch below runs after commit.
          let watcherNotify: {
            watchers: { email: string }[];
            ticketNumber: number;
            subject: string;
            body: string;
          } | null = null;
          if (dto.type === 'reply') {
            const excludeAgentId =
              dto.authorType === 'agent' ? (dto.authorId ?? null) : null;
            const watchers = await TicketWatchersService.watcherEmails(
              queryRunner,
              ticketId,
              excludeAgentId,
            );
            if (watchers.length > 0) {
              watcherNotify = {
                watchers,
                ticketNumber: ticket.ticket_number,
                subject: ticket.subject,
                body: htmlToPlainText(safeBody),
              };
            }
          }

          return { message, outbound, agentNotify, watcherNotify };
        },
      );

    // Fire-and-forget: a mail-provider failure must never fail the reply
    // itself (the message is already committed). The dispatcher records the
    // notification row's own status, so a failure here is logged, not lost.
    if (outbound) {
      await this.notifications
        .enqueue({
          tenantId,
          channel: 'email',
          recipient: outbound.recipient,
          templateName: 'ticket.reply',
          payload: {
            ticketNumber: outbound.ticketNumber,
            subject: outbound.subject,
            body: htmlToPlainText(outbound.body),
            bodyHtml: outbound.body,
            agentName: outbound.agentName,
            cc: outbound.cc,
          },
        })
        .catch((err) =>
          this.logger.error(
            `failed to enqueue outbound reply email for ticket ${ticketId}: ${(err as Error).message}`,
          ),
        );
    }

    // Notify the assigned agent that the customer replied.
    if (agentNotify) {
      const email = await this.resolveAgentEmail(tenantId, agentNotify.agentId);
      if (email) {
        await this.notifications
          .enqueue({
            tenantId,
            channel: 'email',
            recipient: email,
            templateName: 'ticket.contact_reply',
            payload: {
              ticketNumber: agentNotify.ticketNumber,
              subject: agentNotify.subject,
              contactName: agentNotify.contactName,
              body: agentNotify.body,
            },
          })
          .catch((err) =>
            this.logger.error(
              `failed to enqueue contact-reply email for ticket ${ticketId}: ${(err as Error).message}`,
            ),
          );
      }
    }

    // Notify every watcher (best-effort, one email each).
    if (watcherNotify) {
      for (const watcher of watcherNotify.watchers) {
        await this.notifications
          .enqueue({
            tenantId,
            channel: 'email',
            recipient: watcher.email,
            templateName: 'ticket.watcher_update',
            payload: {
              ticketNumber: watcherNotify.ticketNumber,
              subject: watcherNotify.subject,
              body: watcherNotify.body,
            },
          })
          .catch((err) =>
            this.logger.error(
              `failed to enqueue watcher email for ticket ${ticketId}: ${(err as Error).message}`,
            ),
          );
      }
    }

    // Fire sentiment detection async after commit for inbound customer messages
    if (dto.type === 'reply' && dto.authorType === 'contact') {
      void this.sentiment.detectSentiment(tenantId, ticketId).catch(() => {});
    }

    return message;
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
