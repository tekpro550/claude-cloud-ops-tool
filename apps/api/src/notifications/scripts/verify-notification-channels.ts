import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../app.module';
import { NotificationsService } from '../notifications.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Notification channels verification FAILED: ${message}`);
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

// The dispatcher consumes off the event bus asynchronously; poll until the
// notification leaves 'queued'.
async function waitForStatus(client: Client, id: string) {
  for (let i = 0; i < 50; i++) {
    const { rows } = await client.query(
      `SELECT status, sent_at FROM notifications WHERE id = $1`,
      [id],
    );
    if (rows[0] && rows[0].status !== 'queued') return rows[0];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`notification ${id} never left 'queued'`);
}

/**
 * Proves SMS and voice are now first-class escalation channels: an enqueued
 * notification on each dispatches successfully via the (default log-transport)
 * channel, while an unimplemented channel still fails cleanly.
 */
async function main() {
  const migrator = migratorClient();
  await migrator.connect();
  const slug = `notif-channels-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Notif Channels Verify', slug],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const notifications = app.get(NotificationsService);

  try {
    const sms = await notifications.enqueue({
      tenantId: tenant.id,
      channel: 'sms',
      recipient: '+15551234567',
      templateName: 'monitoring.escalation',
      payload: { subject: 'DB down', body: 'prod-db-01 is unreachable' },
    });
    const smsResult = await waitForStatus(migrator, sms.id);
    assert(
      smsResult.status === 'sent',
      `sms notification dispatched successfully (status=${smsResult.status})`,
    );

    const voice = await notifications.enqueue({
      tenantId: tenant.id,
      channel: 'voice',
      recipient: '+15559876543',
      templateName: 'monitoring.escalation',
      payload: { subject: 'DB down', body: 'prod-db-01 is unreachable' },
    });
    const voiceResult = await waitForStatus(migrator, voice.id);
    assert(
      voiceResult.status === 'sent',
      `voice notification dispatched successfully (status=${voiceResult.status})`,
    );

    const whatsapp = await notifications.enqueue({
      tenantId: tenant.id,
      channel: 'whatsapp',
      recipient: '+15550000000',
      templateName: 'monitoring.escalation',
      payload: { subject: 'x', body: 'y' },
    });
    const whatsappResult = await waitForStatus(migrator, whatsapp.id);
    assert(
      whatsappResult.status === 'failed',
      `whatsapp still correctly fails as unimplemented (status=${whatsappResult.status})`,
    );

    console.log('\nAll notification channel checks passed.');
  } finally {
    await migrator.query(`DELETE FROM notifications WHERE tenant_id = $1`, [
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
