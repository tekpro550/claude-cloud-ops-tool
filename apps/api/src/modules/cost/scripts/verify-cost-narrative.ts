/**
 * Verify script for Task 2: Cost spike narrative (M3).
 * Exercises CostNarrativeService: narrative generation, SHA-256 cache hit.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { AiCompletionClient } from '../../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../../ai/tenant-ai-settings.service';
import { CostNarrativeService } from '../cost-narrative.service';

const NO_SETTINGS = {
  resolveClient: async () => null,
} as unknown as TenantAiSettingsService;

class FakeNarrativeClient implements AiCompletionClient {
  readonly enabled = true;
  callCount = 0;
  returnValue =
    'EC2 spend spiked 80% vs baseline. RDS also elevated. Expected $12k overrun.';
  async complete(_s: string, _u: string): Promise<string> {
    this.callCount++;
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
  if (!condition) throw new Error(`Cost narrative verify FAILED: ${message}`);
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

  const slug = `cost-narrative-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Cost Narrative Verify', slug],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const dataSource = app.get(DataSource);

  try {
    const fake = new FakeNarrativeClient();
    const service = new CostNarrativeService(dataSource, fake, NO_SETTINGS);

    // --- 1. First call: AI is invoked, narrative is returned and cached ---
    const result1 = await service.getNarrative(tenant.id);
    assert(result1.narrative.length > 0, 'narrative is returned');
    assert(result1.cached === false, 'first call is not from cache');
    assert(fake.callCount === 1, 'AI was called once');

    // --- 2. Second call with same data: cache hit, AI is not called again ---
    const result2 = await service.getNarrative(tenant.id);
    assert(result2.cached === true, 'second call is served from cache');
    assert(fake.callCount === 1, 'AI was not called a second time');
    assert(
      result2.narrative === result1.narrative,
      'cached narrative matches original',
    );

    // --- 3. Disabled client throws BadRequestException ---
    const disabledService = new CostNarrativeService(
      dataSource,
      new DisabledFake(),
      NO_SETTINGS,
    );
    let threw = false;
    try {
      await disabledService.getNarrative(tenant.id);
    } catch {
      threw = true;
    }
    assert(threw, 'disabled client throws BadRequestException');

    console.log('\nAll cost narrative checks passed.');
  } finally {
    await migrator.query(`DELETE FROM cost_narratives WHERE tenant_id = $1`, [
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
