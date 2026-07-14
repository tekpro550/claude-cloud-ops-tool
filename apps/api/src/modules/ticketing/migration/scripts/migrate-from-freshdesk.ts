import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../../app.module';
import { FreshdeskClient } from '../freshdesk-client';
import { FreshdeskMigrationService } from '../freshdesk-migration.service';

/**
 * Runs the actual Freshdesk -> Cloud Ops Tool migration for one tenant, per
 * section 9 of the Module 1 doc. Requires real credentials
 * (FRESHDESK_DOMAIN, FRESHDESK_API_KEY) and a target tenant id
 * (MIGRATION_TENANT_ID) -- none of which exist yet, so this has not been run
 * against a live account. Idempotent (importTicket skips anything already
 * imported by legacy_ticket_number), so it's safe to re-run after a partial
 * failure or to pick up new tickets created in Freshdesk since the last run.
 *
 * Usage: MIGRATION_TENANT_ID=<uuid> FRESHDESK_DOMAIN=tekprocloud FRESHDESK_API_KEY=... pnpm migrate:freshdesk
 */
async function main() {
  const tenantId = process.env.MIGRATION_TENANT_ID;
  if (!tenantId) {
    throw new Error(
      'MIGRATION_TENANT_ID is required (the Cloud Ops Tool tenant to import into)',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const client = app.get(FreshdeskClient);
  const migration = app.get(FreshdeskMigrationService);

  try {
    console.log('Fetching Freshdesk groups and agents...');
    const [groups, agents] = await Promise.all([
      client.fetchGroups(),
      client.fetchAgents(),
    ]);
    const context = await migration.buildContext(tenantId, groups, agents);
    console.log(
      `Mapped ${context.groupIdByFreshdeskId.size}/${groups.length} groups, ${context.agentIdByFreshdeskResponderId.size}/${agents.length} agents by email, ${context.ticketTypeIdByName.size} local ticket types available.`,
    );

    let ticketsImported = 0;
    let ticketsSkipped = 0;
    let messagesImported = 0;
    const allWarnings: string[] = [];

    for await (const page of client.fetchAllTickets()) {
      for (const ticket of page) {
        const result = await migration.importTicket(tenantId, ticket, context);
        if (result.imported) {
          ticketsImported += 1;
          messagesImported += result.messagesImported;
        } else {
          ticketsSkipped += 1;
        }
        allWarnings.push(...result.warnings);
      }
      console.log(
        `... ${ticketsImported} imported, ${ticketsSkipped} skipped so far`,
      );
    }

    console.log(
      `\nDone. ${ticketsImported} tickets imported, ${messagesImported} messages, ${ticketsSkipped} tickets skipped.`,
    );
    if (allWarnings.length > 0) {
      console.log(`\n${allWarnings.length} warning(s):`);
      for (const w of allWarnings) console.log(`  - ${w}`);
    }
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
