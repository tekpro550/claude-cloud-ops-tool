import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../app.module';
import { NotificationsService } from '../notifications.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Notification dispatcher verification FAILED: ${message}`);
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

async function waitForStatus(migrator: Client, id: string, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await migrator.query(
      `SELECT status, sent_at FROM notifications WHERE id = $1`,
      [id],
    );
    if (rows[0] && rows[0].status !== 'queued') return rows[0];
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timed out waiting for notification ${id} to leave "queued"`);
}

/**
 * Boots the real NestJS DI graph and proves the dispatcher skeleton end to
 * end: an enqueued email notification gets sent, and an enqueued whatsapp
 * notification (deliberately unimplemented in Sprint 0) fails with a clear
 * reason instead of silently vanishing.
 */
async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `notifications-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Notifications Verify', slug],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const notifications = app.get(NotificationsService);

  try {
    const emailNotification = await notifications.enqueue({
      tenantId: tenant.id,
      channel: 'email',
      recipient: 'sprint0-test@example.com',
      templateName: 'sprint0.test_email',
      payload: { message: 'hello from Sprint 0 notifications' },
    });
    const emailResult = await waitForStatus(migrator, emailNotification.id);
    assert(
      emailResult.status === 'sent',
      `email notification dispatched successfully (status=${emailResult.status})`,
    );
    assert(
      emailResult.sent_at !== null,
      'sent_at timestamp was recorded for the email notification',
    );

    const whatsappNotification = await notifications.enqueue({
      tenantId: tenant.id,
      channel: 'whatsapp',
      recipient: '+10000000000',
      templateName: 'sprint0.test_email',
      payload: { message: 'should not send' },
    });
    const whatsappResult = await waitForStatus(
      migrator,
      whatsappNotification.id,
    );
    assert(
      whatsappResult.status === 'failed',
      `whatsapp notification correctly failed as unimplemented (status=${whatsappResult.status})`,
    );

    console.log('\nAll notification dispatcher checks passed.');
  } finally {
    await migrator.query(`DELETE FROM notifications WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM events WHERE tenant_id = $1`, [
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
