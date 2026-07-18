// Must be set before AppModule/ConfigModule are created -- @nestjs/config
// snapshots process.env at module init, same reason verify-alerting.ts and
// verify-logs.ts set these before importing AppModule. An interface-down
// transition opens a ticket via the same internal HTTP contract those hit.
const TEST_PORT = 33000 + Math.floor(Math.random() * 500);
process.env.PORT = String(TEST_PORT);
process.env.INTERNAL_API_BASE_URL = `http://localhost:${TEST_PORT}/api/v1`;

import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { credentialsEncryptionKeyFromEnv } from '../credentials-crypto';
import { computeThroughput } from '../network/network-throughput';
import { NetworkDevicesService } from '../network/network-devices.service';
import { NetworkPollerService } from '../network/network-poller.service';
import { SNMP_CLIENT } from '../network/snmp-client';
import { FakeSnmpClient } from './fake-snmp-client';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Network monitoring verification FAILED: ${message}`);
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

  const slug = `network-verify-${Date.now()}`;
  const {
    rows: [tenantA],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Network Verify A', slug],
  );
  const {
    rows: [tenantB],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Network Verify B', `${slug}-b`],
  );

  const fakeSnmp = new FakeSnmpClient();
  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SNMP_CLIENT)
    .useValue(fakeSnmp)
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

  const devices = app.get(NetworkDevicesService);
  const poller = app.get(NetworkPollerService);

  try {
    const device = await devices.create(tenantA.id, {
      name: 'core-switch-1',
      host: '10.0.0.1',
      community: 'public-community-secret',
    });
    assert(
      !('community' in device) && !('community_encrypted' in device),
      'the community string is never returned by the API',
    );

    const {
      rows: [decrypted],
    } = await migrator.query(
      `SELECT pgp_sym_decrypt(community_encrypted, $1) AS community FROM network_devices WHERE id = $2`,
      [credentialsEncryptionKeyFromEnv(), device.id],
    );
    assert(
      decrypted.community === 'public-community-secret',
      'the community string round-trips through encryption correctly',
    );

    const decoyDevice = await devices.create(tenantB.id, {
      name: 'other-tenant-router',
      host: '10.0.0.2',
      community: 'other-secret',
    });
    void decoyDevice;

    // --- First poll: 2 interfaces, one up, one down ---
    fakeSnmp.setReadings('10.0.0.1', [
      {
        ifIndex: 1,
        ifName: 'eth0',
        operStatus: 'up',
        inOctets: 1_000_000,
        outOctets: 500_000,
      },
      {
        ifIndex: 2,
        ifName: 'eth1',
        operStatus: 'down',
        inOctets: 0,
        outOctets: 0,
      },
    ]);
    const firstPollCount = await poller.pollOnce();
    assert(firstPollCount === 2, 'the first poll records 2 interface samples');

    const samples = await devices.latestSamples(tenantA.id, device.id);
    assert(
      samples.length === 2,
      'latestSamples() returns one row per interface',
    );
    const eth0 = samples.find((s: { if_index: number }) => s.if_index === 1);
    const eth1 = samples.find((s: { if_index: number }) => s.if_index === 2);
    assert(
      !!eth0 && eth0.oper_status === 'up',
      'eth0 (ifIndex 1) is recorded up',
    );
    assert(
      !!eth1 && eth1.oper_status === 'down',
      'eth1 (ifIndex 2) is recorded down (but was never up, so no ticket)',
    );

    const noTicketsYet = await migrator.query(
      `SELECT * FROM tickets WHERE tenant_id = $1 AND subject LIKE '[Network]%'`,
      [tenantA.id],
    );
    assert(
      noTicketsYet.rows.length === 0,
      'an interface that was never up (still down) does not open a ticket -- only a transition does',
    );

    // --- Backdate eth0's sample so throughput has a real elapsed window, then poll again ---
    await migrator.query(
      `UPDATE network_interface_samples SET ts = now() - interval '10 seconds'
       WHERE network_device_id = $1 AND if_index = 1`,
      [device.id],
    );
    fakeSnmp.setReadings('10.0.0.1', [
      {
        ifIndex: 1,
        ifName: 'eth0',
        operStatus: 'up',
        inOctets: 1_000_000 + 80_000,
        outOctets: 500_000 + 40_000,
      },
      {
        ifIndex: 2,
        ifName: 'eth1',
        operStatus: 'down',
        inOctets: 0,
        outOctets: 0,
      },
    ]);
    await poller.pollOnce();

    const eth0History = await devices.interfaceHistory(
      tenantA.id,
      device.id,
      1,
      10,
    );
    assert(
      eth0History.length === 2,
      'eth0 now has 2 consecutive samples recorded',
    );
    const throughput = computeThroughput(
      {
        ts: eth0History[0].ts,
        inOctets: eth0History[0].in_octets,
        outOctets: eth0History[0].out_octets,
      },
      {
        ts: eth0History[1].ts,
        inOctets: eth0History[1].in_octets,
        outOctets: eth0History[1].out_octets,
      },
    );
    assert(
      !!throughput && Math.abs(throughput.inBps - 64_000) < 1000,
      `throughput is computed from consecutive polls: 80000 bytes * 8 / 10s = 64000 bps -- got ${throughput?.inBps}`,
    );
    assert(
      !!throughput && Math.abs(throughput.outBps - 32_000) < 1000,
      `out throughput: 40000 bytes * 8 / 10s = 32000 bps -- got ${throughput?.outBps}`,
    );

    // --- eth0 flips from up to down: opens a ticket ---
    await migrator.query(
      `UPDATE network_interface_samples SET ts = now() - interval '10 seconds'
       WHERE network_device_id = $1 AND if_index = 1
       AND ts = (SELECT max(ts) FROM network_interface_samples WHERE network_device_id = $1 AND if_index = 1)`,
      [device.id],
    );
    fakeSnmp.setReadings('10.0.0.1', [
      {
        ifIndex: 1,
        ifName: 'eth0',
        operStatus: 'down',
        inOctets: 1_080_000,
        outOctets: 540_000,
      },
      {
        ifIndex: 2,
        ifName: 'eth1',
        operStatus: 'down',
        inOctets: 0,
        outOctets: 0,
      },
    ]);
    await poller.pollOnce();

    const { rows: downTickets } = await migrator.query(
      `SELECT * FROM tickets WHERE tenant_id = $1 AND subject LIKE '[Network]%'`,
      [tenantA.id],
    );
    assert(
      downTickets.length === 1,
      'eth0 flipping from up to down opens exactly one ticket',
    );
    assert(
      downTickets[0].subject.includes('eth0') &&
        downTickets[0].subject.includes('is down'),
      'the ticket subject names the interface that went down',
    );

    // --- Staying down doesn't open a second ticket ---
    await migrator.query(
      `UPDATE network_interface_samples SET ts = now() - interval '10 seconds'
       WHERE network_device_id = $1 AND if_index = 1
       AND ts = (SELECT max(ts) FROM network_interface_samples WHERE network_device_id = $1 AND if_index = 1)`,
      [device.id],
    );
    await poller.pollOnce();
    const { rows: stillOneTicket } = await migrator.query(
      `SELECT * FROM tickets WHERE tenant_id = $1 AND subject LIKE '[Network]%'`,
      [tenantA.id],
    );
    assert(
      stillOneTicket.length === 1,
      'an interface staying down does not open a second ticket',
    );

    // --- RLS isolation ---
    const tenantBDevices = await devices.list(tenantB.id);
    assert(
      tenantBDevices.length === 1 &&
        tenantBDevices[0].name === 'other-tenant-router',
      "RLS: tenant B's device list contains only its own device",
    );
    const tenantASamplesForTenantBDevice = await devices.latestSamples(
      tenantB.id,
      device.id,
    );
    assert(
      tenantASamplesForTenantBDevice.length === 0,
      "RLS: tenant B cannot read tenant A's interface samples even by id",
    );

    console.log('\nAll network monitoring checks passed.');
  } finally {
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenantA.id]);
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenantB.id]);
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
