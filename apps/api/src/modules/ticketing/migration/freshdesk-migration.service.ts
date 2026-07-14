import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import {
  FreshdeskAgent,
  FreshdeskGroup,
  FreshdeskTicket,
} from './freshdesk-client';

const STATUS_MAP: Record<number, string> = {
  2: 'open',
  3: 'pending',
  4: 'resolved',
  5: 'closed',
};
const PRIORITY_MAP: Record<number, string> = {
  1: 'low',
  2: 'medium',
  3: 'high',
  4: 'urgent',
};

export interface MigrationContext {
  groupIdByFreshdeskId: Map<number, string>;
  agentIdByFreshdeskResponderId: Map<number, string>;
  ticketTypeIdByName: Map<string, string>;
}

/**
 * Mapping + import logic for section 9's Freshdesk migration plan, kept
 * separate from FreshdeskClient (the HTTP layer) specifically so it can be
 * exercised against realistic mock ticket payloads without a live Freshdesk
 * account -- see scripts/verify-freshdesk-mapping.ts.
 */
@Injectable()
export class FreshdeskMigrationService {
  private readonly logger = new Logger(FreshdeskMigrationService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Builds the id/name lookup tables importTicket() needs: Freshdesk group
   * id -> local group id (creating the local group by name if it doesn't
   * exist yet), Freshdesk responder id -> local agent id (matched by email
   * against the agents already seeded for this tenant -- migration never
   * creates agents), and local ticket_type name -> id (Freshdesk's "type"
   * field is matched against ticket_types created ahead of time, per section
   * 9: "create matching ticket_types rows first").
   */
  async buildContext(
    tenantId: string,
    freshdeskGroups: FreshdeskGroup[],
    freshdeskAgents: FreshdeskAgent[],
  ): Promise<MigrationContext> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const groupIdByFreshdeskId = new Map<number, string>();
      for (const fdGroup of freshdeskGroups) {
        await queryRunner.query(
          `INSERT INTO groups (tenant_id, name) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [tenantId, fdGroup.name],
        );
        const [row] = await queryRunner.query(
          `SELECT id FROM groups WHERE tenant_id = $1 AND name = $2`,
          [tenantId, fdGroup.name],
        );
        if (row) groupIdByFreshdeskId.set(fdGroup.id, row.id);
      }

      const agentIdByFreshdeskResponderId = new Map<number, string>();
      for (const fdAgent of freshdeskAgents) {
        const [row] = await queryRunner.query(
          `SELECT a.id FROM agents a JOIN users u ON u.id = a.user_id WHERE a.tenant_id = $1 AND u.email = $2`,
          [tenantId, fdAgent.contact.email],
        );
        if (row) agentIdByFreshdeskResponderId.set(fdAgent.id, row.id);
      }

      const ticketTypeIdByName = new Map<string, string>();
      const ticketTypes = await queryRunner.query(
        `SELECT id, name FROM ticket_types WHERE tenant_id = $1`,
        [tenantId],
      );
      for (const tt of ticketTypes) ticketTypeIdByName.set(tt.name, tt.id);

      return {
        groupIdByFreshdeskId,
        agentIdByFreshdeskResponderId,
        ticketTypeIdByName,
      };
    });
  }

  /**
   * Imports one Freshdesk ticket (with its conversations) into this tenant.
   * Runs outside TicketsService.create() on purpose: a migrated ticket needs
   * to keep its original created_at/status/priority rather than have them
   * recomputed as if it were being created right now, and ticket numbering
   * still comes from the normal per-tenant counter (section 9: "the
   * tenant's new sequential numbering starts fresh alongside the migrated
   * ones") while legacy_ticket_number preserves the Freshdesk id so old
   * links/emails still resolve. Idempotent: re-running against a ticket
   * already imported (matched by legacy_ticket_number) is a no-op.
   */
  async importTicket(
    tenantId: string,
    ticket: FreshdeskTicket,
    context: MigrationContext,
  ): Promise<{
    imported: boolean;
    messagesImported: number;
    warnings: string[];
  }> {
    const warnings: string[] = [];
    let imported = false;
    let messagesImported = 0;

    await withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [existing] = await queryRunner.query(
        `SELECT id FROM tickets WHERE tenant_id = $1 AND legacy_ticket_number = $2`,
        [tenantId, ticket.id],
      );
      if (existing) {
        warnings.push(`ticket ${ticket.id} already imported, skipping`);
        return;
      }

      if (!ticket.requester?.email) {
        warnings.push(`ticket ${ticket.id} has no requester email, skipping`);
        return;
      }

      const [existingContact] = await queryRunner.query(
        `SELECT id FROM contacts WHERE tenant_id = $1 AND email = $2`,
        [tenantId, ticket.requester.email],
      );
      const contactId: string =
        existingContact?.id ??
        (
          await queryRunner.query(
            `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
            [
              tenantId,
              ticket.requester.name ?? ticket.requester.email,
              ticket.requester.email,
            ],
          )
        )[0].id;

      const ticketTypeId = ticket.type
        ? (context.ticketTypeIdByName.get(ticket.type) ?? null)
        : null;
      if (ticket.type && !ticketTypeId) {
        warnings.push(
          `ticket ${ticket.id}: no local ticket_type named "${ticket.type}", left unset`,
        );
      }

      const groupId = ticket.group_id
        ? (context.groupIdByFreshdeskId.get(ticket.group_id) ?? null)
        : null;
      const agentId = ticket.responder_id
        ? (context.agentIdByFreshdeskResponderId.get(ticket.responder_id) ??
          null)
        : null;
      if (ticket.responder_id && !agentId) {
        warnings.push(
          `ticket ${ticket.id}: responder_id ${ticket.responder_id} did not match a seeded agent, left unassigned`,
        );
      }

      const [{ next_value: ticketNumber }] = await queryRunner.query(
        `INSERT INTO ticket_number_counters (tenant_id, next_value) VALUES ($1, 2)
         ON CONFLICT (tenant_id) DO UPDATE SET next_value = ticket_number_counters.next_value + 1
         RETURNING next_value - 1 AS next_value`,
        [tenantId],
      );

      const status = STATUS_MAP[ticket.status] ?? 'new';
      const priority = PRIORITY_MAP[ticket.priority] ?? 'medium';
      const createdAt = new Date(ticket.created_at);
      const resolvedAt =
        status === 'resolved' || status === 'closed'
          ? new Date(ticket.updated_at)
          : null;

      // No "migrated" ticket_source_enum value exists (see the Sprint 1.1
      // migration) -- reusing 'api' is the closest fit without a schema
      // change nobody's confirmed the shape of yet.
      const [inserted] = await queryRunner.query(
        `INSERT INTO tickets (tenant_id, ticket_number, legacy_ticket_number, subject, contact_id, ticket_type_id, group_id, agent_id, status, priority, source, resolved_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'api', $11, $12, $12)
         RETURNING id`,
        [
          tenantId,
          ticketNumber,
          ticket.id,
          ticket.subject,
          contactId,
          ticketTypeId,
          groupId,
          agentId,
          status,
          priority,
          resolvedAt,
          createdAt,
        ],
      );

      for (const conv of ticket.conversations ?? []) {
        const authorType = conv.private
          ? 'system'
          : conv.incoming
            ? 'contact'
            : 'agent';
        await queryRunner.query(
          `INSERT INTO ticket_messages (tenant_id, ticket_id, type, author_type, body, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            tenantId,
            inserted.id,
            conv.private ? 'note' : 'reply',
            authorType,
            conv.body_text ?? '',
            new Date(conv.created_at),
          ],
        );
        messagesImported += 1;
        if (conv.attachments && conv.attachments.length > 0) {
          warnings.push(
            `ticket ${ticket.id}, conversation ${conv.id} has ${conv.attachments.length} attachment(s) -- attachment re-upload is not implemented (no object storage exists in this codebase yet); they were not migrated`,
          );
        }
      }

      if (ticket.attachments && ticket.attachments.length > 0) {
        warnings.push(
          `ticket ${ticket.id} has ${ticket.attachments.length} top-level attachment(s) -- not migrated, same object-storage gap as above`,
        );
      }

      imported = true;
    });

    for (const warning of warnings) this.logger.warn(warning);
    return { imported, messagesImported, warnings };
  }
}
