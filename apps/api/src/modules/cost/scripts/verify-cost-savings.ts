const TEST_PORT = 34000 + Math.floor(Math.random() * 500);
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
import { MonitorsService } from '../../monitoring/monitors.service';
import { ResourcesService } from '../../monitoring/resources.service';
import { CostSavingsSweepService } from '../cost-savings-sweep.service';
import { RecommendationsService } from '../recommendations.service';
import { RightsizingSweepService } from '../rightsizing-sweep.service';
import { SavingsLogService } from '../savings-log.service';
import { TenantCostSettingsService } from '../tenant-cost-settings.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Cost savings verification FAILED: ${message}`);
  }
  console.log(`  OK  ${message}`);
}

function approxEqual(a: number, b: number, epsilon = 1) {
  return Math.abs(a - b) < epsilon;
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

  const slug = `cost-savings-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Cost Savings Verify', slug],
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
  const resources = app.get(ResourcesService);
  const monitors = app.get(MonitorsService);
  const rightsizingSweep = app.get(RightsizingSweepService);
  const recommendations = app.get(RecommendationsService);
  const savingsSweep = app.get(CostSavingsSweepService);
  const savingsLog = app.get(SavingsLogService);
  const tenantCostSettings = app.get(TenantCostSettingsService);

  try {
    // ============================================================
    // Group 1: estimateMonthlySaving heuristic, via the rightsizing sweep
    // ============================================================
    const credA = await cloudCredentials.create(tenant.id, {
      provider: 'aws',
      label: 'Estimate credential',
      config: { region: 'us-east-1', accessKeyId: 'x', secretAccessKey: 'y' },
    });

    const resA1 = await resources.create(tenant.id, {
      name: 'idle-instance',
      resourceType: 'server',
    });
    const resA2 = await resources.create(tenant.id, {
      name: 'oversized-instance',
      resourceType: 'server',
    });
    await migrator.query(
      `UPDATE resources SET cloud_credential_id = $2 WHERE id = $1`,
      [resA1.id, credA.id],
    );
    await migrator.query(
      `UPDATE resources SET cloud_credential_id = $2 WHERE id = $1`,
      [resA2.id, credA.id],
    );

    // $3000 total for last calendar month, split across the 2 server
    // resources under credA -> $1500/resource baseline.
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const daysInPrevMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0),
    ).getUTCDate();
    const prevMonthPerDay = 3000 / daysInPrevMonth;
    const prevMonthStart = new Date(monthStart);
    prevMonthStart.setUTCDate(prevMonthStart.getUTCDate() - daysInPrevMonth);
    for (let d = 0; d < daysInPrevMonth; d++) {
      const date = new Date(prevMonthStart);
      date.setUTCDate(date.getUTCDate() + d);
      await migrator.query(
        `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, region, usage_date, amount, currency)
         VALUES ($1, $2, 'Amazon EC2', 'us-east-1', $3, $4, 'USD')`,
        [tenant.id, credA.id, date.toISOString().slice(0, 10), prevMonthPerDay],
      );
    }

    const monitorA1 = await monitors.create(tenant.id, {
      resourceId: resA1.id,
      name: 'idle-instance CPU',
      monitorType: 'cloud_metric',
    });
    const monitorA2 = await monitors.create(tenant.id, {
      resourceId: resA2.id,
      name: 'oversized-instance CPU',
      monitorType: 'cloud_metric',
    });
    const seedChecks = async (monitorId: string, value: number) => {
      for (let i = 0; i < 20; i++) {
        await migrator.query(
          `INSERT INTO monitor_checks (tenant_id, monitor_id, status, raw_output, checked_at)
           VALUES ($1, $2, 'up', $3, now() - ($4 || ' hours')::interval)`,
          [
            tenant.id,
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
    await seedChecks(monitorA1.id, 2); // idle
    await seedChecks(monitorA2.id, 12); // rightsize

    await rightsizingSweep.sweepOnce();

    const { rows: recA1 } = await migrator.query(
      `SELECT * FROM rightsizing_recommendations WHERE resource_id = $1`,
      [resA1.id],
    );
    assert(
      recA1.length === 1 && recA1[0].recommendation_type === 'idle',
      'resA1 gets an idle recommendation',
    );
    assert(
      approxEqual(Number(recA1[0].estimated_monthly_saving), 1500),
      `idle estimate is ~$1500 (1500/resource * 100% fraction), got ${recA1[0].estimated_monthly_saving}`,
    );

    const { rows: recA2 } = await migrator.query(
      `SELECT * FROM rightsizing_recommendations WHERE resource_id = $1`,
      [resA2.id],
    );
    assert(
      recA2.length === 1 && recA2[0].recommendation_type === 'rightsize',
      'resA2 gets a rightsize recommendation',
    );
    assert(
      approxEqual(Number(recA2[0].estimated_monthly_saving), 750),
      `rightsize estimate is ~$750 (1500/resource * 50% fraction), got ${recA2[0].estimated_monthly_saving}`,
    );

    // ============================================================
    // Group 2: log phase -- ticket resolving triggers a cost_savings_log row
    // ============================================================
    const ticketResult = await recommendations.createTicket(
      tenant.id,
      recA1[0].id,
    );
    await migrator.query(
      `UPDATE tickets SET status = 'resolved', resolved_at = now() WHERE id = $1`,
      [ticketResult.ticketId],
    );

    const firstSweepResult = await savingsSweep.sweepOnce();
    assert(
      firstSweepResult.logged >= 1,
      `savings sweep logs at least 1 row (got ${firstSweepResult.logged})`,
    );

    const { rows: loggedRows } = await migrator.query(
      `SELECT * FROM cost_savings_log WHERE recommendation_id = $1`,
      [recA1[0].id],
    );
    assert(
      loggedRows.length === 1,
      'exactly one cost_savings_log row for the resolved recommendation',
    );
    assert(
      loggedRows[0].status === 'logged',
      'the new row starts status=logged',
    );
    assert(
      approxEqual(Number(loggedRows[0].expected_monthly_saving), 1500),
      "expected_monthly_saving matches the recommendation's own estimate",
    );
    assert(
      loggedRows[0].ticket_id === ticketResult.ticketId,
      'ticket_id is stamped',
    );

    // Rerun: no duplicate (unique index on recommendation_id + the LEFT JOIN filter)
    await savingsSweep.sweepOnce();
    const { rows: loggedRowsAfterRerun } = await migrator.query(
      `SELECT id FROM cost_savings_log WHERE recommendation_id = $1`,
      [recA1[0].id],
    );
    assert(
      loggedRowsAfterRerun.length === 1,
      'a second sweep does not log a duplicate row for the same recommendation',
    );

    // ============================================================
    // Group 3: materialize phase -- independent, manufactured rows
    // ============================================================
    const credB = await cloudCredentials.create(tenant.id, {
      provider: 'aws',
      label: 'Materialize-verified credential',
      config: { region: 'us-east-1', accessKeyId: 'x', secretAccessKey: 'y' },
    });
    const resB = await resources.create(tenant.id, {
      name: 'downsized-instance',
      resourceType: 'server',
    });
    await migrator.query(
      `UPDATE resources SET cloud_credential_id = $2 WHERE id = $1`,
      [resB.id, credB.id],
    );

    const credC = await cloudCredentials.create(tenant.id, {
      provider: 'aws',
      label: 'Materialize-unchanged credential',
      config: { region: 'us-east-1', accessKeyId: 'x', secretAccessKey: 'y' },
    });
    const resC = await resources.create(tenant.id, {
      name: 'unchanged-instance',
      resourceType: 'server',
    });
    await migrator.query(
      `UPDATE resources SET cloud_credential_id = $2 WHERE id = $1`,
      [resC.id, credC.id],
    );

    const seedWindow = async (
      credentialId: string,
      pivotOffsetDays: number,
      before: number,
      after: number,
    ) => {
      const pivot = new Date();
      pivot.setUTCDate(pivot.getUTCDate() - pivotOffsetDays);
      for (let i = 14; i >= 1; i--) {
        const date = new Date(pivot);
        date.setUTCDate(date.getUTCDate() - i);
        await migrator.query(
          `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, region, usage_date, amount, currency)
           VALUES ($1, $2, 'Amazon EC2', 'us-east-1', $3, $4, 'USD')`,
          [tenant.id, credentialId, date.toISOString().slice(0, 10), before],
        );
      }
      for (let i = 0; i < 14; i++) {
        const date = new Date(pivot);
        date.setUTCDate(date.getUTCDate() + i);
        await migrator.query(
          `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, region, usage_date, amount, currency)
           VALUES ($1, $2, 'Amazon EC2', 'us-east-1', $3, $4, 'USD')`,
          [tenant.id, credentialId, date.toISOString().slice(0, 10), after],
        );
      }
    };

    // resB: spend drops from $40/day to $10/day -- a real saving.
    await seedWindow(credB.id, 15, 40, 10);
    const {
      rows: [logB],
    } = await migrator.query(
      `INSERT INTO cost_savings_log (tenant_id, resource_id, expected_monthly_saving, status, logged_at)
       VALUES ($1, $2, 900, 'logged', now() - interval '15 days') RETURNING id`,
      [tenant.id, resB.id],
    );

    // resC: spend stays flat at $10/day -- nothing materialized.
    await seedWindow(credC.id, 15, 10, 10);
    const {
      rows: [logC],
    } = await migrator.query(
      `INSERT INTO cost_savings_log (tenant_id, resource_id, expected_monthly_saving, status, logged_at)
       VALUES ($1, $2, 100, 'logged', now() - interval '15 days') RETURNING id`,
      [tenant.id, resC.id],
    );

    // A row not yet old enough to materialize (logged 2 days ago) -- untouched.
    // Its own credential, distinct from credB -- otherwise it'd double
    // credB's resourceCount and silently halve the resB assertion below.
    const credD = await cloudCredentials.create(tenant.id, {
      provider: 'aws',
      label: 'Materialize-too-recent credential',
      config: { region: 'us-east-1', accessKeyId: 'x', secretAccessKey: 'y' },
    });
    const resD = await resources.create(tenant.id, {
      name: 'too-recent-instance',
      resourceType: 'server',
    });
    await migrator.query(
      `UPDATE resources SET cloud_credential_id = $2 WHERE id = $1`,
      [resD.id, credD.id],
    );
    const {
      rows: [logD],
    } = await migrator.query(
      `INSERT INTO cost_savings_log (tenant_id, resource_id, expected_monthly_saving, status, logged_at)
       VALUES ($1, $2, 50, 'logged', now() - interval '2 days') RETURNING id`,
      [tenant.id, resD.id],
    );

    const materializeResult = await savingsSweep.sweepOnce();
    assert(
      materializeResult.materialized >= 2,
      `savings sweep materializes at least 2 rows (got ${materializeResult.materialized})`,
    );

    const { rows: afterB } = await migrator.query(
      `SELECT * FROM cost_savings_log WHERE id = $1`,
      [logB.id],
    );
    assert(
      afterB[0].status === 'verified',
      `resB's spend drop is verified (got ${afterB[0].status})`,
    );
    assert(
      approxEqual(Number(afterB[0].actual_monthly_saving), 900),
      `resB's actual_monthly_saving is ~$900 ((1200-300)/1 resource), got ${afterB[0].actual_monthly_saving}`,
    );
    assert(afterB[0].verified_at !== null, 'verified_at is stamped');

    const { rows: afterC } = await migrator.query(
      `SELECT * FROM cost_savings_log WHERE id = $1`,
      [logC.id],
    );
    assert(
      afterC[0].status === 'not_materialized',
      `resC's flat spend is not_materialized (got ${afterC[0].status})`,
    );

    const { rows: afterD } = await migrator.query(
      `SELECT status FROM cost_savings_log WHERE id = $1`,
      [logD.id],
    );
    assert(
      afterD[0].status === 'logged',
      'a row logged too recently is left alone by the sweep',
    );

    // ============================================================
    // Group 4: savings_log list() filters
    // ============================================================
    const allLogs = await savingsLog.list(tenant.id, {});
    assert(
      allLogs.length === 4,
      `list({}) returns all 4 savings log rows (got ${allLogs.length})`,
    );

    const verifiedOnly = await savingsLog.list(tenant.id, {
      status: 'verified',
    });
    assert(
      verifiedOnly.length === 1 && verifiedOnly[0].id === logB.id,
      'list({status: "verified"}) returns only resB\'s row',
    );

    const byResource = await savingsLog.list(tenant.id, {
      resourceId: resC.id,
    });
    assert(
      byResource.length === 1 && byResource[0].id === logC.id,
      'list({resourceId}) filters correctly',
    );

    // ============================================================
    // Group 5: tenant cost settings
    // ============================================================
    const defaults = await tenantCostSettings.get(tenant.id);
    assert(
      Number(defaults.financial_year_start_month) === 4,
      `default financial_year_start_month is 4 (got ${defaults.financial_year_start_month})`,
    );
    assert(
      defaults.cost_rate_display === 'list_price',
      'default cost_rate_display is list_price',
    );

    const afterMonthUpdate = await tenantCostSettings.update(tenant.id, {
      financialYearStartMonth: 7,
    });
    assert(
      Number(afterMonthUpdate.financial_year_start_month) === 7,
      'PATCH updates financial_year_start_month',
    );
    assert(
      afterMonthUpdate.cost_rate_display === 'list_price',
      'PATCH with one field leaves the other untouched',
    );

    const afterRateUpdate = await tenantCostSettings.update(tenant.id, {
      costRateDisplay: 'negotiated',
    });
    assert(
      afterRateUpdate.cost_rate_display === 'negotiated',
      'PATCH updates cost_rate_display',
    );
    assert(
      Number(afterRateUpdate.financial_year_start_month) === 7,
      'the earlier financial_year_start_month update persists across a second, unrelated PATCH',
    );

    console.log('\nAll cost savings tracking + tenant settings checks passed.');
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
