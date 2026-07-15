const TEST_PORT = 32800 + Math.floor(Math.random() * 500);
process.env.PORT = String(TEST_PORT);
process.env.INTERNAL_API_BASE_URL = `http://localhost:${TEST_PORT}/api/v1`;

import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { CLOUD_PROVIDER_CLIENT_FACTORY } from '../../monitoring/cloud/cloud-provider-client';
import { CloudCredentialsService } from '../../monitoring/cloud-credentials.service';
import {
  FakeCloudProviderClient,
  makeFakeFactory,
} from '../../monitoring/scripts/fake-cloud-provider-client';
import { CostBillingSyncService } from '../cost-billing-sync.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Cost billing sync verification FAILED: ${message}`);
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

  const slug = `cost-sync-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Cost Sync Verify', slug],
  );

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const fakeAws = new FakeCloudProviderClient('aws', [], {}, [
    {
      service: 'Amazon EC2',
      region: 'us-east-1',
      usageDate: yesterday,
      amount: 12.5,
      currency: 'USD',
      raw: {},
    },
    {
      service: 'Amazon EC2',
      region: 'us-east-1',
      usageDate: today,
      amount: 4.25,
      currency: 'USD',
      raw: {},
    },
    {
      service: 'Amazon S3',
      region: 'us-east-1',
      usageDate: today,
      amount: 0.75,
      currency: 'USD',
      raw: {},
    },
  ]);

  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOUD_PROVIDER_CLIENT_FACTORY)
    .useValue(makeFakeFactory({ aws: fakeAws }))
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
  const sync = app.get(CostBillingSyncService);

  try {
    const credential = await cloudCredentials.create(tenant.id, {
      provider: 'aws',
      label: 'Verify AWS billing account',
      config: {
        fakeKey: 'aws',
        region: 'us-east-1',
        accessKeyId: 'x',
        secretAccessKey: 'y',
      },
    });

    // --- Sync 1: three line items land in cost_line_items ---
    const firstCount = await sync.syncOnce();
    assert(
      firstCount === 3,
      `syncOnce() reports 3 line items synced (got ${firstCount})`,
    );

    const { rows: lineItems } = await migrator.query(
      `SELECT service, region, usage_date, amount::float AS amount, currency FROM cost_line_items WHERE tenant_id = $1 ORDER BY usage_date, service`,
      [tenant.id],
    );
    assert(
      lineItems.length === 3,
      `exactly 3 rows land in cost_line_items (got ${lineItems.length})`,
    );
    assert(
      lineItems.some(
        (r: any) => r.service === 'Amazon EC2' && Number(r.amount) === 12.5,
      ),
      'the yesterday EC2 line item has the right amount',
    );
    assert(
      lineItems.some(
        (r: any) => r.service === 'Amazon S3' && Number(r.amount) === 0.75,
      ),
      'the S3 line item is stored as its own row, not merged into EC2',
    );

    const { rows: credRows } = await migrator.query(
      `SELECT last_polled_at FROM cloud_credentials WHERE id = $1`,
      [credential.id],
    );
    assert(
      credRows[0].last_polled_at !== null,
      'last_polled_at is stamped after a successful sync',
    );

    // --- Sync 2: same data again -- upsert, not duplicate ---
    await sync.syncOnce();
    const { rows: afterSecondSync } = await migrator.query(
      `SELECT id FROM cost_line_items WHERE tenant_id = $1`,
      [tenant.id],
    );
    assert(
      afterSecondSync.length === 3,
      'syncing again does not create duplicate rows for the same credential/service/region/day',
    );

    // --- Sync 3: the provider revises yesterday's EC2 cost -- amount updates in place ---
    fakeAws.setCostLineItems([
      {
        service: 'Amazon EC2',
        region: 'us-east-1',
        usageDate: yesterday,
        amount: 15.0,
        currency: 'USD',
        raw: {},
      },
      {
        service: 'Amazon EC2',
        region: 'us-east-1',
        usageDate: today,
        amount: 4.25,
        currency: 'USD',
        raw: {},
      },
      {
        service: 'Amazon S3',
        region: 'us-east-1',
        usageDate: today,
        amount: 0.75,
        currency: 'USD',
        raw: {},
      },
    ]);
    await sync.syncOnce();
    const { rows: revised } = await migrator.query(
      `SELECT amount::float AS amount FROM cost_line_items WHERE tenant_id = $1 AND service = 'Amazon EC2' AND usage_date = $2`,
      [tenant.id, yesterday],
    );
    assert(
      Number(revised[0].amount) === 15.0,
      "a provider revising an earlier day's cost updates the existing row in place",
    );
    const { rows: stillThree } = await migrator.query(
      `SELECT id FROM cost_line_items WHERE tenant_id = $1`,
      [tenant.id],
    );
    assert(stillThree.length === 3, 'the revision does not add a 4th row');

    console.log('\nAll cost billing sync checks passed.');
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
