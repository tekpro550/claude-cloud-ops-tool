import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { TicketsService } from '../tickets.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Ticket merge verification FAILED: ${message}`);
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
  const slug = `merge-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Merge Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Merge Contact', 'merge@example.com'],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const tickets = app.get(TicketsService);

  try {
    const primary = await tickets.create(tenant.id, {
      subject: 'Primary ticket',
      contactId: contact.id,
      source: 'web_form',
    });
    const dupe = await tickets.create(tenant.id, {
      subject: 'Duplicate ticket',
      contactId: contact.id,
      source: 'web_form',
    });
    await tickets.addMessage(tenant.id, dupe.id, {
      type: 'reply',
      authorType: 'contact',
      body: 'A reply that lives on the duplicate.',
    });

    await tickets.merge(tenant.id, primary.id, [dupe.id]);

    const closedDupe = await tickets.get(tenant.id, dupe.id);
    assert(closedDupe.status === 'closed', 'the merged source is closed');
    assert(
      closedDupe.merged_into_id === primary.id,
      'the source points at the primary via merged_into_id',
    );

    const primaryMessages = await tickets.listMessages(tenant.id, primary.id);
    const carried = primaryMessages.find((m: { body: string }) =>
      m.body.includes('lives on the duplicate'),
    );
    assert(!!carried, "the duplicate's conversation is carried to the primary");
    const mergeNote = primaryMessages.find((m: { body: string }) =>
      m.body.startsWith('Merged in ticket(s):'),
    );
    assert(!!mergeNote, 'the primary gets a system note listing the merge');

    const dupeMessages = await tickets.listMessages(tenant.id, dupe.id);
    const dupeNote = dupeMessages.find((m: { body: string }) =>
      m.body.includes('was merged into'),
    );
    assert(!!dupeNote, 'the source gets a system note pointing at the primary');

    // Merging an already-merged ticket is a no-op, not a double-carry.
    await tickets.merge(tenant.id, primary.id, [dupe.id]);
    const afterMessages = await tickets.listMessages(tenant.id, primary.id);
    const carriedCount = afterMessages.filter((m: { body: string }) =>
      m.body.includes('lives on the duplicate'),
    ).length;
    assert(carriedCount === 1, 're-merging an already-merged source is a no-op');

    console.log('\nAll ticket merge checks passed.');
  } finally {
    await migrator.query(`DELETE FROM ticket_messages WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM ticket_activities WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`UPDATE tickets SET merged_into_id = NULL WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM tickets WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM ticket_number_counters WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM contacts WHERE tenant_id = $1`, [tenant.id]);
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
