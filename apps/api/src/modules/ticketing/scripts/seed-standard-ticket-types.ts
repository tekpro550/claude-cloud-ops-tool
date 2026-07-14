import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../../app.module';
import { TicketTypesService } from '../ticket-types.service';

/**
 * The standardized ticket type taxonomy, replacing the ~30 provider-specific
 * Freshdesk values (e.g. "Cloud Support - Azure", "Cloud Support - AWS") with
 * one type per kind of work. Which cloud provider a ticket involves is now
 * captured separately via tickets.platform, so this list doesn't need a
 * per-provider entry for every category.
 */
const STANDARD_TICKET_TYPES = [
  'Cloud Support',
  'Platform Support',
  'Cloud Estimate',
  'Cloud POC',
  'Development',
  'Cloud Project',
  'DevOps Project',
  'Account/Tenant Setup',
  'App Setup',
  'Migration',
  'Audit',
  'Billing',
  'Training',
  'Reports',
];

/**
 * Idempotent: skips any name that already exists for the tenant, so it's
 * safe to re-run after manually adding/renaming types via the admin UI.
 *
 * Usage: SEED_TENANT_ID=<uuid> pnpm ticket-types:seed-standard
 */
async function main() {
  const tenantId = process.env.SEED_TENANT_ID;
  if (!tenantId) {
    throw new Error(
      'SEED_TENANT_ID is required (the tenant to seed ticket types into)',
    );
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const ticketTypes = app.get(TicketTypesService);

  try {
    const existing = await ticketTypes.list(tenantId);
    const existingNames = new Set(
      existing.map((t: { name: string }) => t.name),
    );

    let created = 0;
    let skipped = 0;
    for (const name of STANDARD_TICKET_TYPES) {
      if (existingNames.has(name)) {
        console.log(`  skip  ${name} (already exists)`);
        skipped += 1;
        continue;
      }
      await ticketTypes.create(tenantId, { name });
      console.log(`  add   ${name}`);
      created += 1;
    }

    console.log(`\nDone. ${created} created, ${skipped} already present.`);
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
