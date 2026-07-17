// Must be set before AppModule/ConfigModule init (same reason as verify-alerting):
// AlertEvaluationService reads INTERNAL_API_BASE_URL at construction.
const TEST_PORT = 32700 + Math.floor(Math.random() * 400);
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
    throw new Error(`Multi-location verification FAILED: ${message}`);
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

async function seedDownCheck(
  migrator: Client,
  monitorId: string,
  tenantId: string,
  location: string,
) {
  await migrator.query(
    `INSERT INTO monitor_checks (tenant_id, monitor_id, status, response_time_ms, raw_output, location)
     VALUES ($1, $2, 'down', 5, '{"error":"connection refused"}', $3)`,
    [tenantId, monitorId, location],
  );
}

async function alertCount(
  migrator: Client,
  monitorId: string,
): Promise<number> {
  const { rows } = await migrator.query(
    `SELECT count(*)::int AS n FROM alerts WHERE monitor_id = $1`,
    [monitorId],
  );
  return rows[0].n;
}

const downResult = {
  status: 'down' as const,
  responseTimeMs: 5,
  rawOutput: { error: 'connection refused' },
};

/**
 * Proves multi-location false-positive suppression: a monitor requiring a
 * 2-location quorum does not open an alert while only one location is failing,
 * and opens as soon as a second location fails — while a default (1-location)
 * monitor still opens on the first failing location.
 */
async function main() {
  const migrator = migratorClient();
  await migrator.connect();
  const slug = `multi-location-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Multi Location Verify', slug],
  );
  const {
    rows: [resource],
  } = await migrator.query(
    `INSERT INTO resources (tenant_id, name, resource_type) VALUES ($1, $2, 'server') RETURNING id`,
    [tenant.id, 'Multi-Location Target'],
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
    // --- Monitor requiring a 2-location quorum ---
    const quorum = await monitors.create(tenant.id, {
      resourceId: resource.id,
      name: 'Quorum Monitor',
      monitorType: 'port',
      config: { host: '127.0.0.1', port: 1 },
      consecutiveFailuresToAlert: 1,
      minFailingLocations: 2,
    });
    await alertRules.create(tenant.id, {
      monitorId: quorum.id,
      severity: 'critical',
    });
    const quorumRef = {
      id: quorum.id,
      name: quorum.name,
      resourceId: resource.id,
      consecutiveFailuresToAlert: 1,
      minFailingLocations: 2,
    };

    // Only us-east failing -> below quorum -> no alert.
    await seedDownCheck(migrator, quorum.id, tenant.id, 'us-east');
    await alertEvaluation.evaluate(tenant.id, quorumRef, downResult);
    assert(
      (await alertCount(migrator, quorum.id)) === 0,
      'one failing location does not open an alert when a 2-location quorum is required',
    );

    // eu-west also failing -> quorum met -> alert opens.
    await seedDownCheck(migrator, quorum.id, tenant.id, 'eu-west');
    await alertEvaluation.evaluate(tenant.id, quorumRef, downResult);
    assert(
      (await alertCount(migrator, quorum.id)) === 1,
      'the alert opens once a second location is also failing (quorum reached)',
    );

    // --- Default (single-location) monitor still opens on one location ---
    const single = await monitors.create(tenant.id, {
      resourceId: resource.id,
      name: 'Single Monitor',
      monitorType: 'port',
      config: { host: '127.0.0.1', port: 1 },
      consecutiveFailuresToAlert: 1,
    });
    await alertRules.create(tenant.id, {
      monitorId: single.id,
      severity: 'critical',
    });
    const singleRef = {
      id: single.id,
      name: single.name,
      resourceId: resource.id,
      consecutiveFailuresToAlert: 1,
      minFailingLocations: 1,
    };
    await seedDownCheck(migrator, single.id, tenant.id, 'us-east');
    await alertEvaluation.evaluate(tenant.id, singleRef, downResult);
    assert(
      (await alertCount(migrator, single.id)) === 1,
      'a default (1-location) monitor still opens on the first failing location',
    );

    // The recorded checks carry their probe location.
    const { rows: located } = await migrator.query(
      `SELECT DISTINCT location FROM monitor_checks WHERE tenant_id = $1 ORDER BY location`,
      [tenant.id],
    );
    assert(
      located.map((r: { location: string }) => r.location).join(',') ===
        'eu-west,us-east',
      'checks are tagged with the probe location they ran from',
    );

    console.log('\nAll multi-location checks passed.');
  } finally {
    for (const table of [
      'alerts',
      'monitor_checks',
      'alert_rules',
      'monitors',
      'ticket_messages',
      'ticket_activities',
      'tickets',
      'ticket_number_counters',
      'resources',
    ]) {
      await migrator.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [
        tenant.id,
      ]);
    }
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
