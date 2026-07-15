import 'dotenv/config';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { MonitorSchedulerService } from '../monitor-scheduler.service';
import { MonitorsService } from '../monitors.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Monitor engine verification FAILED: ${message}`);
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

  // A local, controllable HTTP target -- checking against a real external
  // site would make this script's pass/fail depend on outbound network
  // conditions this environment doesn't control.
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const localPort = (server.address() as AddressInfo).port;

  const slug = `monitor-engine-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Monitor Engine Verify', slug],
  );
  const {
    rows: [otherTenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Monitor Engine Verify (other tenant)', `${slug}-other`],
  );

  const {
    rows: [resource],
  } = await migrator.query(
    `INSERT INTO resources (tenant_id, name, resource_type) VALUES ($1, $2, 'server') RETURNING id`,
    [tenant.id, 'Verify Target Server'],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const monitors = app.get(MonitorsService);
  const scheduler = app.get(MonitorSchedulerService);

  try {
    // --- CRUD + validation ---
    let rejected = false;
    try {
      await monitors.create(tenant.id, {
        resourceId: '00000000-0000-0000-0000-000000000000',
        name: 'Bad resource ref',
        monitorType: 'http',
      });
    } catch {
      rejected = true;
    }
    assert(
      rejected,
      'create() rejects a monitor pointing at a nonexistent resource',
    );

    const httpUp = await monitors.create(tenant.id, {
      resourceId: resource.id,
      name: 'Local HTTP (up)',
      monitorType: 'http',
      config: { url: `http://127.0.0.1:${localPort}/`, timeoutMs: 3000 },
      intervalSeconds: 60,
    });
    const httpDown = await monitors.create(tenant.id, {
      resourceId: resource.id,
      name: 'Local HTTP (down, closed port)',
      monitorType: 'http',
      config: { url: 'http://127.0.0.1:1/', timeoutMs: 1000 },
      intervalSeconds: 60,
    });
    const portUp = await monitors.create(tenant.id, {
      resourceId: resource.id,
      name: 'Local port (up)',
      monitorType: 'port',
      config: { host: '127.0.0.1', port: localPort, timeoutMs: 2000 },
      intervalSeconds: 60,
    });
    const disabled = await monitors.create(tenant.id, {
      resourceId: resource.id,
      name: 'Disabled monitor',
      monitorType: 'port',
      config: { host: '127.0.0.1', port: localPort, timeoutMs: 2000 },
      isEnabled: false,
    });

    const updated = await monitors.update(tenant.id, httpUp.id, {
      name: 'Renamed',
    });
    assert(updated.name === 'Renamed', 'update() persists a field change');

    // --- Scheduler: first sweep should check every enabled monitor once ---
    const firstSweepCount = await scheduler.runSweepOnce();
    assert(
      firstSweepCount >= 3,
      `first sweep checks all due monitors across all tenants (got ${firstSweepCount})`,
    );

    const listed = await monitors.list(tenant.id);
    const byId = new Map<string, any>(listed.map((m: any) => [m.id, m]));
    assert(
      byId.get(httpUp.id).last_status === 'up',
      'HTTP monitor against a live local server records up',
    );
    assert(
      byId.get(httpDown.id).last_status === 'down',
      'HTTP monitor against a closed port records down',
    );
    assert(
      byId.get(portUp.id).last_status === 'up',
      'Port monitor against a live local server records up',
    );
    assert(
      byId.get(disabled.id).last_status === null,
      'disabled monitor is never scheduled, so it has no recorded check',
    );

    const { rows: checkRows } = await migrator.query(
      `SELECT response_time_ms, raw_output FROM monitor_checks WHERE monitor_id = $1`,
      [httpUp.id],
    );
    assert(
      checkRows.length === 1 && checkRows[0].response_time_ms !== null,
      'monitor_checks records a response_time_ms for the HTTP check',
    );
    assert(
      checkRows[0].raw_output.httpStatus === 200,
      'monitor_checks.raw_output captures the HTTP status code',
    );

    // --- checks() history endpoint (the uptime history bar's data source) ---
    const history = await monitors.checks(tenant.id, httpUp.id, 10);
    assert(
      history.length === 1 && history[0].status === 'up',
      `checks() returns the one recorded check for this monitor (got ${history.length})`,
    );
    let historyRejected = false;
    try {
      await monitors.checks(
        tenant.id,
        '00000000-0000-0000-0000-000000000000',
        10,
      );
    } catch {
      historyRejected = true;
    }
    assert(
      historyRejected,
      "checks() 404s for a monitor id that doesn't exist rather than returning an empty array",
    );

    // --- Scheduler: a monitor just checked within its interval isn't due again ---
    const secondSweepCount = await scheduler.runSweepOnce();
    assert(
      secondSweepCount === 0,
      `sweeping immediately again finds nothing due yet (got ${secondSweepCount})`,
    );

    // --- Tenant isolation ---
    const otherResource = await migrator.query(
      `INSERT INTO resources (tenant_id, name, resource_type) VALUES ($1, $2, 'server') RETURNING id`,
      [otherTenant.id, 'Other Tenant Resource'],
    );
    await monitors.create(otherTenant.id, {
      resourceId: otherResource.rows[0].id,
      name: 'Other tenant monitor',
      monitorType: 'port',
      config: { host: '127.0.0.1', port: localPort },
    });
    const tenantAList = await monitors.list(tenant.id);
    assert(
      tenantAList.every((m: any) => m.id !== undefined) &&
        !tenantAList.some((m: any) => m.name === 'Other tenant monitor'),
      "tenant A's monitor list never includes tenant B's monitors",
    );

    // --- Delete cascades to monitor_checks ---
    await monitors.remove(tenant.id, httpUp.id);
    const { rows: orphanedChecks } = await migrator.query(
      `SELECT id FROM monitor_checks WHERE monitor_id = $1`,
      [httpUp.id],
    );
    assert(
      orphanedChecks.length === 0,
      'deleting a monitor cascades to its monitor_checks rows',
    );

    console.log('\nAll monitor engine checks passed.');
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await migrator.query(`DELETE FROM tenants WHERE id = ANY($1)`, [
      [tenant.id, otherTenant.id],
    ]);
    await migrator.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
