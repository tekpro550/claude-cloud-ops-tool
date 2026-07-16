import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { BusinessHoursSettingsService } from '../../business-hours-settings.service';
import { TicketsService } from '../../tickets.service';
import { addBusinessMinutes, BusinessHours } from '../business-hours';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Business hours verification FAILED: ${message}`);
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

const UTC_9_5: BusinessHours = {
  startMinute: 9 * 60,
  endMinute: 17 * 60,
  days: [1, 2, 3, 4, 5],
  timezone: 'UTC',
};

function iso(d: Date): string {
  return d.toISOString();
}

async function main() {
  // --- Pure addBusinessMinutes cases (deterministic, UTC 09:00-17:00 Mon-Fri) ---
  // Wed 2026-07-15 10:00Z + 120 min -> same day 12:00Z.
  assert(
    iso(addBusinessMinutes(new Date('2026-07-15T10:00:00Z'), 120, UTC_9_5)) ===
      '2026-07-15T12:00:00.000Z',
    'within a working day, business minutes are plain elapsed minutes',
  );
  // Fri 2026-07-17 16:00Z + 120 min -> 60 min left Fri, then Mon 09:00 + 60 = Mon 10:00Z.
  assert(
    iso(addBusinessMinutes(new Date('2026-07-17T16:00:00Z'), 120, UTC_9_5)) ===
      '2026-07-20T10:00:00.000Z',
    'a target that overruns Friday close resumes Monday morning (skips the weekend)',
  );
  // Sat 2026-07-18 12:00Z + 60 min -> Mon 09:00 + 60 = Mon 10:00Z.
  assert(
    iso(addBusinessMinutes(new Date('2026-07-18T12:00:00Z'), 60, UTC_9_5)) ===
      '2026-07-20T10:00:00.000Z',
    'a ticket created on a non-working day starts its clock at the next working day open',
  );
  // Mon 2026-07-20 07:00Z (before open) + 60 min -> Mon 09:00 + 60 = Mon 10:00Z.
  assert(
    iso(addBusinessMinutes(new Date('2026-07-20T07:00:00Z'), 60, UTC_9_5)) ===
      '2026-07-20T10:00:00.000Z',
    'a ticket created before open starts its clock at open, not immediately',
  );

  // --- Timezone handling: Asia/Kolkata (+5:30, no DST) ---
  const kolkata: BusinessHours = { ...UTC_9_5, timezone: 'Asia/Kolkata' };
  // 2026-07-15 is a Wed. Kolkata 09:00 == 03:30Z. Anchor at 03:00Z (before
  // open, 08:30 local) + 60 min -> 09:00 local + 60 = 10:00 local == 04:30Z.
  assert(
    iso(addBusinessMinutes(new Date('2026-07-15T03:00:00Z'), 60, kolkata)) ===
      '2026-07-15T04:30:00.000Z',
    'business hours are evaluated in the tenant timezone, not UTC',
  );

  // --- End-to-end through the ticket SLA calc + settings service ---
  const migrator = migratorClient();
  await migrator.connect();
  const slug = `business-hours-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Business Hours Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'BH Contact', 'bh@example.com'],
  );
  // A business_hours_only SLA policy: 120-min first response, 480-min resolution.
  const {
    rows: [policy],
  } = await migrator.query(
    `INSERT INTO sla_policies (tenant_id, name, first_response_target_minutes, resolution_target_minutes, business_hours_only)
     VALUES ($1, 'BH Policy', 120, 480, true) RETURNING id`,
    [tenant.id],
  );
  const {
    rows: [ticketType],
  } = await migrator.query(
    `INSERT INTO ticket_types (tenant_id, name, default_sla_policy_id) VALUES ($1, 'BH Type', $2) RETURNING id`,
    [tenant.id, policy.id],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const settings = app.get(BusinessHoursSettingsService);
  const tickets = app.get(TicketsService);

  try {
    // Default business hours came from the migration.
    const defaults = await settings.get(tenant.id);
    assert(
      defaults.startMinute === 540 &&
        defaults.endMinute === 1020 &&
        defaults.timezone === 'UTC',
      'a new tenant defaults to Mon-Fri 09:00-17:00 UTC business hours',
    );

    // A bogus timezone is rejected.
    let rejected = false;
    try {
      await settings.update(tenant.id, { timezone: 'Mars/Olympus' });
    } catch {
      rejected = true;
    }
    assert(rejected, 'an invalid IANA timezone is rejected (400), not stored');

    const ticket = await tickets.create(tenant.id, {
      subject: 'Weekend ticket',
      contactId: contact.id,
      ticketTypeId: ticketType.id,
      source: 'web_form',
    });
    const created = new Date(ticket.created_at);
    const firstDue = new Date(ticket.first_response_due_at);

    // The due date must never be inside the weekend, and (for a
    // business-hours policy) never more than the flat elapsed time away.
    const day = firstDue.getUTCDay();
    assert(
      day !== 0 && day !== 6,
      `first-response due date falls on a working day (got weekday ${day})`,
    );
    const flatDue = new Date(created.getTime() + 120 * 60_000);
    assert(
      firstDue.getTime() >= flatDue.getTime(),
      'business-hours due date is never earlier than the flat-elapsed equivalent',
    );
    const withinWindow =
      firstDue.getUTCHours() * 60 + firstDue.getUTCMinutes() >= 540 &&
      firstDue.getUTCHours() * 60 + firstDue.getUTCMinutes() <= 1020;
    assert(
      withinWindow,
      'first-response due date lands inside the 09:00-17:00 working window',
    );

    console.log('\nAll business hours checks passed.');
  } finally {
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
    await migrator.query(`DELETE FROM sla_policies WHERE tenant_id = $1`, [
      tenant.id,
    ]);
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
