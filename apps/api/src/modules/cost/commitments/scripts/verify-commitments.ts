import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { computeCoverage, computeUtilization } from '../commitment-coverage';
import { recommendCommitment } from '../commitment-recommend';
import { CommitmentSweepService } from '../commitment-sweep.service';
import { CommitmentsService } from '../commitments.service';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Commitments verification FAILED: ${message}`);
  }
  console.log(`  OK  ${message}`);
}

function approx(actual: number, expected: number, tolerance = 0.5): boolean {
  return Math.abs(actual - expected) <= tolerance;
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

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  // ---- Pure function unit tests ----
  const coverage = computeCoverage([100, 100, 300, 100, 100], 120);
  assert(
    approx(coverage.coveragePct, 74.29, 0.1),
    `computeCoverage handles a spike day correctly (got ${coverage.coveragePct.toFixed(2)}%)`,
  );
  const utilization = computeUtilization([100, 100, 300, 100, 100], 120);
  assert(
    approx(utilization.utilizationPct, 86.67, 0.1) &&
      approx(utilization.wastedAmount, 80, 0.1),
    `computeUtilization reports the unused commitment as waste (got ${utilization.utilizationPct.toFixed(2)}%, waste ${utilization.wastedAmount})`,
  );
  assert(
    recommendCommitment([10, 10, 10], 'savings_plan') === null,
    'recommendCommitment refuses to recommend from fewer than 14 days of history',
  );
  const stableBaseline = Array.from({ length: 20 }, () => 15);
  const flatReco = recommendCommitment(stableBaseline, 'reserved_instance');
  assert(
    flatReco !== null &&
      approx(flatReco.recommendedDailyCommitment, 15, 0.01) &&
      flatReco.estimatedMonthlySavings > 0 &&
      flatReco.breakEvenMonths > 0,
    'recommendCommitment on a flat baseline recommends that exact level with positive savings',
  );

  // ---- End-to-end ----
  const migrator = migratorClient();
  await migrator.connect();
  const slug = `commitments-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Commitments Verify', slug],
  );
  const tenantId = tenant.id as string;
  const encryptionKey =
    process.env.CREDENTIALS_ENCRYPTION_KEY ??
    'dev-only-credentials-key-change-me-in-prod';
  const {
    rows: [cred],
  } = await migrator.query(
    `INSERT INTO cloud_credentials (tenant_id, provider, label, config_encrypted)
     VALUES ($1, 'aws', 'commitments test', pgp_sym_encrypt('{}', $2)) RETURNING id`,
    [tenantId, encryptionKey],
  );

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const commitments = app.get(CommitmentsService);
  const sweep = app.get(CommitmentSweepService);

  try {
    // ---- Coverage/utilization against a real commitment ----
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const coverageAmounts = [100, 100, 300, 100, 100];
    for (let i = 4; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      await migrator.query(
        `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, region, usage_date, amount)
         VALUES ($1, $2, 'RDS', 'us-east-1', $3, $4)`,
        [tenantId, cred.id, iso(d), coverageAmounts[4 - i]],
      );
    }
    const startDate = new Date(today);
    startDate.setUTCDate(startDate.getUTCDate() - 4);

    const commitment = await commitments.create(tenantId, {
      cloudCredentialId: cred.id,
      kind: 'reserved_instance',
      service: 'RDS',
      region: 'us-east-1',
      termMonths: 12,
      hourlyCommitment: 5, // $5/hr * 24 = $120/day, matches the pure-function case above
      startDate: iso(startDate),
      endDate: iso(today),
    });

    const coverageResult = await commitments.getCoverage(
      tenantId,
      commitment.id,
    );
    assert(
      coverageResult.coverage !== null &&
        approx(coverageResult.coverage.coveragePct, 74.29, 0.5),
      `getCoverage computes the same coverage % as the pure function (got ${coverageResult.coverage?.coveragePct.toFixed(2)}%)`,
    );
    assert(
      coverageResult.utilization !== null &&
        approx(coverageResult.utilization.wastedAmount, 80, 0.5),
      `getCoverage computes wasted commitment amount (got ${coverageResult.utilization?.wastedAmount})`,
    );

    // ---- Cross-tenant credential is rejected ----
    const {
      rows: [otherTenant],
    } = await migrator.query(
      `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
      ['Commitments Verify Other', `${slug}-other`],
    );
    const {
      rows: [otherCred],
    } = await migrator.query(
      `INSERT INTO cloud_credentials (tenant_id, provider, label, config_encrypted)
       VALUES ($1, 'aws', 'other tenant cred', pgp_sym_encrypt('{}', $2)) RETURNING id`,
      [otherTenant.id, encryptionKey],
    );
    let crossTenantCredential: any = null;
    try {
      await commitments.create(tenantId, {
        cloudCredentialId: otherCred.id,
        kind: 'savings_plan',
        service: 'EC2',
        termMonths: 12,
        hourlyCommitment: 1,
        startDate: iso(startDate),
        endDate: iso(today),
      });
    } catch (err) {
      crossTenantCredential = err;
    }
    assert(
      crossTenantCredential?.status === 404,
      'a commitment cannot reference another tenant’s cloud credential',
    );

    // ---- RLS isolation ----
    const otherTenantCommitments = await commitments.list(otherTenant.id);
    assert(
      otherTenantCommitments.length === 0,
      'RLS hides one tenant’s commitments from another',
    );

    // ---- Sweep-generated recommendations ----
    const yesterday = new Date(today);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const sweepDailyPattern = [18, 20, 22];
    for (let i = 30; i >= 1; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      await migrator.query(
        `INSERT INTO cost_line_items (tenant_id, cloud_credential_id, service, region, usage_date, amount)
         VALUES ($1, $2, 'EC2', 'us-west-2', $3, $4)`,
        [tenantId, cred.id, iso(d), sweepDailyPattern[i % 3]],
      );
    }

    await sweep.sweepOnce();
    const recommendations = await commitments.listRecommendations(tenantId);
    const ec2Recos = recommendations.filter(
      (r: any) => r.service === 'EC2' && r.region === 'us-west-2',
    );
    assert(
      ec2Recos.length === 2,
      `the sweep generates a recommendation for both commitment kinds (got ${ec2Recos.length})`,
    );
    assert(
      ec2Recos.every((r: any) => Number(r.based_on_days) === 30),
      'each recommendation is based on the full 30-day lookback window',
    );
    assert(
      ec2Recos.every((r: any) => Number(r.estimated_monthly_savings) > 0),
      'every recommendation estimates positive monthly savings',
    );
    const riReco = ec2Recos.find((r: any) => r.kind === 'reserved_instance');
    const spReco = ec2Recos.find((r: any) => r.kind === 'savings_plan');
    assert(
      Number(riReco.estimated_monthly_savings) >
        Number(spReco.estimated_monthly_savings),
      'a reserved instance recommends higher savings than a savings plan at the same usage (bigger discount)',
    );

    // ---- Idempotent re-sweep: still exactly one row per scope+kind ----
    await sweep.sweepOnce();
    const recommendationsAfterResweep =
      await commitments.listRecommendations(tenantId);
    const ec2RecosAfter = recommendationsAfterResweep.filter(
      (r: any) => r.service === 'EC2' && r.region === 'us-west-2',
    );
    assert(
      ec2RecosAfter.length === 2,
      'a second sweep updates existing recommendations in place rather than duplicating them',
    );

    // ---- Dismiss ----
    await commitments.dismissRecommendation(tenantId, riReco.id);
    const afterDismiss = await commitments.listRecommendations(tenantId);
    assert(
      !afterDismiss.some((r: any) => r.id === riReco.id),
      'a dismissed recommendation no longer appears in the open list',
    );

    console.log('\nAll commitments checks passed.');
  } finally {
    await app.close();
    await migrator.query(`DELETE FROM tenants WHERE slug LIKE $1`, [
      `${slug}%`,
    ]);
    await migrator.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
