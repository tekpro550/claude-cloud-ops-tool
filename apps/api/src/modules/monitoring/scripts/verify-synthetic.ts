// Must be set before AppModule/ConfigModule are created -- @nestjs/config
// snapshots process.env at module init, same reason verify-alerting.ts and
// verify-cloud-polling.ts set these before importing AppModule.
const TEST_PORT = 32600 + Math.floor(Math.random() * 500);
process.env.PORT = String(TEST_PORT);
process.env.INTERNAL_API_BASE_URL = `http://localhost:${TEST_PORT}/api/v1`;

import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { AlertRulesService } from '../alert-rules.service';
import { AlertsService } from '../alerts.service';
import { MonitorsService } from '../monitors.service';
import { FakeSyntheticRunner } from './fake-synthetic-runner';
import { SYNTHETIC_RUNNER } from '../synthetic/synthetic-runner';
import { SyntheticSchedulerService } from '../synthetic/synthetic-scheduler.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Synthetic monitoring verification FAILED: ${message}`);
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

// The scheduler only picks up a monitor whose last check is older than its
// interval -- backdate only the single latest check between scenarios
// instead of waiting. Must target just the newest row (not every row for
// the monitor): backdating all of them ties their timestamps together,
// which makes "the 2 most recent checks" ambiguous for the alert
// threshold's ORDER BY checked_at DESC LIMIT 2 query.
async function makeDueAgain(migrator: Client, monitorId: string) {
  await migrator.query(
    `UPDATE monitor_checks SET checked_at = now() - interval '1 hour'
     WHERE id = (
       SELECT id FROM monitor_checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT 1
     )`,
    [monitorId],
  );
}

