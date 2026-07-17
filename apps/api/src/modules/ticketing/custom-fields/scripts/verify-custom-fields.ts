import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { validateCustomFields, CustomFieldDef } from '../custom-field-validate';
import { CustomFieldsService } from '../custom-fields.service';
import { TicketsService } from '../../tickets.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Custom fields verification FAILED: ${message}`);
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

const defs: CustomFieldDef[] = [
  {
    key: 'severity',
    label: 'Severity',
    field_type: 'dropdown',
    options: ['low', 'high'],
    is_required: true,
    is_active: true,
  },
  {
    key: 'cost_center',
    label: 'Cost center',
    field_type: 'text',
    options: [],
    is_required: false,
    is_active: true,
  },
  {
    key: 'seats',
    label: 'Seats',
    field_type: 'number',
    options: [],
    is_required: false,
    is_active: true,
  },
  {
    key: 'vip',
    label: 'VIP',
    field_type: 'checkbox',
    options: [],
    is_required: false,
    is_active: true,
  },
  {
    key: 'due',
    label: 'Due',
    field_type: 'date',
    options: [],
    is_required: false,
    is_active: true,
  },
  {
    key: 'legacy',
    label: 'Legacy',
    field_type: 'text',
    options: [],
    is_required: false,
    is_active: false,
  },
];

async function main() {
  // --- Pure validator ---
  const ok = validateCustomFields(defs, {
    severity: 'high',
    seats: '5',
    vip: 'true',
    due: '2026-08-01',
    legacy: 'ignored',
    unknown_key: 'dropped',
  });
  assert(ok.severity === 'high', 'dropdown accepts a valid option');
  assert(ok.seats === 5, 'number is coerced to a number');
  assert(ok.vip === true, 'checkbox coerces "true" to boolean true');
  assert(ok.due === '2026-08-01', 'date passes YYYY-MM-DD');
  assert(!('legacy' in ok), 'inactive field defs are ignored');
  assert(!('unknown_key' in ok), 'unknown keys are dropped');

  let threw = false;
  try {
    validateCustomFields(defs, { seats: '3' });
  } catch {
    threw = true;
  }
  assert(threw, 'a missing required field throws');

  threw = false;
  try {
    validateCustomFields(defs, { severity: 'nope' });
  } catch {
    threw = true;
  }
  assert(threw, 'a dropdown value outside the options throws');

  threw = false;
  try {
    validateCustomFields(defs, { severity: 'low', seats: 'abc' });
  } catch {
    threw = true;
  }
  assert(threw, 'a non-numeric number value throws');

  // --- End-to-end through TicketsService ---
  const migrator = migratorClient();
  await migrator.connect();
  const slug = `custom-fields-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Custom Fields Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'CF Contact', 'cf@example.com'],
  );
  await migrator.query(
    `INSERT INTO ticket_custom_field_defs (tenant_id, key, label, field_type, options, is_required)
     VALUES ($1, 'severity', 'Severity', 'dropdown', ARRAY['low','high'], true),
            ($1, 'cost_center', 'Cost center', 'text', '{}', false)`,
    [tenant.id],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const tickets = app.get(TicketsService);
  const customFields = app.get(CustomFieldsService);

  try {
    const created = await tickets.create(tenant.id, {
      subject: 'CF ticket',
      contactId: contact.id,
      source: 'web_form',
      customFields: { severity: 'high', cost_center: 'CC-42' },
    });
    assert(
      created.custom_fields.severity === 'high' &&
        created.custom_fields.cost_center === 'CC-42',
      'create() stores validated custom-field values',
    );

    let createThrew = false;
    try {
      await tickets.create(tenant.id, {
        subject: 'Missing required',
        contactId: contact.id,
        source: 'web_form',
        customFields: { cost_center: 'x' },
      });
    } catch {
      createThrew = true;
    }
    assert(createThrew, 'create() rejects a ticket missing a required field');

    const updated = await tickets.update(tenant.id, created.id, {
      customFields: { cost_center: 'CC-99' },
    });
    assert(
      updated.custom_fields.severity === 'high' &&
        updated.custom_fields.cost_center === 'CC-99',
      'update() merges: changes one field, keeps the required one satisfied',
    );

    const list = await customFields.list(tenant.id);
    assert(list.length === 2, 'custom field defs list returns the tenant defs');

    console.log('\nAll custom fields checks passed.');
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
    await migrator.query(
      `DELETE FROM ticket_custom_field_defs WHERE tenant_id = $1`,
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
