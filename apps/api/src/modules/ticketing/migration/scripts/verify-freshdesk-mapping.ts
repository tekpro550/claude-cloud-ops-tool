import 'dotenv/config';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { FreshdeskMigrationService } from '../freshdesk-migration.service';
import type {
  FreshdeskAgent,
  FreshdeskGroup,
  FreshdeskTicket,
} from '../freshdesk-client';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Freshdesk mapping verification FAILED: ${message}`);
  }
  console.log(`  OK  ${message}`);
}

function migratorClient() {
  return new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? 'cloud_ops_tool',
    user: process.env.DB_MIGRATOR_USER ?? 'postgres',
    password: process.env.DB_MIGRATOR_PASSWORD ?? 'postgres',
  });
}

/**
 * Exercises FreshdeskMigrationService against realistic mock Freshdesk API
 * payloads (shaped like the real /tickets, /groups, /agents responses) --
 * there are no real Freshdesk credentials to test the HTTP client
 * (FreshdeskClient) against, so this verifies the mapping/import logic in
 * isolation, which is the part that's actually risky to get wrong.
 */
async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  // Isolated storage dir so the attachment-migration path can be exercised
  // for real (data: URLs, no live Freshdesk account needed) without racing
  // whatever the running dev server's storage dir points at.
  const storageDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'freshdesk-mapping-verify-'),
  );
  process.env.ATTACHMENTS_STORAGE_DIR = storageDir;

  const slug = `freshdesk-mapping-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Freshdesk Mapping Verify', slug],
  );
  await migrator.query(
    `INSERT INTO ticket_types (tenant_id, name) VALUES ($1, $2)`,
    [tenant.id, 'Cloud Support'],
  );
  const {
    rows: [agentUser],
  } = await migrator.query(
    `INSERT INTO users (tenant_id, email, name, password_hash, role) VALUES ($1, $2, $3, 'x', 'agent') RETURNING id`,
    [tenant.id, 'agent@example.com', 'Agent Name'],
  );
  await migrator.query(
    `INSERT INTO agents (tenant_id, user_id) VALUES ($1, $2)`,
    [tenant.id, agentUser.id],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const migration = app.get(FreshdeskMigrationService);

  try {
    const mockGroups: FreshdeskGroup[] = [{ id: 501, name: 'Cloud Support' }];
    const mockAgents: FreshdeskAgent[] = [
      { id: 601, contact: { email: 'agent@example.com', name: 'Agent Name' } },
    ];

    const context = await migration.buildContext(
      tenant.id,
      mockGroups,
      mockAgents,
    );
    assert(
      context.groupIdByFreshdeskId.size === 1,
      'buildContext creates/maps the Freshdesk group by name',
    );
    assert(
      context.agentIdByFreshdeskResponderId.size === 1,
      'buildContext maps the Freshdesk agent to the seeded local agent by email',
    );
    assert(
      context.ticketTypeIdByName.has('Cloud Support'),
      'buildContext picks up the pre-seeded ticket type',
    );

    const ticket1: FreshdeskTicket = {
      id: 1001,
      subject: 'VPN not connecting',
      status: 2,
      priority: 3,
      type: 'Cloud Support - Azure',
      group_id: 501,
      responder_id: 601,
      requester_id: 9001,
      requester: { name: 'Jane Requester', email: 'jane@example.com' },
      created_at: '2026-01-15T10:00:00Z',
      updated_at: '2026-01-15T11:00:00Z',
      conversations: [
        {
          id: 1,
          body_text: 'Please help, VPN is down.',
          incoming: true,
          private: false,
          user_id: 9001,
          created_at: '2026-01-15T10:00:00Z',
        },
        {
          id: 2,
          body_text: 'Looking into it now.',
          incoming: false,
          private: false,
          user_id: 601,
          created_at: '2026-01-15T10:30:00Z',
        },
        {
          id: 3,
          body_text: 'Escalated to network team.',
          incoming: false,
          private: true,
          user_id: 601,
          created_at: '2026-01-15T10:45:00Z',
        },
      ],
    };

    const result1 = await migration.importTicket(tenant.id, ticket1, context);
    assert(result1.imported === true, 'a fully-mappable ticket is imported');
    assert(
      result1.messagesImported === 3,
      `all 3 conversations are imported as ticket_messages (got ${result1.messagesImported})`,
    );
    assert(
      result1.warnings.length === 0,
      `a fully-mappable ticket produces no warnings (got ${JSON.stringify(result1.warnings)})`,
    );

    const { rows: importedRows } = await migrator.query(
      `SELECT * FROM tickets WHERE tenant_id = $1 AND legacy_ticket_number = $2`,
      [tenant.id, ticket1.id],
    );
    const imported = importedRows[0];
    assert(
      imported.status === 'open',
      `Freshdesk status 2 maps to 'open' (got ${imported.status})`,
    );
    assert(
      imported.priority === 'high',
      `Freshdesk priority 3 maps to 'high' (got ${imported.priority})`,
    );
    assert(
      imported.ticket_number === 1,
      `the migrated ticket gets fresh sequential numbering, not the Freshdesk id (got ${imported.ticket_number})`,
    );
    assert(
      imported.legacy_ticket_number === 1001,
      'legacy_ticket_number preserves the original Freshdesk ticket id',
    );
    assert(
      imported.group_id !== null,
      'the group was resolved via the Freshdesk group id mapping',
    );
    assert(
      imported.agent_id !== null,
      'the responder was resolved via the email-matched agent mapping',
    );
    assert(
      imported.ticket_type_id !== null,
      'the ticket type was resolved by name',
    );
    assert(
      imported.platform === 'azure',
      `Freshdesk type "Cloud Support - Azure" splits into type "Cloud Support" + platform "azure" (got ${imported.platform})`,
    );
    assert(
      new Date(imported.created_at).toISOString() ===
        '2026-01-15T10:00:00.000Z',
      'created_at is preserved from Freshdesk, not set to import time',
    );

    const { rows: contactRows } = await migrator.query(
      `SELECT email FROM contacts WHERE id = $1`,
      [imported.contact_id],
    );
    assert(
      contactRows[0].email === 'jane@example.com',
      "the requester's email became the ticket's contact",
    );

    const { rows: messageRows } = await migrator.query(
      `SELECT type, author_type FROM ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [imported.id],
    );
    assert(
      messageRows[0].type === 'reply' &&
        messageRows[0].author_type === 'contact',
      'an incoming, non-private conversation maps to a contact reply',
    );
    assert(
      messageRows[1].type === 'reply' && messageRows[1].author_type === 'agent',
      'an outgoing, non-private conversation maps to an agent reply',
    );
    assert(
      messageRows[2].type === 'note' && messageRows[2].author_type === 'system',
      'a private conversation maps to a system note',
    );

    const reimport = await migration.importTicket(tenant.id, ticket1, context);
    assert(
      reimport.imported === false,
      're-importing the same Freshdesk ticket id is a no-op (idempotent)',
    );
    assert(
      reimport.warnings.some((w) => w.includes('already imported')),
      "the re-import produces an 'already imported' warning",
    );

    const ticket2: FreshdeskTicket = {
      id: 1002,
      subject: 'No requester on file',
      status: 3,
      priority: 1,
      type: null,
      group_id: null,
      responder_id: null,
      requester_id: 9002,
      requester: null,
      created_at: '2026-01-16T09:00:00Z',
      updated_at: '2026-01-16T09:00:00Z',
    };
    const result2 = await migration.importTicket(tenant.id, ticket2, context);
    assert(
      result2.imported === false,
      'a ticket with no requester email is skipped, not imported with a broken contact',
    );
    assert(
      result2.warnings.some((w) => w.includes('no requester email')),
      'skipping a ticket with no requester produces an explanatory warning',
    );

    const ticket3: FreshdeskTicket = {
      id: 1003,
      subject: 'Unmapped type/group/agent, but has a requester',
      status: 4,
      priority: 2,
      type: 'Some Type Nobody Pre-Created',
      group_id: 999,
      responder_id: 888,
      requester_id: 9003,
      requester: { name: 'Bob Requester', email: 'bob@example.com' },
      created_at: '2026-01-17T09:00:00Z',
      updated_at: '2026-01-17T12:00:00Z',
      conversations: [
        {
          id: 4,
          body_text: 'Has an attachment',
          incoming: true,
          private: false,
          user_id: 9003,
          created_at: '2026-01-17T09:00:00Z',
          // A data: URL stands in for Freshdesk's real (pre-signed S3)
          // attachment_url -- decodes to "hello world", 11 bytes -- so the
          // download+re-upload path is exercised for real, with no live
          // Freshdesk account needed.
          attachments: [
            {
              id: 1,
              name: 'log.txt',
              size: 11,
              attachment_url: 'data:text/plain;base64,aGVsbG8gd29ybGQ=',
            },
          ],
        },
      ],
      // A deliberately unreachable URL, to prove one failed attachment
      // produces a warning instead of aborting the whole ticket import.
      attachments: [
        {
          id: 2,
          name: 'unreachable.txt',
          size: 5,
          attachment_url: 'https://attachments.invalid.example/nope.txt',
        },
      ],
    };
    const result3 = await migration.importTicket(tenant.id, ticket3, context);
    assert(
      result3.imported === true,
      'a ticket with an unmapped type/group/agent still imports, just with those fields left unset',
    );
    assert(
      result3.warnings.some((w) =>
        w.includes('no local ticket_type named "Some Type Nobody Pre-Created"'),
      ),
      'an unmapped type produces a warning naming the missing local ticket_type',
    );
    assert(
      result3.warnings.some((w) => w.includes('did not match a seeded agent')),
      'an unmapped responder_id produces a warning rather than failing',
    );
    const {
      rows: [ticket3Ticket],
    } = await migrator.query(
      `SELECT id FROM tickets WHERE tenant_id = $1 AND legacy_ticket_number = $2`,
      [tenant.id, ticket3.id],
    );
    const { rows: migratedAttachments } = await migrator.query(
      `SELECT a.file_name, a.file_size_bytes, a.storage_path FROM ticket_attachments a
       JOIN ticket_messages m ON m.id = a.ticket_message_id
       WHERE m.ticket_id = $1`,
      [ticket3Ticket.id],
    );
    assert(
      migratedAttachments.length === 1 &&
        migratedAttachments[0].file_name === 'log.txt',
      `a conversation attachment is actually downloaded and re-uploaded, not just logged as unmigrated (got ${migratedAttachments.length} row(s))`,
    );
    const onDiskContents = await fs.readFile(
      path.join(storageDir, migratedAttachments[0].storage_path),
      'utf8',
    );
    assert(
      onDiskContents === 'hello world',
      'the re-uploaded file on disk has the exact original bytes',
    );
    assert(
      result3.warnings.some(
        (w) => w.includes('unreachable.txt') && w.includes('failed to migrate'),
      ),
      'a top-level attachment whose URL fails to download produces a warning instead of aborting the ticket import',
    );

    const {
      rows: [ticket3Row],
    } = await migrator.query(
      `SELECT ticket_number, status, group_id, agent_id, ticket_type_id FROM tickets WHERE tenant_id = $1 AND legacy_ticket_number = $2`,
      [tenant.id, ticket3.id],
    );
    assert(
      ticket3Row.ticket_number === 2,
      `ticket numbering continues sequentially across imports (got ${ticket3Row.ticket_number})`,
    );
    assert(
      ticket3Row.status === 'resolved',
      `Freshdesk status 4 maps to 'resolved' (got ${ticket3Row.status})`,
    );
    assert(
      ticket3Row.group_id === null &&
        ticket3Row.agent_id === null &&
        ticket3Row.ticket_type_id === null,
      'unmapped group/agent/type were left null rather than guessed at',
    );

    console.log('\nAll Freshdesk mapping checks passed.');
  } finally {
    await migrator.query(`DELETE FROM ticket_messages WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM tickets WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(
      `DELETE FROM ticket_number_counters WHERE tenant_id = $1`,
      [tenant.id],
    );
    await migrator.query(`DELETE FROM ticket_types WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM groups WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM contacts WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM agents WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM users WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
    await migrator.end();
    await app.close();
    await fs.rm(storageDir, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
