import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import * as request from 'supertest';
import { AppModule } from '../../../../app.module';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Internal tickets verification FAILED: ${message}`);
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

/**
 * Drives POST /internal/tickets/from_alert over real HTTP -- this is the
 * mock-payload contract test the Module 1 doc calls for (section 7, Sprint
 * 4: "built and tested with a mock payload, so Module 2 has a real contract
 * to integrate against").
 */
async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `internal-tickets-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Internal Tickets Verify', slug],
  );

  const app: INestApplication = await NestFactory.create(AppModule, {
    logger: false,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();
  const server = app.getHttpServer();

  try {
    const noKeyRes = await request(server)
      .post('/api/v1/internal/tickets/from_alert')
      .send({
        tenantId: tenant.id,
        subject: 'Disk usage critical',
        description: 'Disk usage at 95% on db-primary',
      });
    assert(
      noKeyRes.status === 401,
      'POST /internal/tickets/from_alert without X-Internal-Api-Key is rejected with 401',
    );

    const wrongKeyRes = await request(server)
      .post('/api/v1/internal/tickets/from_alert')
      .set('X-Internal-Api-Key', 'not-the-right-key')
      .send({
        tenantId: tenant.id,
        subject: 'Disk usage critical',
        description: 'Disk usage at 95% on db-primary',
      });
    assert(
      wrongKeyRes.status === 401,
      'a wrong X-Internal-Api-Key is also rejected with 401',
    );

    const apiKey = process.env.INTERNAL_API_KEY ?? 'dev-internal-api-key';

    const createRes = await request(server)
      .post('/api/v1/internal/tickets/from_alert')
      .set('X-Internal-Api-Key', apiKey)
      .send({
        tenantId: tenant.id,
        subject: 'Disk usage critical on db-primary',
        description: 'Disk usage at 95% on db-primary. Threshold: 90%.',
        priority: 'urgent',
      });
    assert(
      createRes.status === 201,
      `a valid mock alert payload creates a ticket (status=${createRes.status})`,
    );
    assert(
      createRes.body.source === 'alert',
      'the created ticket has source=alert',
    );
    assert(
      createRes.body.priority === 'urgent',
      "the created ticket's priority comes from the alert payload",
    );
    assert(
      createRes.body.ticket_number === 1,
      'the alert-created ticket got a ticket number, same numbering sequence as any other ticket',
    );

    const { rows: contactRows } = await migrator.query(
      `SELECT name, email FROM contacts WHERE id = $1`,
      [createRes.body.contact_id],
    );
    assert(
      contactRows[0]?.email === 'alerts@system.internal',
      'the ticket is attributed to the synthetic System Monitoring contact',
    );

    const { rows: messageRows } = await migrator.query(
      `SELECT body, author_type FROM ticket_messages WHERE ticket_id = $1`,
      [createRes.body.id],
    );
    assert(
      messageRows.length === 1 &&
        messageRows[0].body ===
          'Disk usage at 95% on db-primary. Threshold: 90%.' &&
        messageRows[0].author_type === 'system',
      'the alert description was stored as the first ticket message, attributed to the system',
    );

    const secondAlertRes = await request(server)
      .post('/api/v1/internal/tickets/from_alert')
      .set('X-Internal-Api-Key', apiKey)
      .send({
        tenantId: tenant.id,
        subject: 'A second unrelated alert',
        description: 'Different resource, different issue.',
      });
    assert(
      secondAlertRes.status === 201,
      'a second alert creates a second ticket',
    );
    assert(
      secondAlertRes.body.ticket_number === 2,
      'ticket numbering continues sequentially across alert-created tickets',
    );
    assert(
      secondAlertRes.body.contact_id === createRes.body.contact_id,
      'the synthetic System Monitoring contact is reused, not duplicated, across alerts for the same tenant',
    );

    const missingFieldRes = await request(server)
      .post('/api/v1/internal/tickets/from_alert')
      .set('X-Internal-Api-Key', apiKey)
      .send({ tenantId: tenant.id, subject: 'Missing description' });
    assert(
      missingFieldRes.status === 400,
      'a payload missing the required description field is rejected with 400',
    );

    console.log('\nAll internal tickets (from_alert) checks passed.');
  } finally {
    await app.close();
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
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