async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `synthetic-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Synthetic Verify', slug],
  );
  const {
    rows: [resource],
  } = await migrator.query(
    `INSERT INTO resources (tenant_id, name, resource_type) VALUES ($1, $2, 'website') RETURNING id`,
    [tenant.id, 'Verify Login Flow'],
  );

  const fakeRunner = new FakeSyntheticRunner();
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SYNTHETIC_RUNNER)
    .useValue(fakeRunner)
    .compile();

  const app: INestApplication = moduleFixture.createNestApplication();
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
  const scheduler = app.get(SyntheticSchedulerService);

  try {
    // --- DTO validation rejects an out-of-allowlist action up front ---
    let rejected = false;
    try {
      await monitors.create(tenant.id, {
        resourceId: resource.id,
        name: 'Bad script',
        monitorType: 'synthetic',
        config: { steps: [{ action: 'evalScript', code: 'alert(1)' }] },
      });
    } catch {
      rejected = true;
    }
    assert(
      rejected,
      'an out-of-allowlist step action is rejected before saving',
    );

    let rejectedEmpty = false;
    try {
      await monitors.create(tenant.id, {
        resourceId: resource.id,
        name: 'Empty script',
        monitorType: 'synthetic',
        config: { steps: [] },
      });
    } catch {
      rejectedEmpty = true;
    }
    assert(rejectedEmpty, 'an empty steps array is rejected');

    // --- A real login-flow-shaped script, with a tight per-step timeout ---
    const monitor = await monitors.create(tenant.id, {
      resourceId: resource.id,
      name: 'Verify Login Flow',
      monitorType: 'synthetic',
      config: {
        steps: [
          { action: 'goto', url: 'https://example.com/login' },
          { action: 'fill', selector: '#username', value: 'demo' },
          { action: 'click', selector: '#submit' },
          { action: 'expectText', selector: '#welcome', value: 'Welcome' },
        ],
        maxStepMs: 5000,
      },
      intervalSeconds: 10,
      consecutiveFailuresToAlert: 2,
    });
    await alertRules.create(tenant.id, {
      monitorId: monitor.id,
      severity: 'critical',
    });

    // --- 1. A passing script writes an "up" check with step rows ---
    fakeRunner.setOutcomes([
      { durationMs: 200 },
      { durationMs: 50 },
      { durationMs: 30 },
      { durationMs: 40 },
    ]);
    const passingCount = await scheduler.runSweepOnce();
    assert(passingCount === 1, 'the due synthetic monitor was run once');

    const {
      rows: [passingCheck],
    } = await migrator.query(
      `SELECT * FROM monitor_checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT 1`,
      [monitor.id],
    );
    assert(
      passingCheck.status === 'up',
      'a passing script writes an "up" check',
    );
    assert(
      passingCheck.response_time_ms === 320,
      "the check's response_time_ms is the sum of all step durations (200+50+30+40)",
    );
    const { rows: passingSteps } = await migrator.query(
      `SELECT * FROM synthetic_run_steps WHERE monitor_check_id = $1 ORDER BY step_index`,
      [passingCheck.id],
    );
    assert(
      passingSteps.length === 4 &&
        passingSteps.every((s: { status: string }) => s.status === 'ok'),
      'all 4 step rows were written with status "ok"',
    );

    // --- 2. A failing step writes "down" with the error on the right index ---
    await makeDueAgain(migrator, monitor.id);
    fakeRunner.setOutcomes([
      { durationMs: 200 },
      { durationMs: 50 },
      { durationMs: 40, fail: true, error: 'element #submit not found' },
    ]);
    await scheduler.runSweepOnce();
    const {
      rows: [failedCheck],
    } = await migrator.query(
      `SELECT * FROM monitor_checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT 1`,
      [monitor.id],
    );
    assert(
      failedCheck.status === 'down',
      'a failing step writes a "down" check',
    );
    assert(
      failedCheck.raw_output.failingStepIndex === 2,
      'raw_output records the failing step index (2)',
    );
    const { rows: failedSteps } = await migrator.query(
      `SELECT * FROM synthetic_run_steps WHERE monitor_check_id = $1 ORDER BY step_index`,
      [failedCheck.id],
    );
    assert(
      failedSteps.length === 3,
      'only the steps that ran (up to and including the failing one) were written',
    );
    assert(
      failedSteps[2].status === 'failed' &&
        failedSteps[2].error === 'element #submit not found',
      'the error is captured on step index 2, not any other step',
    );
    assert(
      failedSteps[0].status === 'ok' && failedSteps[1].status === 'ok',
      'the steps before the failure are still recorded as "ok"',
    );

    // --- A second consecutive failure crosses consecutiveFailuresToAlert=2, opening an alert ---
    await makeDueAgain(migrator, monitor.id);
    fakeRunner.setOutcomes([
      { durationMs: 200 },
      { durationMs: 50 },
      { durationMs: 40, fail: true, error: 'element #submit not found' },
    ]);
    await scheduler.runSweepOnce();
    const openAlerts = await alerts.list(tenant.id, 'open');
    assert(
      openAlerts.some(
        (a: { monitor_id: string }) => a.monitor_id === monitor.id,
      ),
      'two consecutive failures opened an alert for the synthetic monitor',
    );

    // --- 3. A step slower than maxStepMs marks the run a failure ---
    await makeDueAgain(migrator, monitor.id);
    fakeRunner.setOutcomes([
      { durationMs: 200 },
      { durationMs: 9000 }, // exceeds the monitor's maxStepMs (5000)
    ]);
    await scheduler.runSweepOnce();
    const {
      rows: [slowCheck],
    } = await migrator.query(
      `SELECT * FROM monitor_checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT 1`,
      [monitor.id],
    );
    assert(
      slowCheck.status === 'down',
      'a step over maxStepMs marks the run "down"',
    );
    assert(
      slowCheck.raw_output.failingStepIndex === 1,
      'the slow step (index 1) is recorded as the failing step',
    );
    const { rows: slowSteps } = await migrator.query(
      `SELECT * FROM synthetic_run_steps WHERE monitor_check_id = $1 ORDER BY step_index`,
      [slowCheck.id],
    );
    assert(
      slowSteps[1].error === 'step exceeded maxStepMs',
      "the slow step's error explains the timeout",
    );

    // --- A monitor with no due runs yet is left alone ---
    const idleCount = await scheduler.runSweepOnce();
    assert(
      idleCount === 0,
      'a monitor not yet due is not re-run on the next sweep',
    );

    console.log('\nAll synthetic monitoring checks passed.');
  } finally {
    // A "created" alert evaluation links a ticket via the internal HTTP
    // contract, so cleanup can't delete resources/monitors before tickets --
    // just cascade the whole tenant, same as verify-alerting.ts.
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
