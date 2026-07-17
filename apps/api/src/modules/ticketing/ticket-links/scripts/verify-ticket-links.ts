import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { TicketsService } from '../../tickets.service';
import { TicketLinksService } from '../ticket-links.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Ticket links verification FAILED: ${message}`);
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

async function main() {
  const migrator = migratorClient();
  await migrator.connect();
  const slug = `links-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Links Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Links Contact', 'links@example.com'],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const tickets = app.get(TicketsService);
  const links = app.get(TicketLinksService);

  const mk = (subject: string) =>
    tickets.create(tenant.id, {
      subject,
      contactId: contact.id,
      source: 'web_form',
    });

  try {
    const a = await mk('Ticket A');
    const b = await mk('Ticket B');
    const c = await mk('Ticket C');

    await links.create(tenant.id, a.id, {
      toTicketNumber: b.ticket_number,
      linkType: 'related',
    });
    await links.create(tenant.id, a.id, {
      toTicketNumber: c.ticket_number,
      linkType: 'parent_of',
    });

    const aLinks = await links.list(tenant.id, a.id);
    assert(aLinks.length === 2, 'A has two links');
    const related = aLinks.find((l) => l.relation === 'related');
    const child = aLinks.find((l) => l.relation === 'child');
    assert(related?.ticketNumber === b.ticket_number, 'A is related to B');
    assert(child?.ticketNumber === c.ticket_number, 'C shows as a child of A');

    // From C's point of view, A is its parent.
    const cLinks = await links.list(tenant.id, c.id);
    assert(
      cLinks.length === 1 &&
        cLinks[0].relation === 'parent' &&
        cLinks[0].ticketNumber === a.ticket_number,
      'C sees A as its parent (inverse direction resolves correctly)',
    );

    // child_of is stored as the inverse parent_of edge.
    await links.create(tenant.id, b.id, {
      toTicketNumber: a.ticket_number,
      linkType: 'child_of',
    });
    const bLinks = await links.list(tenant.id, b.id);
    const bParent = bLinks.find((l) => l.relation === 'parent');
    assert(
      bParent?.ticketNumber === a.ticket_number,
      "'child_of' makes A the parent of B",
    );

    // Self-link and duplicate are rejected.
    let threw = false;
    try {
      await links.create(tenant.id, a.id, {
        toTicketNumber: a.ticket_number,
        linkType: 'related',
      });
    } catch {
      threw = true;
    }
    assert(threw, 'a self-link is rejected');

    // Remove one link.
    await links.remove(tenant.id, related!.linkId);
    const afterRemove = await links.list(tenant.id, a.id);
    assert(
      !afterRemove.some((l) => l.linkId === related!.linkId),
      'remove() deletes the link',
    );

    console.log('\nAll ticket links checks passed.');
  } finally {
    await migrator.query(`DELETE FROM ticket_links WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM ticket_messages WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM ticket_activities WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM tickets WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(
      `DELETE FROM ticket_number_counters WHERE tenant_id = $1`,
      [tenant.id],
    );
    await migrator.query(`DELETE FROM contacts WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
    await migrator.end();
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
