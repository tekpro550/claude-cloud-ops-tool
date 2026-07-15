const TEST_PORT = 34500 + Math.floor(Math.random() * 500);
process.env.PORT = String(TEST_PORT);
process.env.INTERNAL_API_BASE_URL = `http://localhost:${TEST_PORT}/api/v1`;

import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { DashboardService } from '../../ticketing/dashboard/dashboard.service';
import { CLOUD_PROVIDER_CLIENT_FACTORY } from '../../monitoring/cloud/cloud-provider-client';
import { CloudCredentialsService } from '../../monitoring/cloud-credentials.service';
import {
  FakeCloudProviderClient,
  makeFakeFactory,
} from '../../monitoring/scripts/fake-cloud-provider-client';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Needs-attention verification FAILED: ${message}`);
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

  const slug = `needs-attention-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Needs Attention Verify', slug],
  );

  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOUD_PROVIDER_CLIENT_FACTORY)
    .useValue(
      makeFakeFactory({ aws: new FakeCloudProviderClient('aws', [], {}) }),
    )
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

  const cloudCredentials = app.get(CloudCredentialsService);
  const dashboard = app.get(DashboardService);

  try {
    const credential = await cloudCredentials.create(tenant.id, {
      provider: 'aws',
      label: 'Never-synced account',
      config: { region: 'us-east-1', accessKeyId: 'x', secretAccessKey: 'y' },
    });

    const isBrokenFlagged = (items: any[]) =>
      items.some((i) => i.id === 'broken_cloud_credentials');

    // --- Never synced (last_polled_at IS NULL) -- flagged ---
    let result = await dashboard.needsAttention(tenant.id);
    assert(
      isBrokenFlagged(result.items),
      'a cloud_credential that has never synced is flagged',
    );

    // --- Freshly synced -- not flagged ---
    await migrator.query(
      `UPDATE cloud_credentials SET last_polled_at = now() WHERE id = $1`,
      [credential.id],
    );
    result = await dashboard.needsAttention(tenant.id);
    assert(
      !isBrokenFlagged(result.items),
      'a freshly synced cloud_credential is not flagged',
    );

    // --- Stale (27h old) -- flagged again ---
    await migrator.query(
      `UPDATE cloud_credentials SET last_polled_at = now() - interval '27 hours' WHERE id = $1`,
      [credential.id],
    );
    result = await dashboard.needsAttention(tenant.id);
    assert(
      isBrokenFlagged(result.items),
      'a cloud_credential stale for 27h is flagged',
    );
    const brokenItem = result.items.find(
      (i: any) => i.id === 'broken_cloud_credentials',
    );
    assert(
      brokenItem.severity === 'critical',
      'the broken_cloud_credentials item is severity=critical',
    );
    assert(
      brokenItem.count === 1,
      `count matches the number of stale credentials (got ${brokenItem.count})`,
    );

    // --- Just under the threshold (25h old) -- not flagged ---
    await migrator.query(
      `UPDATE cloud_credentials SET last_polled_at = now() - interval '25 hours' WHERE id = $1`,
      [credential.id],
    );
    result = await dashboard.needsAttention(tenant.id);
    assert(
      !isBrokenFlagged(result.items),
      'a cloud_credential still within the 26h grace period is not flagged',
    );

    // --- A disabled credential, however stale, is never flagged ---
    await migrator.query(
      `UPDATE cloud_credentials SET is_enabled = false, last_polled_at = now() - interval '400 hours' WHERE id = $1`,
      [credential.id],
    );
    result = await dashboard.needsAttention(tenant.id);
    assert(
      !isBrokenFlagged(result.items),
      'a disabled cloud_credential is never flagged, however stale',
    );

    console.log(
      '\nAll needs-attention (broken cloud credentials) checks passed.',
    );
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
