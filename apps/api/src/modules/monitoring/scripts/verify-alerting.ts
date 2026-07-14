// Must be set before AppModule/ConfigModule are created -- @nestjs/config
// snapshots process.env at module init, so mutating it afterwards wouldn't
// change what AlertEvaluationService reads for INTERNAL_API_BASE_URL.
const TEST_PORT = 32100 + Math.floor(Math.random() * 500);
process.env.PORT = String(TEST_PORT);
process.env.INTERNAL_API_BASE_URL = `http://localhost:${TEST_PORT}/api/v1`;

import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { AlertEvaluationService } from '../alert-evaluation.service';
import { AlertRulesService } from '../alert-rules.service';
import { AlertsService } from '../alerts.service';
import { MonitorsService } from '../monitors.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Alerting verification FAILED: ${message}`);
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

async function seedDownChecks(
  migrator: Client,
  monitorId: string,
  tenantId: string,
  count: number,
) {
  for (let i = 0; i < count; i++) {
    await migrator.query(
      `INSERT INTO monitor_checks (tenant_id, monitor_id, status, response_time_ms, raw_output)
       VALUES ($1, $2, 'down', 5, '{"error": "connection refused"}')`,
      [tenantId, monitorId],
    );
  }
}

async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `alerting-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Alerting Verify', slug],
  );
  const {
    rows: [resource],
  } = await migrator.query(
    `INSERT INTO resources (tenant_id, name, resource_type) VALUES ($1, $2, 'server') RETURNING id`,
    [tenant.id, 'Verify Target Server'],
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
  await app.listen(TEST_PORT);

  const monitors = app.get(MonitorsService);
  const alertRules = app.get(AlertRulesService);
  const alerts = app.get(AlertsService);
  const alertEvaluation = app.get(AlertEvaluationService);

  try {
    const monitor = await monitors.create(tenant.id, {
      resourceId: resource.id,
      name: 'Verify Port Monitor',
      monitorType: 'port',
      config: { host: '127.0.0.1', port: 1 },
      consecutiveFailuresToAlert: 2,
    });
    const monitorRef = {
      id: monitor.id,
      name: monitor.name,
      resourceId: resource.id,
      consecutiveFailuresToAlert: 2,
    };
    const downResult = {
      status: 'down' as const,
      responseTimeMs: 5,
      rawOutput: { error: 'connection refused' },
    };
    const upResult = {
      status: 'up' as const,
      responseTimeMs: 3,
      rawOutput: {},
    };

    // --- alert_rules CRUD + duplicate-per-monitor guard ---
    await alertRules.create(tenant.id, {
      monitorId: monitor.id,
      severity: 'critical',
    });
    let duplicateRejected = false;
    try {
      await alertRules.create(tenant.id, {
        monitorId: monitor.id,
        severity: 'warning',
      });
    } catch {
      duplicateRejected = true;
    }
    assert(
      duplicateRejected,
      'a monitor can only have one alert_rule (DB unique constraint enforced)',
    );

    // --- Below threshold: no alert yet ---
    await seedDownChecks(migrator, monitor.id, tenant.id, 1);
    await alertEvaluation.evaluate(tenant.id, monitorRef, downResult);
    const { rows: tooEarly } = await migrator.query(
      `SELECT id FROM alerts WHERE monitor_id = $1`,
      [monitor.id],
    );
    assert(
      tooEarly.length === 0,
      'a single bad check does not open an alert (threshold is 2)',
    );

    // --- Threshold reached: alert opens and links a real ticket ---
    await seedDownChecks(migrator, monitor.id, tenant.id, 1);
    await alertEvaluation.evaluate(tenant.id, monitorRef, downResult);
    const { rows: opened } = await migrator.query(
      `SELECT * FROM alerts WHERE monitor_id = $1`,
      [monitor.id],
    );
    assert(
      opened.length === 1,
      'exactly one alert opens once the debounce threshold is reached',
    );
    assert(opened[0].status === 'open', 'newly opened alert has status=open');
    assert(
      opened[0].severity === 'critical',
      "alert severity comes from the alert_rule's severity",
    );
    assert(
      opened[0].ticket_id !== null,
      'the new alert is linked to a real ticket via the internal HTTP contract',
    );

    const { rows: ticketRows } = await migrator.query(
      `SELECT * FROM tickets WHERE id = $1`,
      [opened[0].ticket_id],
    );
    assert(ticketRows.length === 1, 'the linked ticket actually exists');
    assert(
      ticketRows[0].subject.includes(monitor.name),
      "the ticket's subject references the failing monitor",
    );
    const { rows: initialMessages } = await migrator.query(
      `SELECT id FROM ticket_messages WHERE ticket_id = $1`,
      [opened[0].ticket_id],
    );
    assert(
      initialMessages.length === 1,
      'the ticket has its initial auto-generated note',
    );

    // --- Repeats: idempotent, no new alert or ticket, periodic note only ---
    for (let i = 0; i < 5; i++) {
      await seedDownChecks(migrator, monitor.id, tenant.id, 1);
      await alertEvaluation.evaluate(tenant.id, monitorRef, downResult);
    }
    const { rows: stillOneAlert } = await migrator.query(
      `SELECT * FROM alerts WHERE monitor_id = $1`,
      [monitor.id],
    );
    assert(
      stillOneAlert.length === 1,
      'repeated failures never open a second alert for the same monitor',
    );
    assert(
      stillOneAlert[0].ticket_id === opened[0].ticket_id,
      'repeated failures never create a second ticket -- same ticket_id throughout',
    );
    assert(
      Number(stillOneAlert[0].repeat_count) === 5,
      `repeat_count tracks every repeated failure (got ${stillOneAlert[0].repeat_count})`,
    );
    const { rows: messagesAfterRepeats } = await migrator.query(
      `SELECT id FROM ticket_messages WHERE ticket_id = $1`,
      [opened[0].ticket_id],
    );
    assert(
      messagesAfterRepeats.length === 2,
      `a periodic note was posted on the 5th repeat, not every repeat (got ${messagesAfterRepeats.length} messages)`,
    );

    // --- Recovery: alert resolves, resolution note posted ---
    await alertEvaluation.evaluate(tenant.id, monitorRef, upResult);
    const { rows: resolved } = await migrator.query(
      `SELECT * FROM alerts WHERE id = $1`,
      [opened[0].id],
    );
    assert(
      resolved[0].status === 'resolved',
      'recovery (an up check) resolves the open alert',
    );
    assert(resolved[0].resolved_at !== null, 'resolved_at is set on recovery');
    const { rows: messagesAfterRecovery } = await migrator.query(
      `SELECT id FROM ticket_messages WHERE ticket_id = $1`,
      [opened[0].ticket_id],
    );
    assert(
      messagesAfterRecovery.length === 3,
      'a recovery note is posted to the ticket when the alert resolves',
    );

    // --- A fresh incident after recovery opens a brand new alert + ticket ---
    await seedDownChecks(migrator, monitor.id, tenant.id, 2);
    await alertEvaluation.evaluate(tenant.id, monitorRef, downResult);
    const { rows: allAlerts } = await migrator.query(
      `SELECT * FROM alerts WHERE monitor_id = $1 ORDER BY opened_at`,
      [monitor.id],
    );
    assert(
      allAlerts.length === 2,
      'a new incident after resolution opens a second, distinct alert',
    );
    assert(
      allAlerts[1].ticket_id !== allAlerts[0].ticket_id,
      "the new alert is linked to a new ticket, not the old resolved incident's ticket",
    );

    // --- DB-level idempotency guarantee: the partial unique index itself ---
    let dbRejectedDuplicate = false;
    try {
      await migrator.query(
        `INSERT INTO alerts (tenant_id, monitor_id, severity, reason_text) VALUES ($1, $2, 'critical', 'race test')`,
        [tenant.id, monitor.id],
      );
    } catch (err) {
      dbRejectedDuplicate = (err as { code?: string }).code === '23505';
    }
    assert(
      dbRejectedDuplicate,
      'the database itself rejects a second open/acknowledged alert for the same monitor (partial unique index)',
    );

    // --- AlertsService: ack / resolve / link_ticket ---
    const activeAlert = allAlerts[1];
    const acked = await alerts.acknowledge(tenant.id, activeAlert.id);
    assert(
      acked.status === 'acknowledged',
      'acknowledge() transitions open -> acknowledged',
    );
    let ackTwiceRejected = false;
    try {
      await alerts.acknowledge(tenant.id, activeAlert.id);
    } catch {
      ackTwiceRejected = true;
    }
    assert(
      ackTwiceRejected,
      'acknowledging an already-acknowledged alert is rejected',
    );
    const manuallyResolved = await alerts.resolve(tenant.id, activeAlert.id);
    assert(
      manuallyResolved.status === 'resolved',
      'resolve() transitions acknowledged -> resolved',
    );

    let linkRejected = false;
    try {
      await alerts.linkTicket(tenant.id, activeAlert.id, ticketRows[0].id);
    } catch {
      linkRejected = true;
    }
    assert(
      linkRejected,
      'link_ticket rejects re-linking an alert that already has a ticket',
    );

    console.log('\nAll alerting checks passed.');
  } finally {
    await app.close();
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
    await migrator.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
