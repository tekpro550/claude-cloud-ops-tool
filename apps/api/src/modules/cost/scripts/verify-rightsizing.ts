const TEST_PORT = 33500 + Math.floor(Math.random() * 500);
process.env.PORT = String(TEST_PORT);
process.env.INTERNAL_API_BASE_URL = `http://localhost:${TEST_PORT}/api/v1`;

import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import { AppModule } from '../../../app.module';
import { MonitorsService } from '../../monitoring/monitors.service';
import { ResourcesService } from '../../monitoring/resources.service';
import { RecommendationsService } from '../recommendations.service';
import { RightsizingSweepService } from '../rightsizing-sweep.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Rightsizing verification FAILED: ${message}`);
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

  const slug = `rightsizing-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Rightsizing Verify', slug],
  );

  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

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

  const resources = app.get(ResourcesService);
  const monitors = app.get(MonitorsService);
  const sweep = app.get(RightsizingSweepService);
  const recommendations = app.get(RecommendationsService);

  const seedChecks = async (
    monitorId: string,
    tenantId: string,
    value: number,
    count: number,
  ) => {
    for (let i = 0; i < count; i++) {
      await migrator.query(
        `INSERT INTO monitor_checks (tenant_id, monitor_id, status, raw_output, checked_at)
         VALUES ($1, $2, 'up', $3, now() - ($4 || ' hours')::interval)`,
        [
          tenantId,
          monitorId,
          JSON.stringify({
            metricName: 'CPUUtilization',
            value,
            unit: 'Percent',
          }),
          i * 6,
        ],
      );
    }
  };

  try {
    // --- Idle resource: CPU averaging 2% over 14 days ---
    const idleResource = await resources.create(tenant.id, {
      name: 'idle-ec2-instance',
      resourceType: 'server',
    });
    const idleMonitor = await monitors.create(tenant.id, {
      resourceId: idleResource.id,
      name: 'idle-ec2-instance CPU',
      monitorType: 'cloud_metric',
    });
    await seedChecks(idleMonitor.id, tenant.id, 2, 20);

    // --- Rightsize resource: CPU averaging 12% over 14 days ---
    const rightsizeResource = await resources.create(tenant.id, {
      name: 'oversized-ec2-instance',
      resourceType: 'server',
    });
    const rightsizeMonitor = await monitors.create(tenant.id, {
      resourceId: rightsizeResource.id,
      name: 'oversized-ec2-instance CPU',
      monitorType: 'cloud_metric',
    });
    await seedChecks(rightsizeMonitor.id, tenant.id, 12, 20);

    // --- Healthy resource: CPU averaging 55% over 14 days -- no recommendation ---
    const healthyResource = await resources.create(tenant.id, {
      name: 'healthy-ec2-instance',
      resourceType: 'server',
    });
    const healthyMonitor = await monitors.create(tenant.id, {
      resourceId: healthyResource.id,
      name: 'healthy-ec2-instance CPU',
      monitorType: 'cloud_metric',
    });
    await seedChecks(healthyMonitor.id, tenant.id, 55, 20);

    // --- A monitor with no metric samples at all (only "down" checks) -- no recommendation ---
    const noDataResource = await resources.create(tenant.id, {
      name: 'unreachable-ec2-instance',
      resourceType: 'server',
    });
    const noDataMonitor = await monitors.create(tenant.id, {
      resourceId: noDataResource.id,
      name: 'unreachable-ec2-instance CPU',
      monitorType: 'cloud_metric',
    });
    await migrator.query(
      `INSERT INTO monitor_checks (tenant_id, monitor_id, status, raw_output)
       VALUES ($1, $2, 'down', $3)`,
      [
        tenant.id,
        noDataMonitor.id,
        JSON.stringify({
          error: 'no metric data returned by the provider for this resource',
        }),
      ],
    );

    const alertedCount = await sweep.sweepOnce();
    assert(
      alertedCount === 2,
      `sweepOnce() reports 2 resources flagged (got ${alertedCount})`,
    );

    const { rows: idleRecs } = await migrator.query(
      `SELECT * FROM rightsizing_recommendations WHERE resource_id = $1`,
      [idleResource.id],
    );
    assert(
      idleRecs.length === 1,
      'the idle resource gets exactly one recommendation',
    );
    assert(
      idleRecs[0].recommendation_type === 'idle',
      `a ~2% average CPU is type=idle (got ${idleRecs[0].recommendation_type})`,
    );
    assert(idleRecs[0].status === 'open', 'the new recommendation is open');
    assert(
      idleRecs[0].reason_text.includes('idle-ec2-instance'),
      'reason_text names the resource',
    );
    assert(
      idleRecs[0].estimated_monthly_saving === null,
      'estimated_monthly_saving is left null (no per-instance cost data yet)',
    );

    const { rows: rightsizeRecs } = await migrator.query(
      `SELECT * FROM rightsizing_recommendations WHERE resource_id = $1`,
      [rightsizeResource.id],
    );
    assert(
      rightsizeRecs.length === 1,
      'the oversized resource gets exactly one recommendation',
    );
    assert(
      rightsizeRecs[0].recommendation_type === 'rightsize',
      `a ~12% average CPU is type=rightsize (got ${rightsizeRecs[0].recommendation_type})`,
    );

    const { rows: healthyRecs } = await migrator.query(
      `SELECT * FROM rightsizing_recommendations WHERE resource_id = $1`,
      [healthyResource.id],
    );
    assert(
      healthyRecs.length === 0,
      'the healthy resource gets no recommendation',
    );

    const { rows: noDataRecs } = await migrator.query(
      `SELECT * FROM rightsizing_recommendations WHERE resource_id = $1`,
      [noDataResource.id],
    );
    assert(
      noDataRecs.length === 0,
      'a monitor with no metric samples gets no recommendation, not a false idle flag',
    );

    // --- Rerun: same data, updates in place, no duplicate ---
    await sweep.sweepOnce();
    const { rows: idleRecsAfterRerun } = await migrator.query(
      `SELECT id FROM rightsizing_recommendations WHERE resource_id = $1`,
      [idleResource.id],
    );
    assert(
      idleRecsAfterRerun.length === 1,
      'a second sweep does not duplicate the open recommendation',
    );

    // --- Utilization recovers -- the open recommendation auto-resolves ---
    await migrator.query(
      `INSERT INTO monitor_checks (tenant_id, monitor_id, status, raw_output, checked_at)
       SELECT $1, $2, 'up', $3, now() - (i || ' hours')::interval FROM generate_series(0, 19) AS i`,
      [
        tenant.id,
        idleMonitor.id,
        JSON.stringify({
          metricName: 'CPUUtilization',
          value: 60,
          unit: 'Percent',
        }),
      ],
    );
    await sweep.sweepOnce();
    const { rows: idleRecsAfterRecovery } = await migrator.query(
      `SELECT status FROM rightsizing_recommendations WHERE resource_id = $1`,
      [idleResource.id],
    );
    assert(
      idleRecsAfterRecovery[0].status === 'resolved',
      'utilization recovering auto-resolves the open recommendation',
    );

    // --- RecommendationsService.list() filters ---
    const openList = await recommendations.list(tenant.id, { status: 'open' });
    assert(
      openList.length === 1 && openList[0].resource_id === rightsizeResource.id,
      'list({status: "open"}) returns only the still-open rightsize recommendation',
    );
    const typeList = await recommendations.list(tenant.id, { type: 'idle' });
    assert(
      typeList.length === 1,
      'list({type: "idle"}) filters by recommendation_type',
    );

    // --- Dismiss ---
    const dismissed = await recommendations.update(
      tenant.id,
      rightsizeRecs[0].id,
      { status: 'dismissed' },
    );
    assert(
      dismissed.status === 'dismissed',
      'update() can dismiss an open recommendation',
    );

    // --- create_ticket: idempotent, links a real ticket ---
    // The idle recommendation resolved and the rightsize one was just
    // dismissed, so seed one more open recommendation to exercise create_ticket.
    const freshResource = await resources.create(tenant.id, {
      name: 'idle-2',
      resourceType: 'server',
    });
    const freshMonitor = await monitors.create(tenant.id, {
      resourceId: freshResource.id,
      name: 'idle-2 CPU',
      monitorType: 'cloud_metric',
    });
    await seedChecks(freshMonitor.id, tenant.id, 1, 20);
    await sweep.sweepOnce();
    const { rows: freshRecs } = await migrator.query(
      `SELECT * FROM rightsizing_recommendations WHERE resource_id = $1`,
      [freshResource.id],
    );
    assert(
      freshRecs.length === 1 && freshRecs[0].status === 'open',
      'a fresh idle recommendation is open before create_ticket',
    );

    const ticketResult = await recommendations.createTicket(
      tenant.id,
      freshRecs[0].id,
    );
    assert(!!ticketResult.ticketId, 'create_ticket() returns a real ticket id');

    const { rows: afterTicket } = await migrator.query(
      `SELECT status, ticket_id FROM rightsizing_recommendations WHERE id = $1`,
      [freshRecs[0].id],
    );
    assert(
      afterTicket[0].status === 'ticket_created',
      'the recommendation moves to status=ticket_created',
    );
    assert(
      afterTicket[0].ticket_id === ticketResult.ticketId,
      'ticket_id is stamped on the recommendation',
    );

    const { rows: ticketRows } = await migrator.query(
      `SELECT subject FROM tickets WHERE id = $1`,
      [ticketResult.ticketId],
    );
    assert(
      ticketRows.length === 1 && ticketRows[0].subject.includes('idle-2'),
      'the created ticket exists and names the resource',
    );

    const secondCallResult = await recommendations.createTicket(
      tenant.id,
      freshRecs[0].id,
    );
    assert(
      secondCallResult.ticketId === ticketResult.ticketId,
      'calling create_ticket again on the same recommendation is idempotent -- same ticket, not a second one',
    );

    console.log('\nAll rightsizing recommendation checks passed.');
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
