import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { conditionMatches } from '../automation/automation-rules.service';
import { TicketsService } from '../tickets.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Ticket tags verification FAILED: ${message}`);
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
  // --- Pure automation matching on the tags array ---
  const ticketLike = { tags: ['billing', 'urgent-followup'] };
  assert(
    conditionMatches(ticketLike, {
      field: 'tags',
      operator: 'equals',
      value: 'billing',
    }),
    "conditionMatches: 'equals' matches an exact tag in the array",
  );
  assert(
    !conditionMatches(ticketLike, {
      field: 'tags',
      operator: 'equals',
      value: 'bill',
    }),
    "conditionMatches: 'equals' does not match a partial tag",
  );
  assert(
    conditionMatches(ticketLike, {
      field: 'tags',
      operator: 'contains',
      value: 'follow',
    }),
    "conditionMatches: 'contains' matches a substring of any tag",
  );
  assert(
    !conditionMatches(
      { tags: [] },
      {
        field: 'tags',
        operator: 'contains',
        value: 'x',
      },
    ),
    'conditionMatches: an empty tag array matches nothing',
  );

  const migrator = migratorClient();
  await migrator.connect();
  const slug = `ticket-tags-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Ticket Tags Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Tag Contact', 'tag@example.com'],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const tickets = app.get(TicketsService);

  try {
    // Create with tags.
    const created = await tickets.create(tenant.id, {
      subject: 'Tagged ticket',
      contactId: contact.id,
      source: 'web_form',
      tags: ['billing', 'aws'],
    });
    assert(
      Array.isArray(created.tags) &&
        created.tags.includes('billing') &&
        created.tags.includes('aws'),
      'create() persists the tags array',
    );

    // Update normalizes: trims, de-dupes, drops empties.
    const updated = await tickets.update(tenant.id, created.id, {
      tags: ['  billing  ', 'billing', 'network', ''],
    });
    const sorted = [...updated.tags].sort();
    assert(
      sorted.length === 2 && sorted[0] === 'billing' && sorted[1] === 'network',
      'update() trims, de-duplicates, and drops empty tags',
    );

    // A second ticket with an overlapping tag, for the filter + distinct check.
    await tickets.create(tenant.id, {
      subject: 'Second tagged ticket',
      contactId: contact.id,
      source: 'web_form',
      tags: ['network', 'azure'],
    });

    // List filter by tag returns only tickets carrying that tag.
    const networkList = await tickets.list(tenant.id, {
      tag: 'network',
      limit: 25,
      offset: 0,
    });
    assert(
      networkList.total === 2,
      'list({ tag }) returns every ticket carrying that tag',
    );
    const billingList = await tickets.list(tenant.id, {
      tag: 'billing',
      limit: 25,
      offset: 0,
    });
    assert(
      billingList.total === 1,
      'list({ tag }) excludes tickets without the tag',
    );

    // Distinct tags are sorted and de-duplicated across tickets. Ticket 1 was
    // updated to ['billing','network'] (dropping 'aws'), ticket 2 is
    // ['network','azure'] -- so the union is these three, sorted.
    const distinct = await tickets.distinctTags(tenant.id);
    assert(
      JSON.stringify(distinct) ===
        JSON.stringify(['azure', 'billing', 'network']),
      'distinctTags() returns the sorted, de-duplicated tag set',
    );

    console.log('\nAll ticket tags checks passed.');
  } finally {
    await migrator.query(`DELETE FROM ticket_activities WHERE tenant_id = $1`, [
      tenant.id,
    ]);
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
