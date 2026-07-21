import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { sanitizeTicketBody } from '../sanitize-html';
import { LocalDiskStorage } from '../attachments/object-storage';
import {
  FreshdeskAgent,
  FreshdeskAttachment,
  FreshdeskClient,
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

/**
 * Freshdesk's "type" field packs a category and a cloud provider into one
 * string (e.g. "Cloud Support - Azure"), which is why the old Freshdesk
 * ticket_types list had ~30 entries -- one per category-provider pair. The
 * standardized taxonomy splits that into a single category name plus
 * tickets.platform, so migration needs to reverse-split every known
 * Freshdesk value here. Anything not in this table falls back to using the
 * raw string as the type name with no platform, and importTicket() warns so
 * it doesn't silently lose data on a value nobody's seen yet.
 */
const FRESHDESK_TYPE_MAP: Record<
  string,
  { typeName: string; platform: string | null }
> = {
  'Cloud Support - Azure': { typeName: 'Cloud Support', platform: 'azure' },
  'Cloud Support - AWS': { typeName: 'Cloud Support', platform: 'aws' },
  'Cloud Support - Alibaba': {
    typeName: 'Cloud Support',
    platform: 'alibaba_cloud',
  },
  'Cloud Support - Others': { typeName: 'Cloud Support', platform: 'other' },
  'M365 Support - Microsoft': {
    typeName: 'Cloud Support',
    platform: 'microsoft_365',
  },
  'Support - Tittu Marketing Platform': {
    typeName: 'Platform Support',
    platform: 'tittu_marketing_platform',
  },
  'Cloud Estimate': { typeName: 'Cloud Estimate', platform: null },
  'Cloud POC - AWS': { typeName: 'Cloud POC', platform: 'aws' },
  'Cloud POC - Azure': { typeName: 'Cloud POC', platform: 'azure' },
  'Cloud POC - Other': { typeName: 'Cloud POC', platform: 'other' },
  Development: { typeName: 'Development', platform: null },
  'Tittu New Features - Development': {
    typeName: 'Development',
    platform: 'tittu_marketing_platform',
  },
  'Cloud Project - AWS': { typeName: 'Cloud Project', platform: 'aws' },
  'Cloud Project - Azure': { typeName: 'Cloud Project', platform: 'azure' },
  'Cloud Project - Others': { typeName: 'Cloud Project', platform: 'other' },
  'Cloud Project - Alibaba': {
    typeName: 'Cloud Project',
    platform: 'alibaba_cloud',
  },
  'Devops Project': { typeName: 'DevOps Project', platform: null },
  'Cloud Account Setup - AWS': {
    typeName: 'Account/Tenant Setup',
    platform: 'aws',
  },
  'Cloud Account Setup - Azure': {
    typeName: 'Account/Tenant Setup',
    platform: 'azure',
  },
  'Cloud Account Setup - Alibaba': {
    typeName: 'Account/Tenant Setup',
    platform: 'alibaba_cloud',
  },
  'M365 Tenant Setup - Microsoft': {
    typeName: 'Account/Tenant Setup',
    platform: 'microsoft_365',
  },
  'Cloud Billing': { typeName: 'Billing', platform: null },
  Training: { typeName: 'Training', platform: null },
  'Cloud Migration': { typeName: 'Migration', platform: null },
  'M365 Migration': { typeName: 'Migration', platform: 'microsoft_365' },
  'Cloud Audit - Azure': { typeName: 'Audit', platform: 'azure' },
  'Cloud Audit - AWS': { typeName: 'Audit', platform: 'aws' },
  'Cloud Audit - Other': { typeName: 'Audit', platform: 'other' },
  Reports: { typeName: 'Reports', platform: null },
  'WAP APP Setup': { typeName: 'App Setup', platform: null },
  'EMP APP Setup': { typeName: 'App Setup', platform: null },
};

function resolveFreshdeskType(rawType: string): {
  typeName: string;
  platform: string | null;
} {
  return FRESHDESK_TYPE_MAP[rawType] ?? { typeName: rawType, platform: null };
}

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

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly freshdeskClient: FreshdeskClient,
    private readonly storage: LocalDiskStorage,
  ) {}

  /**
   * Downloads one Freshdesk attachment's bytes. Network-only, no DB access,
   * so callers can run many of these concurrently (Promise.all) without
   * touching the single-connection queryRunner -- node-postgres doesn't
   * support concurrent queries on one client, so the download (slow,
   * network-bound) and the eventual INSERT (fast, local) must stay separate.
   * Failures (a since-expired attachment_url, a network blip) are caught and
   * turned into a warning rather than aborting the whole ticket import --
   * losing one attachment shouldn't lose the rest of a ticket's history.
   */
  private async downloadAttachment(
    attachment: FreshdeskAttachment,
    warnings: string[],
  ): Promise<Buffer | null> {
    try {
      return await this.freshdeskClient.downloadAttachment(
        attachment.attachment_url,
      );
    } catch (err) {
      warnings.push(
        `attachment "${attachment.name}" (Freshdesk id ${attachment.id}) failed to migrate: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Writes an already-downloaded attachment to local storage and inserts its
   * ticket_attachments row. `messageId` is null for a ticket-level
   * attachment (e.g. one on the original description, not any specific
   * conversation) -- ticket_id is always set, so the row never has to lie
   * about being attached to a message it wasn't actually part of.
   */
  private async persistAttachment(
    queryRunner: QueryRunner,
    tenantId: string,
    ticketId: string,
    messageId: string | null,
    attachment: FreshdeskAttachment,
    buffer: Buffer,
  ): Promise<void> {
    const storagePath = await this.storage.save(buffer, attachment.name);
    await queryRunner.query(
      `INSERT INTO ticket_attachments (tenant_id, ticket_id, ticket_message_id, file_name, file_size_bytes, storage_path)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        tenantId,
        ticketId,
        messageId,
        attachment.name,
        attachment.size,
        storagePath,
      ],
    );
  }

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

      const resolvedType = ticket.type
        ? resolveFreshdeskType(ticket.type)
        : null;
      const ticketTypeId = resolvedType
        ? (context.ticketTypeIdByName.get(resolvedType.typeName) ?? null)
        : null;
      const platform = resolvedType?.platform ?? null;
      if (ticket.type && !ticketTypeId) {
        warnings.push(
          `ticket ${ticket.id}: no local ticket_type named "${resolvedType?.typeName}" (mapped from Freshdesk type "${ticket.type}"), left unset`,
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
        `INSERT INTO tickets (tenant_id, ticket_number, legacy_ticket_number, subject, contact_id, ticket_type_id, group_id, agent_id, status, priority, source, resolved_at, created_at, updated_at, platform)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'api', $11, $12, $12, $13)
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
          platform,
        ],
      );

      const attachmentJobs: {
        messageId: string | null;
        attachment: FreshdeskAttachment;
      }[] = [];
      for (const conv of ticket.conversations ?? []) {
        const authorType = conv.private
          ? 'system'
          : conv.incoming
            ? 'contact'
            : 'agent';
        const [message] = await queryRunner.query(
          `INSERT INTO ticket_messages (tenant_id, ticket_id, type, author_type, body, created_at)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [
            tenantId,
            inserted.id,
            conv.private ? 'note' : 'reply',
            authorType,
            // Imported bodies render via dangerouslySetInnerHTML like every
            // other message, so they must pass the same sanitizer as
            // addMessage — historical Freshdesk data is untrusted input.
            sanitizeTicketBody(conv.body_text ?? ''),
            new Date(conv.created_at),
          ],
        );
        messagesImported += 1;

        for (const attachment of conv.attachments ?? []) {
          attachmentJobs.push({ messageId: message.id, attachment });
        }
      }

      // Attachments on the ticket itself (not tied to any conversation --
      // typically ones added on the original description) are tied directly
      // to the ticket (ticket_message_id left null) rather than attributed
      // to whichever conversation happened to import first.
      for (const attachment of ticket.attachments ?? []) {
        attachmentJobs.push({ messageId: null, attachment });
      }

      // Downloads are network-bound and safe to run concurrently (no DB
      // access); the resulting inserts must stay sequential since
      // queryRunner is a single connection that can't run concurrent
      // queries. Splitting these two steps keeps the transaction open for
      // roughly the slowest single download instead of the sum of all of
      // them.
      const downloaded = await Promise.all(
        attachmentJobs.map(async (job) => ({
          ...job,
          buffer: await this.downloadAttachment(job.attachment, warnings),
        })),
      );
      for (const job of downloaded) {
        if (!job.buffer) continue;
        await this.persistAttachment(
          queryRunner,
          tenantId,
          inserted.id,
          job.messageId,
          job.attachment,
          job.buffer,
        );
      }

      imported = true;
    });

    for (const warning of warnings) this.logger.warn(warning);
    return { imported, messagesImported, warnings };
  }
}
