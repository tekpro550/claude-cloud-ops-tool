import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { TicketsService } from '../../tickets.service';
import { AutomationRulesService } from '../automation-rules.service';
import { TimeAutomationSweepService } from '../time-automation-sweep.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Time-based automation verification FAILED: ${message}`);
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

  const slug = `time-automation-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Time Automation Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Test Contact', 'test@example.com'],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const ticketsService = app.get(TicketsService);
  const automationRules = app.get(AutomationRulesService);
  const sweep = app.get(TimeAutomationSweepService);

  try {
    let rejected = false;
    try {
      await automationRules.create(tenant.id, {
        name: 'Missing minutes',
        trigger: 'time_based',
        conditions: [],
        actions: [{ type: 'add_note', value: 'x' }],
      });
    } catch {
      rejected = true;
    }
    assert(
      rejected,
      'creating a time_based rule without timeTriggerMinutes is rejected (400)',
    );

    const rule = await automationRules.create(tenant.id, {
      name: 'Escalate after 1 hour unresolved',
      trigger: 'time_based',
      timeTriggerMinutes: 60,
      conditions: [{ field: 'priority', operator: 'equals', value: 'urgent' }],
      actions: [
        { type: 'set_priority', value: 'urgent' },
        { type: 'add_note', value: 'Auto-escalated: unresolved for 1 hour' },
      ],
    });

    // Old enough and matches the condition -- should fire.
    const oldMatching = await ticketsService.create(tenant.id, {
      subject: 'Old matching ticket',
      contactId: contact.id,
      source: 'api',
      priority: 'urgent',
    });
    await migrator.query(
      `UPDATE tickets SET created_at = now() - interval '90 minutes' WHERE id = $1`,
      [oldMatching.id],
    );

    // Old enough but doesn't match the condition -- should not fire.
    const oldNonMatching = await ticketsService.create(tenant.id, {
      subject: 'Old non-matching ticket',
      contactId: contact.id,
      source: 'api',
      priority: 'low',
    });
    await migrator.query(
      `UPDATE tickets SET created_at = now() - interval '90 minutes' WHERE id = $1`,
      [oldNonMatching.id],
    );

    // Matches the condition but too recent -- should not fire yet.
    const freshMatching = await ticketsService.create(tenant.id, {
      subject: 'Fresh matching ticket',
      contactId: contact.id,
      source: 'api',
      priority: 'urgent',
    });

    // Old, matches, but already resolved -- should not fire.
    const oldResolved = await ticketsService.create(tenant.id, {
      subject: 'Old resolved ticket',
      contactId: contact.id,
      source: 'api',
      priority: 'urgent',
    });
    await migrator.query(
      `UPDATE tickets SET created_at = now() - interval '90 minutes', status = 'resolved' WHERE id = $1`,
      [oldResolved.id],
    );

    const appliedCount = await sweep.runSweepOnce();
    assert(
      appliedCount === 1,
      `first sweep applies the rule to exactly the one eligible ticket (got ${appliedCount})`,
    );

    const messages = await ticketsService.listMessages(
      tenant.id,
      oldMatching.id,
    );
    assert(
      messages.some(
        (m: any) => m.body === 'Auto-escalated: unresolved for 1 hour',
      ),
      "the eligible ticket's add_note action was applied",
    );

    const freshMessages = await ticketsService.listMessages(
      tenant.id,
      freshMatching.id,
    );
    assert(
      freshMessages.length === 0,
      'a matching-but-too-recent ticket is left untouched',
    );

    const nonMatchingMessages = await ticketsService.listMessages(
      tenant.id,
      oldNonMatching.id,
    );
    assert(
      nonMatchingMessages.length === 0,
      "an old ticket that doesn't match the rule's conditions is left untouched",
    );

    const resolvedMessages = await ticketsService.listMessages(
      tenant.id,
      oldResolved.id,
    );
    assert(
      resolvedMessages.length === 0,
      'an old, matching, but already-resolved ticket is excluded from the sweep',
    );

    const secondSweepCount = await sweep.runSweepOnce();
    assert(
      secondSweepCount === 0,
      `a second sweep does not re-apply the rule to the same ticket (got ${secondSweepCount})`,
    );

    const { rows: applications } = await migrator.query(
      `SELECT ticket_id FROM automation_rule_applications WHERE automation_rule_id = $1`,
      [rule.id],
    );
    assert(
      applications.length === 1 && applications[0].ticket_id === oldMatching.id,
      'exactly one application row was recorded, for the ticket the rule actually fired on',
    );

    console.log('\nAll time-based automation checks passed.');
  } finally {
    await migrator.query(`DELETE FROM ticket_messages WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(
      `DELETE FROM automation_rule_applications WHERE tenant_id = $1`,
      [tenant.id],
    );
    await migrator.query(`DELETE FROM tickets WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(
      `DELETE FROM ticket_number_counters WHERE tenant_id = $1`,
      [tenant.id],
    );
    await migrator.query(`DELETE FROM automation_rules WHERE tenant_id = $1`, [
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
