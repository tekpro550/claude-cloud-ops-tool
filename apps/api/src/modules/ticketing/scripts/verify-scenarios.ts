import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { GroupsService } from '../groups.service';
import { ScenariosService } from '../scenarios.service';
import { TicketsService } from '../tickets.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Scenarios verification FAILED: ${message}`);
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

  const slug = `scenarios-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Scenarios Verify', slug],
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
  const groups = app.get(GroupsService);
  const scenarios = app.get(ScenariosService);
  const tickets = app.get(TicketsService);

  try {
    const group = await groups.create(tenant.id, { name: 'Escalation Team' });

    let badGroupRef: any = null;
    try {
      await scenarios.create(tenant.id, {
        name: 'Bad scenario',
        actions: [
          { type: 'set_group', value: '00000000-0000-4000-8000-000000000000' },
        ],
      });
    } catch (err) {
      badGroupRef = err;
    }
    assert(
      badGroupRef?.status === 400,
      'creating a scenario whose set_group action targets a nonexistent group is rejected (400)',
    );

    const scenario = await scenarios.create(tenant.id, {
      name: 'Assign to Escalation Team',
      actions: [
        { type: 'set_group', value: group.id },
        { type: 'set_priority', value: 'urgent' },
      ],
    });
    assert(scenario.name === 'Assign to Escalation Team', 'scenario created');
    const list1 = await scenarios.list(tenant.id);
    assert(list1.length === 1, 'scenario appears in list()');

    const ticket = await tickets.create(tenant.id, {
      subject: 'Needs escalation',
      contactId: contact.id,
      source: 'web_form',
    });
    assert(
      ticket.priority === 'medium',
      'ticket starts at the default priority',
    );

    const applied = await scenarios.apply(tenant.id, scenario.id, ticket.id);
    assert(
      applied.group_id === group.id,
      'applying the scenario sets group_id immediately',
    );
    assert(
      applied.priority === 'urgent',
      'applying the scenario sets priority immediately',
    );

    const activities = await tickets.listActivities(tenant.id, ticket.id);
    assert(
      activities.length === 2 &&
        activities.some((a: any) => a.field === 'group_id') &&
        activities.some((a: any) => a.field === 'priority'),
      'applying a scenario writes ticket_activities rows, same as a direct PATCH',
    );

    const reapplied = await scenarios.apply(tenant.id, scenario.id, ticket.id);
    const activitiesAfterReapply = await tickets.listActivities(
      tenant.id,
      ticket.id,
    );
    assert(
      reapplied.group_id === group.id && activitiesAfterReapply.length === 2,
      're-applying the same scenario is a no-op (no redundant activity rows) once values already match',
    );

    const updated = await scenarios.update(tenant.id, scenario.id, {
      name: 'Escalate Now',
    });
    assert(updated.name === 'Escalate Now', 'scenario renamed via update()');

    await scenarios.remove(tenant.id, scenario.id);
    const list2 = await scenarios.list(tenant.id);
    assert(list2.length === 0, 'remove() deletes the scenario');

    let notFound: any = null;
    try {
      await scenarios.apply(
        tenant.id,
        '00000000-0000-4000-8000-000000000000',
        ticket.id,
      );
    } catch (err) {
      notFound = err;
    }
    assert(
      notFound?.status === 404,
      'applying a nonexistent scenario returns 404',
    );

    console.log('\nAll scenarios checks passed.');
  } finally {
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
    await migrator.query(`DELETE FROM scenarios WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM groups WHERE tenant_id = $1`, [
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
