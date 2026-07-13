import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { AddTicketMessageDto } from './dto/add-ticket-message.dto';
import { CreateTicketDto, InlineContactDto } from './dto/create-ticket.dto';
import { ListTicketsQueryDto } from './dto/list-tickets-query.dto';
import { UpdateTicketDto } from './dto/update-ticket.dto';

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

@Injectable()
export class TicketsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

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

      let groupId = dto.groupId ?? null;
      if (dto.ticketTypeId) {
        await assertBelongsToTenant(
          queryRunner,
          'ticket_types',
          dto.ticketTypeId,
          'ticket type',
        );
        if (!groupId) {
          const [ticketType] = await queryRunner.query(
            `SELECT default_group_id FROM ticket_types WHERE id = $1`,
            [dto.ticketTypeId],
          );
          groupId = ticketType?.default_group_id ?? null;
        }
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

      const ticketNumber = await nextTicketNumber(queryRunner, tenantId);

      const [ticket] = await queryRunner.query(
        `INSERT INTO tickets (tenant_id, ticket_number, subject, contact_id, ticket_type_id, group_id, agent_id, resource_id, priority, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
        ],
      );
      return ticket;
    });
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

  async update(tenantId: string, id: string, dto: UpdateTicketDto) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM tickets WHERE id = $1`,
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

      if (dto.status !== undefined) {
        assign('status', dto.status);
        const closing = dto.status === 'resolved' || dto.status === 'closed';
        assign('resolved_at', closing ? new Date() : null);
      }
      if (dto.priority !== undefined) assign('priority', dto.priority);
      if (dto.groupId !== undefined) assign('group_id', dto.groupId);
      if (dto.agentId !== undefined) assign('agent_id', dto.agentId);
      if (dto.ticketTypeId !== undefined)
        assign('ticket_type_id', dto.ticketTypeId);

      if (sets.length === 0) {
        return queryRunner
          .query(`SELECT * FROM tickets WHERE id = $1`, [id])
          .then((rows) => rows[0]);
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
      return rows[0];
    });
  }

  async addMessage(
    tenantId: string,
    ticketId: string,
    dto: AddTicketMessageDto,
  ) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [ticket] = await queryRunner.query(
        `SELECT id FROM tickets WHERE id = $1`,
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
      return message;
    });
  }

  /**
   * Sprint 4 owns the full merged timeline (messages + property changes +
   * time logs). Until then, the ticket detail UI needs some way to show the
   * message thread it can already post to, so this lists just the messages,
   * oldest first.
   */
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
}
