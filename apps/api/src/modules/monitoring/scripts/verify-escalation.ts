import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { AlertRulesService } from '../alert-rules.service';
import { AlertsService } from '../alerts.service';
import { DowntimeEventsService } from '../downtime-events.service';
import { EscalationPoliciesService } from '../escalation-policies.service';
import { EscalationSweepService } from '../escalation-sweep.service';
import { MonitorsService } from '../monitors.service';
import { NotificationTemplatesService } from '../notification-templates.service';
import { OnCallSchedulesService } from '../on-call-schedules.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Escalation verification FAILED: ${message}`);
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

  const slug = `escalation-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Escalation Verify', slug],
  );
  const {
    rows: [resource],
  } = await migrator.query(
    `INSERT INTO resources (tenant_id, name, resource_type) VALUES ($1, $2, 'server') RETURNING id`,
    [tenant.id, 'Verify Target Server'],
  );
  const {
    rows: [agentUser],
  } = await migrator.query(
    `INSERT INTO users (tenant_id, email, name, password_hash, role) VALUES ($1, $2, $3, 'x', 'agent') RETURNING id`,
    [tenant.id, 'oncall@escalation-verify.example', 'On Call Agent'],
  );
  const {
    rows: [agent],
  } = await migrator.query(
    `INSERT INTO agents (tenant_id, user_id) VALUES ($1, $2) RETURNING id`,
    [tenant.id, agentUser.id],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const escalationPolicies = app.get(EscalationPoliciesService);
  const onCallSchedules = app.get(OnCallSchedulesService);
  const notificationTemplates = app.get(NotificationTemplatesService);
  const downtimeEvents = app.get(DowntimeEventsService);
  const monitors = app.get(MonitorsService);
  const alertRules = app.get(AlertRulesService);
  const alerts = app.get(AlertsService);
  const sweep = app.get(EscalationSweepService);

  try {
    // --- on_call_schedules: current lookup ---
    const now = new Date();
    const schedule = await onCallSchedules.create(tenant.id, {
      name: 'Primary rotation',
      entries: [
        {
          agentId: agent.id,
          startsAt: new Date(now.getTime() - 3600_000).toISOString(),
          endsAt: new Date(now.getTime() + 3600_000).toISOString(),
        },
      ],
    });
    const current = await onCallSchedules.currentOnCall(tenant.id, schedule.id);
    assert(
      current?.agentId === agent.id,
      'currentOnCall() finds the entry covering right now',
    );

    const pastSchedule = await onCallSchedules.create(tenant.id, {
      name: 'Expired rotation',
      entries: [
        {
          agentId: agent.id,
          startsAt: new Date(now.getTime() - 7200_000).toISOString(),
          endsAt: new Date(now.getTime() - 3600_000).toISOString(),
        },
      ],
    });
    const noCurrent = await onCallSchedules.currentOnCall(
      tenant.id,
      pastSchedule.id,
    );
    assert(
      noCurrent === null,
      'currentOnCall() returns null when no entry covers right now',
    );

    // --- notification_templates: default uniqueness + custom rendering ---
    await notificationTemplates.create(tenant.id, {
      channel: 'email',
      eventType: 'alert.escalated',
      body: 'CUSTOM: $MONITOR_NAME step $STEP_NUMBER ($SEVERITY)',
      isDefault: true,
    });
    let duplicateDefaultRejected = false;
    try {
      await notificationTemplates.create(tenant.id, {
        channel: 'email',
        eventType: 'alert.escalated',
        body: 'a second default',
        isDefault: true,
      });
    } catch {
      duplicateDefaultRejected = true;
    }
    assert(
      duplicateDefaultRejected,
      'a second default template for the same channel/event_type is rejected',
    );

    // --- downtime_events: manual create + end ---
    const downtime = await downtimeEvents.create(
      tenant.id,
      { resourceId: resource.id, reason: 'Planned maintenance window' },
      agent.id,
    );
    assert(
      downtime.ends_at === null,
      'a new downtime event has no ends_at (still ongoing)',
    );
    const ended = await downtimeEvents.end(tenant.id, downtime.id);
    assert(ended.ends_at !== null, 'end() stamps ends_at');
    let endTwiceRejected = false;
    try {
      await downtimeEvents.end(tenant.id, downtime.id);
    } catch {
      endTwiceRejected = true;
    }
    assert(
      endTwiceRejected,
      'ending an already-ended downtime event is rejected',
    );

    // --- Escalation sweep: two-step policy fires step 0 immediately, step 1 after its delay ---
    const monitor = await monitors.create(tenant.id, {
      resourceId: resource.id,
      name: 'Verify Escalating Monitor',
      monitorType: 'port',
      consecutiveFailuresToAlert: 1,
    });
    const policy = await escalationPolicies.create(tenant.id, {
      name: 'Two-step policy',
      steps: [
        {
          delayMinutes: 0,
          notify: [{ channel: 'email', recipient: 'step0@example.com' }],
        },
        {
          delayMinutes: 10,
          notify: [{ channel: 'email', recipient: 'step1@example.com' }],
        },
      ],
    });
    await alertRules.create(tenant.id, {
      monitorId: monitor.id,
      severity: 'critical',
      escalationPolicyId: policy.id,
    });

    await migrator.query(
      `INSERT INTO alerts (tenant_id, monitor_id, alert_rule_id, severity, reason_text)
       SELECT $1, $2, ar.id, 'critical', 'verify reason'
       FROM alert_rules ar WHERE ar.monitor_id = $2`,
      [tenant.id, monitor.id],
    );
    const { rows: alertRows } = await migrator.query(
      `SELECT id FROM alerts WHERE monitor_id = $1`,
      [monitor.id],
    );
    const alertId = alertRows[0].id;

    const firstSweepCount = await sweep.runSweepOnce();
    assert(
      firstSweepCount === 1,
      `step 0 (delay=0) fires on the very first sweep (got ${firstSweepCount})`,
    );

    const { rows: afterFirst } = await migrator.query(
      `SELECT last_escalated_step FROM alerts WHERE id = $1`,
      [alertId],
    );
    assert(
      Number(afterFirst[0].last_escalated_step) === 0,
      'last_escalated_step advances to 0 after step 0 fires',
    );

    const { rows: step0Notifications } = await migrator.query(
      `SELECT recipient, payload FROM notifications WHERE tenant_id = $1 AND recipient = 'step0@example.com'`,
      [tenant.id],
    );
    assert(
      step0Notifications.length === 1,
      'step 0 enqueues exactly one notification to its recipient',
    );
    assert(
      String(step0Notifications[0].payload.body).includes('CUSTOM:') &&
        String(step0Notifications[0].payload.body).includes('step 1'),
      'the enqueued notification body uses the tenant-configured template, substituted with real values',
    );

    const secondSweepCount = await sweep.runSweepOnce();
    assert(
      secondSweepCount === 0,
      `sweeping again immediately does not re-fire step 0, and step 1 (delay=10min) is not due yet (got ${secondSweepCount})`,
    );

    // Backdate opened_at to simulate 10 minutes having passed, then re-sweep.
    await migrator.query(
      `UPDATE alerts SET opened_at = now() - interval '11 minutes' WHERE id = $1`,
      [alertId],
    );
    const thirdSweepCount = await sweep.runSweepOnce();
    assert(
      thirdSweepCount === 1,
      `step 1 fires once its delay has elapsed (got ${thirdSweepCount})`,
    );
    const { rows: afterThird } = await migrator.query(
      `SELECT last_escalated_step FROM alerts WHERE id = $1`,
      [alertId],
    );
    assert(
      Number(afterThird[0].last_escalated_step) === 1,
      'last_escalated_step advances to 1 after step 1 fires',
    );

    const fourthSweepCount = await sweep.runSweepOnce();
    assert(
      fourthSweepCount === 0,
      'sweeping again after the last step is a no-op -- there is nothing left to escalate to',
    );

    // --- Resolving the alert doesn't matter to the sweep, only status IN (open, acknowledged) does ---
    await alerts.resolve(tenant.id, alertId);
    const fifthSweepCount = await sweep.runSweepOnce();
    assert(
      fifthSweepCount === 0,
      'a resolved alert is never picked up by the escalation sweep',
    );

    console.log('\nAll escalation checks passed.');
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
