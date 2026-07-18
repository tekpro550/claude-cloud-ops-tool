// Must be set before AppModule/ConfigModule are created (see verify-alerting.ts).
const TEST_PORT = 32700 + Math.floor(Math.random() * 500);
process.env.PORT = String(TEST_PORT);
process.env.INTERNAL_API_BASE_URL = `http://localhost:${TEST_PORT}/api/v1`;

import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { AlertEvaluationService } from '../alert-evaluation.service';
import { AlertRulesService } from '../alert-rules.service';
import { MonitorsService } from '../monitors.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Metric alert rules verification FAILED: ${message}`);
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

/** Inserts one monitor_checks row, oldest-first callers use a shrinking `minutesAgo`. */
async function seedCheck(
  migrator: Client,
  tenantId: string,
  monitorId: string,
  minutesAgo: number,
  opts: { responseTimeMs?: number; rawOutput?: Record<string, unknown> } = {},
) {
  await migrator.query(
    `INSERT INTO monitor_checks (tenant_id, monitor_id, status, response_time_ms, raw_output, checked_at)
     VALUES ($1, $2, 'up', $3, $4, now() - ($5 || ' minutes')::interval)`,
    [
      tenantId,
      monitorId,
      opts.responseTimeMs ?? null,
      JSON.stringify(opts.rawOutput ?? {}),
      minutesAgo,
    ],
  );
}

