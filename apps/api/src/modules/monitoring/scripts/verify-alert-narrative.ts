/**
 * Verify script for Task 5: Alert RCA narrative (M2).
 * Exercises AlertNarrativeService with a fake AI client against real Postgres.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { AiCompletionClient } from '../../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../../ai/tenant-ai-settings.service';
import { AlertNarrativeService } from '../alert-narrative.service';

const NO_SETTINGS = {
  resolveClient: async () => null,
} as unknown as TenantAiSettingsService;

class FakeNarrativeClient implements AiCompletionClient {
  readonly enabled = true;
  lastSystem = '';
  lastUser = '';
  returnValue =
    'The monitor failed due to high response time. Check database connections. Restart the app server.';
  async complete(system: string, user: string): Promise<string> {
    this.lastSystem = system;
    this.lastUser = user;
    return this.returnValue;
  }
}

class DisabledFake implements AiCompletionClient {
  readonly enabled = false;
  async complete(): Promise<string> {
    throw new Error('should not be called');
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Alert narrative verify FAILED: ${message}`);
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

  const slug = `alert-narrative-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Alert Narrative Verify', slug],
  );
  const {
    rows: [resource],
  } = await migrator.query(
    `INSERT INTO resources (tenant_id, name, kind, provider) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenant.id, 'Test Server', 'server', 'aws'],
  );

  let monitorId: string;
  let alertId: string;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const dataSource = app.get(DataSource);

  try {
    // Seed monitor + alert
    const {
      rows: [monitor],
    } = await migrator.query(
      `INSERT INTO monitors (tenant_id, resource_id, name, monitor_type, config, interval_seconds, consecutive_failures_to_alert)
       VALUES ($1, $2, 'HTTP Monitor', 'http', '{"url":"http://example.com"}', 60, 3) RETURNING id`,
      [tenant.id, resource.id],
    );
    monitorId = monitor.id;

    // Seed some recent checks
    for (let i = 0; i < 3; i++) {
      await migrator.query(
        `INSERT INTO monitor_checks (tenant_id, monitor_id, status, response_time_ms, checked_at)
         VALUES ($1, $2, 'down', null, now() - ($3 || ' minutes')::interval)`,
        [tenant.id, monitorId, i * 2],
      );
    }

    // Seed an alert rule and open alert
    const {
      rows: [rule],
    } = await migrator.query(
      `INSERT INTO alert_rules (tenant_id, monitor_id, severity, condition, is_enabled)
       VALUES ($1, $2, 'high', '{"statusIn":["down"]}', true) RETURNING id`,
      [tenant.id, monitorId],
    );
    const {
      rows: [alert],
    } = await migrator.query(
      `INSERT INTO alerts (tenant_id, monitor_id, alert_rule_id, severity, reason_text)
       VALUES ($1, $2, $3, 'high', 'HTTP Monitor is down') RETURNING id`,
      [tenant.id, monitorId, rule.id],
    );
    alertId = alert.id;

    // --- 1. Narrative is generated and persisted ---
    const fake = new FakeNarrativeClient();
    const service = new AlertNarrativeService(dataSource, fake, NO_SETTINGS);
    await service.generateNarrative(tenant.id, alertId);

    const {
      rows: [updatedAlert],
    } = await migrator.query(
      `SELECT narrative, narrative_model, narrative_generated_at FROM alerts WHERE id = $1`,
      [alertId],
    );
    assert(!!updatedAlert.narrative, 'narrative is stored on the alert');
    assert(
      updatedAlert.narrative_model === 'ai',
      'narrative_model is set to ai',
    );
    assert(
      !!updatedAlert.narrative_generated_at,
      'narrative_generated_at is set',
    );

    // --- 2. The AI prompt includes monitor context ---
    assert(
      fake.lastUser.includes('HTTP Monitor'),
      'AI prompt includes monitor name',
    );
    assert(fake.lastUser.includes('down'), 'AI prompt includes alert reason');

    // --- 3. Disabled client is a no-op (no throw) ---
    const disabledService = new AlertNarrativeService(
      dataSource,
      new DisabledFake(),
      NO_SETTINGS,
    );
    await disabledService.generateNarrative(tenant.id, alertId);
    assert(true, 'disabled client is a no-op');

    // --- 4. Non-existent alert is handled gracefully ---
    await service.generateNarrative(
      tenant.id,
      '00000000-0000-0000-0000-000000000000',
    );
    assert(true, 'unknown alertId is handled without throwing');

    console.log('\nAll alert narrative checks passed.');
  } finally {
    await migrator.query(`DELETE FROM alerts WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM alert_rules WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM monitor_checks WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM monitors WHERE tenant_id = $1`, [
      tenant.id,
    ]);
    await migrator.query(`DELETE FROM resources WHERE tenant_id = $1`, [
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
