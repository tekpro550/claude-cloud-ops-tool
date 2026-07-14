const TEST_PORT = 32300 + Math.floor(Math.random() * 500);
process.env.PORT = String(TEST_PORT);
process.env.INTERNAL_API_BASE_URL = `http://localhost:${TEST_PORT}/api/v1`;

import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { AlertRulesService } from '../alert-rules.service';
import { CLOUD_PROVIDER_CLIENT_FACTORY } from '../cloud/cloud-provider-client';
import { CloudCredentialsService } from '../cloud-credentials.service';
import { CloudResourcePollerService } from '../cloud-resource-poller.service';
import { MonitorsService } from '../monitors.service';
import {
  FakeCloudProviderClient,
  makeFakeFactory,
} from './fake-cloud-provider-client';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Cloud polling verification FAILED: ${message}`);
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

  const slug = `cloud-polling-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Cloud Polling Verify', slug],
  );

  const fakeAws = new FakeCloudProviderClient(
    'aws',
    [
      {
        externalId: 'i-abc123',
        name: 'web-01',
        provider: 'aws',
        region: 'us-east-1',
      },
      {
        externalId: 'i-def456',
        name: 'web-02',
        provider: 'aws',
        region: 'us-east-1',
      },
    ],
    {
      'i-abc123': [
        { metricName: 'CPUUtilization', value: 20, unit: 'Percent' },
      ],
    },
  );

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
  const monitors = app.get(MonitorsService);
  const alertRules = app.get(AlertRulesService);
  const poller = app.get(CloudResourcePollerService);

  try {
    const credential = await cloudCredentials.create(tenant.id, {
      provider: 'aws',
      label: 'Verify AWS account',
      config: {
        fakeKey: 'aws',
        region: 'us-east-1',
        accessKeyId: 'x',
        secretAccessKey: 'y',
      },
    });
    assert(
      !('config' in credential),
      'create() never echoes the raw config/secrets back in its response',
    );

    // --- Poll 1: discovers two EC2 instances, upserts them as resources ---
    await poller.pollOnce();

    const { rows: resourceRows } = await migrator.query(
      `SELECT id, name, resource_type, external_ref FROM resources WHERE tenant_id = $1 ORDER BY name`,
      [tenant.id],
    );
    assert(
      resourceRows.length === 2,
      'polling discovers and creates one resource per remote instance',
    );
    assert(
      resourceRows[0].resource_type === 'server',
      'a discovered cloud instance is stored as resource_type=server',
    );
    assert(
      resourceRows[0].external_ref.externalId === 'i-abc123' &&
        resourceRows[0].external_ref.provider === 'aws',
      'external_ref is populated with the real provider id -- this is the first thing to ever write it',
    );

    const { rows: credRows } = await migrator.query(
      `SELECT last_polled_at FROM cloud_credentials WHERE id = $1`,
      [credential.id],
    );
    assert(
      credRows[0].last_polled_at !== null,
      'last_polled_at is stamped after a successful poll',
    );

    // --- Poll 2: same instances again -- upsert, not duplicate ---
    await poller.pollOnce();
    const { rows: afterSecondPoll } = await migrator.query(
      `SELECT id FROM resources WHERE tenant_id = $1`,
      [tenant.id],
    );
    assert(
      afterSecondPoll.length === 2,
      'polling again does not create duplicate resources for the same external id',
    );

    // --- A cloud_metric monitor on the polled resource gets evaluated using live metric data ---
    const webOne = resourceRows.find(
      (r: any) => r.external_ref.externalId === 'i-abc123',
    );
    const monitor = await monitors.create(tenant.id, {
      resourceId: webOne.id,
      name: 'web-01 CPU',
      monitorType: 'cloud_metric',
      config: { criticalPercent: 90 },
      consecutiveFailuresToAlert: 2,
    });
    await alertRules.create(tenant.id, {
      monitorId: monitor.id,
      severity: 'critical',
    });

    await poller.pollOnce();
    const { rows: healthyCheck } = await migrator.query(
      `SELECT status, raw_output FROM monitor_checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT 1`,
      [monitor.id],
    );
    assert(
      healthyCheck[0].status === 'up',
      'a low CPU metric (20%) records status=up',
    );
    assert(
      healthyCheck[0].raw_output.metricName === 'CPUUtilization',
      'the check records which metric was evaluated',
    );

    // --- Metric goes critical -- alert opens and links a real ticket, same pipeline as every other monitor type ---
    fakeAws.setMetrics('i-abc123', [
      { metricName: 'CPUUtilization', value: 97, unit: 'Percent' },
    ]);
    await poller.pollOnce();
    await poller.pollOnce();
    const { rows: alertRows } = await migrator.query(
      `SELECT * FROM alerts WHERE monitor_id = $1`,
      [monitor.id],
    );
    assert(
      alertRows.length === 1,
      'two consecutive critical CPU polls open exactly one alert',
    );
    assert(
      alertRows[0].ticket_id !== null,
      'the cloud-metric-driven alert links a real ticket',
    );

    // --- A resource with no metrics available for its external id records down, not a crash ---
    const webTwo = resourceRows.find(
      (r: any) => r.external_ref.externalId === 'i-def456',
    );
    const monitorTwo = await monitors.create(tenant.id, {
      resourceId: webTwo.id,
      name: 'web-02 CPU',
      monitorType: 'cloud_metric',
    });
    await poller.pollOnce();
    const { rows: noDataCheck } = await migrator.query(
      `SELECT status, raw_output FROM monitor_checks WHERE monitor_id = $1 ORDER BY checked_at DESC LIMIT 1`,
      [monitorTwo.id],
    );
    assert(
      noDataCheck[0].status === 'down',
      'a resource with no metric data available from the provider records down, not up or a crash',
    );

    console.log('\nAll cloud polling checks passed.');
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
