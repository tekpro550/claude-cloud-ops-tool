import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../app.module';
import { EventBusService } from '../event-bus.service';
import { DomainEventMessage } from '../event-bus.types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Event bus verification FAILED: ${message}`);
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
 * Boots the real NestJS DI graph (AppModule, exactly as the app runs it) and
 * proves one event travels producer -> Redis Stream -> consumer group ->
 * handler end to end, and that the durable audit row lands in Postgres too.
 */
async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `event-bus-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Event Bus Verify', slug],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const eventBus = app.get(EventBusService);

  try {
    // A fresh group name + startId "$" means this consumer only sees
    // messages published after it starts listening, regardless of whatever
    // backlog other groups (e.g. the real notification dispatcher) have
    // left on this shared stream from earlier runs.
    const groupName = `sprint0-verify-${Date.now()}`;
    const received = new Promise<DomainEventMessage>((resolve) => {
      void eventBus.consume(
        groupName,
        async (event) => {
          resolve(event);
        },
        { startId: '$' },
      );
    });

    // Give the consumer's XGROUP CREATE + blocking XREADGROUP a moment to
    // actually be listening before we publish, so this is a genuine
    // producer -> stream -> consumer round trip, not a race.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const published = await eventBus.publish({
      tenantId: tenant.id,
      eventType: 'sprint0.test_event',
      payload: { message: 'hello from Sprint 0' },
    });

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error('timed out waiting for consumer to receive the event'),
          ),
        10000,
      ),
    );
    const delivered = await Promise.race([received, timeout]);

    assert(
      delivered.id === published.id,
      'consumer received the exact event the producer published (matching id)',
    );
    assert(
      delivered.eventType === 'sprint0.test_event',
      'eventType survived the round trip through the stream',
    );
    assert(
      delivered.payload.message === 'hello from Sprint 0',
      'payload survived the round trip through the stream',
    );

    const { rows: auditRows } = await migrator.query(
      `SELECT event_type, payload FROM events WHERE id = $1`,
      [published.id],
    );
    assert(
      auditRows.length === 1,
      'publish() also wrote the durable audit row to the events table',
    );
    assert(
      auditRows[0].event_type === 'sprint0.test_event',
      "audit row's event_type matches what was published",
    );

    console.log(
      '\nAll event bus checks passed. A test event flowed end to end through Redis Streams.',
    );
  } finally {
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
