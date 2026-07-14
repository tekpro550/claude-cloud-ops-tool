import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { TicketsService } from '../../tickets.service';
import { AutomationRulesService } from '../automation-rules.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Automation rules verification FAILED: ${message}`);
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

  const slug = `automation-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Automation Verify', slug],
  );
  const {
    rows: [contact],
  } = await migrator.query(
    `INSERT INTO contacts (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`,
    [tenant.id, 'Test Contact', 'test@example.com'],
  );
  const {
    rows: [groupA],
  } = await migrator.query(
    `INSERT INTO groups (tenant_id, name) VALUES ($1, $2) RETURNING id`,
    [tenant.id, 'Group A'],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const ticketsService = app.get(TicketsService);
  const automationRules = app.get(AutomationRulesService);

  try {
    const createdRule = await automationRules.create(tenant.id, {
      name: 'Flag urgent subjects',
      trigger: 'ticket_created',
      conditions: [{ field: 'subject', operator: 'contains', value: 'urgent' }],
      actions: [
        { type: 'set_priority', value: 'urgent' },
        { type: 'set_group', value: groupA.id },
      ],
    });
    assert(
      createdRule.name === 'Flag urgent subjects',
      'automation rule created via the CRUD service',
    );

    const resolvedRule = await automationRules.create(tenant.id, {
      name: 'Note on resolve',
      trigger: 'ticket_updated',
      conditions: [{ field: 'status', operator: 'equals', value: 'resolved' }],
      actions: [{ type: 'add_note', value: 'Auto-closed by automation' }],
    });

    let badRequest: any = null;
    try {
      await automationRules.create(tenant.id, {
        name: 'Bad rule',
        trigger: 'ticket_created',
        conditions: [],
        actions: [
          { type: 'set_group', value: '00000000-0000-4000-8000-000000000000' },
        ],
      });
    } catch (err) {
      badRequest = err;
    }
    assert(
      badRequest?.status === 400,
      'creating a rule whose set_group action targets a nonexistent group is rejected (400)',
    );

    const urgentTicket = await ticketsService.create(tenant.id, {
      subject: 'urgent: production database down',
      contactId: contact.id,
      source: 'api',
    });
    assert(
      urgentTicket.priority === 'urgent',
      'a ticket_created rule matching the subject sets priority via its action',
    );
    assert(
      urgentTicket.group_id === groupA.id,
      "the same rule's second action (set_group) also applied",
    );

    const routineTicket = await ticketsService.create(tenant.id, {
      subject: 'routine check-in',
      contactId: contact.id,
      source: 'api',
    });
    assert(
      routineTicket.priority === 'medium',
      'a ticket whose subject does not match the condition is left untouched by that rule',
    );
    assert(
      routineTicket.group_id === null,
      "the unmatched ticket's group_id was not set",
    );

    const resolved = await ticketsService.update(tenant.id, routineTicket.id, {
      status: 'resolved',
    });
    assert(
      resolved.status === 'resolved',
      'PATCH still applies the explicit dto change alongside automation',
    );
    const messages = await ticketsService.listMessages(
      tenant.id,
      routineTicket.id,
    );
    assert(
      messages.some(
        (m: any) =>
          m.type === 'note' &&
          m.author_type === 'system' &&
          m.body === 'Auto-closed by automation',
      ),
      'a ticket_updated rule matching status=resolved appended its add_note action as a system note',
    );

    // Deactivate the urgent-subject rule and confirm it stops firing.
    await automationRules.update(tenant.id, createdRule.id, {
      isActive: false,
    });
    const stillUrgentSubject = await ticketsService.create(tenant.id, {
      subject: 'urgent: another one',
      contactId: contact.id,
      source: 'api',
    });
    assert(
      stillUrgentSubject.priority === 'medium',
      'deactivating a rule (isActive=false) stops it from firing on later matches',
    );

    const list = await automationRules.list(tenant.id);
    assert(
      list.length === 2,
      `list() returns both rules created for this tenant (got ${list.length})`,
    );

    await automationRules.remove(tenant.id, resolvedRule.id);
    const listAfterDelete = await automationRules.list(tenant.id);
    assert(listAfterDelete.length === 1, 'remove() deletes a rule');

    let notFound: any = null;
    try {
      await automationRules.remove(tenant.id, resolvedRule.id);
    } catch (err) {
      notFound = err;
    }
    assert(
      notFound?.status === 404,
      'removing an already-deleted rule returns 404',
    );

    console.log('\nAll automation rules checks passed.');
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
    await migrator.query(`DELETE FROM automation_rules WHERE tenant_id = $1`, [
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
