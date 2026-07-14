import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { TicketsService } from '../tickets.service';
import { TicketTodosService } from '../ticket-todos.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Ticket to-dos verification FAILED: ${message}`);
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

  const slug = `ticket-todos-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Ticket Todos Verify', slug],
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
  const todos = app.get(TicketTodosService);

  try {
    const ticket = await ticketsService.create(tenant.id, {
      subject: 'Needs a checklist',
      contactId: contact.id,
      source: 'api',
    });

    let notFound: any = null;
    try {
      await todos.create(tenant.id, '00000000-0000-4000-8000-000000000000', {
        body: 'orphan',
      });
    } catch (err) {
      notFound = err;
    }
    assert(
      notFound?.status === 404,
      'creating a to-do on a nonexistent ticket returns 404',
    );

    const todo1 = await todos.create(tenant.id, ticket.id, {
      body: 'Confirm root cause',
    });
    const todo2 = await todos.create(tenant.id, ticket.id, {
      body: 'Notify the customer',
    });
    assert(todo1.is_done === false, 'a new to-do starts undone');

    const list = await todos.list(tenant.id, ticket.id);
    assert(
      list.length === 2,
      `list() returns both to-dos in creation order (got ${list.length})`,
    );
    assert(
      list[0].id === todo1.id && list[1].id === todo2.id,
      'to-dos are ordered oldest first',
    );

    const done = await todos.update(tenant.id, ticket.id, todo1.id, {
      isDone: true,
    });
    assert(done.is_done === true, 'update() marks a to-do done');
    assert(done.done_at !== null, 'marking done sets done_at');

    const undone = await todos.update(tenant.id, ticket.id, todo1.id, {
      isDone: false,
    });
    assert(undone.done_at === null, 'un-marking done clears done_at');

    await todos.remove(tenant.id, ticket.id, todo2.id);
    const listAfterDelete = await todos.list(tenant.id, ticket.id);
    assert(listAfterDelete.length === 1, 'remove() deletes a to-do');

    console.log('\nAll ticket to-do checks passed.');
  } finally {
    await migrator.query(`DELETE FROM ticket_todos WHERE tenant_id = $1`, [
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