async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `metric-alert-rules-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Metric Alert Rules Verify', slug],
  );
  const tenantId = tenant.id as string;
  const {
    rows: [resource],
  } = await migrator.query(
    `INSERT INTO resources (tenant_id, name, resource_type) VALUES ($1, $2, 'server') RETURNING id`,
    [tenantId, 'Verify Target Server'],
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
  const alertEvaluation = app.get(AlertEvaluationService);

  try {
    // ---- Cross-field validation ----
    const thresholdMonitor = await monitors.create(tenantId, {
      resourceId: resource.id,
      name: 'Latency Monitor',
      monitorType: 'http',
      config: { url: 'https://example.com' },
    });

    let missingThresholdFields = false;
    try {
      await alertRules.create(tenantId, {
        monitorId: thresholdMonitor.id,
        ruleKind: 'threshold',
        metric: 'response_time_ms',
        // comparator/threshold intentionally omitted
      });
    } catch {
      missingThresholdFields = true;
    }
    assert(
      missingThresholdFields,
      'creating a threshold rule without comparator/threshold is rejected',
    );

    const anomalyMonitorForValidation = await monitors.create(tenantId, {
      resourceId: resource.id,
      name: 'CPU Monitor (validation)',
      monitorType: 'server_agent',
      config: {},
    });
    let missingAnomalyFields = false;
    try {
      await alertRules.create(tenantId, {
        monitorId: anomalyMonitorForValidation.id,
        ruleKind: 'anomaly',
        // metric/anomalySensitivity intentionally omitted
      });
    } catch {
      missingAnomalyFields = true;
    }
    assert(
      missingAnomalyFields,
      'creating an anomaly rule without metric/anomalySensitivity is rejected',
    );

    // ---- Threshold rule: response_time_ms > 500 for 2 consecutive checks ----
    const thresholdRule = await alertRules.create(tenantId, {
      monitorId: thresholdMonitor.id,
      ruleKind: 'threshold',
      metric: 'response_time_ms',
      comparator: 'gt',
      threshold: 500,
      forConsecutive: 2,
      severity: 'warning',
    });
    assert(
      thresholdRule.rule_kind === 'threshold' &&
        Number(thresholdRule.threshold) === 500,
      'a threshold alert rule persists its metric/comparator/threshold',
    );

    const thresholdMonitorRef = {
      id: thresholdMonitor.id,
      name: thresholdMonitor.name,
      resourceId: resource.id,
      consecutiveFailuresToAlert:
        thresholdMonitor.consecutive_failures_to_alert,
    };
    const fastResult = {
      status: 'up' as const,
      responseTimeMs: 120,
      rawOutput: {},
    };
    const slowResult = {
      status: 'up' as const,
      responseTimeMs: 900,
      rawOutput: {},
    };

    // A handful of healthy checks first -- no alert.
    for (let i = 5; i >= 1; i--) {
      await seedCheck(migrator, tenantId, thresholdMonitor.id, i, {
        responseTimeMs: 120,
      });
    }
    await alertEvaluation.evaluate(tenantId, thresholdMonitorRef, fastResult);
    const { rows: noneYet } = await migrator.query(
      `SELECT id FROM alerts WHERE monitor_id = $1`,
      [thresholdMonitor.id],
    );
    assert(
      noneYet.length === 0,
      'healthy latency never opens a threshold alert',
    );

    // One slow check: below the for_consecutive=2 debounce, still no alert.
    await seedCheck(migrator, tenantId, thresholdMonitor.id, 0.1, {
      responseTimeMs: 900,
    });
    await alertEvaluation.evaluate(tenantId, thresholdMonitorRef, slowResult);
    const { rows: stillNone } = await migrator.query(
      `SELECT id FROM alerts WHERE monitor_id = $1`,
      [thresholdMonitor.id],
    );
    assert(
      stillNone.length === 0,
      'a single slow check does not open a threshold alert (for_consecutive=2)',
    );

    // A second consecutive slow check reaches the debounce -- alert opens.
    await seedCheck(migrator, tenantId, thresholdMonitor.id, 0, {
      responseTimeMs: 950,
    });
    await alertEvaluation.evaluate(tenantId, thresholdMonitorRef, slowResult);
    const { rows: opened } = await migrator.query(
      `SELECT * FROM alerts WHERE monitor_id = $1`,
      [thresholdMonitor.id],
    );
    assert(
      opened.length === 1 && opened[0].severity === 'warning',
      'two consecutive slow checks open a threshold alert with the rule’s severity',
    );
    assert(
      opened[0].reason_text.includes('response_time_ms'),
      'the alert reason text names the breaching metric',
    );

    // Recovery: a fast check resolves it (no result.status gate for metric rules).
    await seedCheck(migrator, tenantId, thresholdMonitor.id, -0.1, {
      responseTimeMs: 100,
    });
    await alertEvaluation.evaluate(tenantId, thresholdMonitorRef, fastResult);
    const { rows: resolved } = await migrator.query(
      `SELECT status FROM alerts WHERE id = $1`,
      [opened[0].id],
    );
    assert(
      resolved[0].status === 'resolved',
      'a fast check resolves an open threshold alert',
    );

    // ---- Anomaly rule: cpu_percent vs a trailing baseline ----
    const anomalyMonitor = await monitors.create(tenantId, {
      resourceId: resource.id,
      name: 'CPU Monitor',
      monitorType: 'server_agent',
      config: {},
    });
    await alertRules.create(tenantId, {
      monitorId: anomalyMonitor.id,
      ruleKind: 'anomaly',
      metric: 'cpu_percent',
      anomalySensitivity: 3,
      severity: 'critical',
    });
    const anomalyMonitorRef = {
      id: anomalyMonitor.id,
      name: anomalyMonitor.name,
      resourceId: resource.id,
      consecutiveFailuresToAlert: anomalyMonitor.consecutive_failures_to_alert,
    };

    // 35 stable baseline samples oscillating tightly around 20% CPU.
    for (let i = 35; i >= 1; i--) {
      const cpu = 19 + (i % 3); // 19, 20, 21 repeating -- low variance
      await seedCheck(migrator, tenantId, anomalyMonitor.id, i, {
        rawOutput: { cpuPercent: cpu },
      });
    }
    const normalResult = {
      status: 'up' as const,
      responseTimeMs: null,
      rawOutput: { cpuPercent: 20 },
    };
    await seedCheck(migrator, tenantId, anomalyMonitor.id, 0.5, {
      rawOutput: { cpuPercent: 20 },
    });
    await alertEvaluation.evaluate(tenantId, anomalyMonitorRef, normalResult);
    const { rows: noAnomalyYet } = await migrator.query(
      `SELECT id FROM alerts WHERE monitor_id = $1`,
      [anomalyMonitor.id],
    );
    assert(
      noAnomalyYet.length === 0,
      'a sample matching the stable baseline does not open an anomaly alert',
    );

    // A sharp spike well outside the baseline's tight range.
    const spikeResult = {
      status: 'up' as const,
      responseTimeMs: null,
      rawOutput: { cpuPercent: 98 },
    };
    await seedCheck(migrator, tenantId, anomalyMonitor.id, 0, {
      rawOutput: { cpuPercent: 98 },
    });
    await alertEvaluation.evaluate(tenantId, anomalyMonitorRef, spikeResult);
    const { rows: anomalyOpened } = await migrator.query(
      `SELECT * FROM alerts WHERE monitor_id = $1`,
      [anomalyMonitor.id],
    );
    assert(
      anomalyOpened.length === 1 && anomalyOpened[0].severity === 'critical',
      'a sharp spike against a stable baseline opens an anomaly alert',
    );
    assert(
      anomalyOpened[0].reason_text.includes('cpu_percent'),
      'the anomaly alert reason text names the metric',
    );

    // Back to baseline resolves it.
    await seedCheck(migrator, tenantId, anomalyMonitor.id, -0.1, {
      rawOutput: { cpuPercent: 20 },
    });
    await alertEvaluation.evaluate(tenantId, anomalyMonitorRef, normalResult);
    const { rows: anomalyResolved } = await migrator.query(
      `SELECT status FROM alerts WHERE id = $1`,
      [anomalyOpened[0].id],
    );
    assert(
      anomalyResolved[0].status === 'resolved',
      'a return to baseline resolves the anomaly alert',
    );

    // ---- Updating a threshold rule's threshold alone keeps validation happy ----
    const patched = await alertRules.update(tenantId, thresholdRule.id, {
      threshold: 250,
    });
    assert(
      Number(patched.threshold) === 250 && patched.comparator === 'gt',
      'a partial update to just `threshold` keeps the rule’s existing comparator/metric',
    );

    console.log('\nAll metric alert rules checks passed.');
  } finally {
    await app.close();
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await migrator.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
