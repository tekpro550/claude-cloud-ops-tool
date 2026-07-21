/**
 * End-to-end verify for AI executive summary in scheduled reports.
 * Tests that ReportGeneratorService.generate() includes an AI summary when
 * includeAiSummary=true and skips it gracefully when AI is disabled.
 * Requires: docker compose up -d
 */
import 'reflect-metadata';
import * as assert from 'assert';
import { DataSource } from 'typeorm';
import { AppDataSource } from '../../../../database/data-source';
import { DisabledCompletionClient } from '../../../../ai/ai-completion.client';

const FAKE_TENANT_ID = 'dddddddd-0000-0000-0000-000000000001';

async function setup(ds: DataSource) {
  await ds.query(
    `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, 'report-ai-verify') ON CONFLICT (id) DO NOTHING`,
    [FAKE_TENANT_ID, 'Report AI Summary Test'],
  );
}

async function teardown(ds: DataSource) {
  await ds.query(`DELETE FROM tenants WHERE id = $1`, [FAKE_TENANT_ID]);
}

// Minimal stub implementations for services ReportGeneratorService depends on
function makeStubServices() {
  const costDashboard = {
    summary: async (_tenantId: string) => ({
      mtdSpend: 1500.0,
      projectedMonthEnd: 3000.0,
      budgetUtilizationPct: 75,
      topServices: [
        { service: 'EC2', spend: 800 },
        { service: 'S3', spend: 400 },
      ],
      anomalies: [],
    }),
  };
  const costAllocation = {
    getCostByTag: async () => [],
  };
  const commitments = {
    listRecommendations: async () => [],
    listCommitments: async () => [],
    getCoverage: async () => ({
      coveragePct: 60,
      utilizationPct: 80,
      wastedDollars: 0,
    }),
  };
  return { costDashboard, costAllocation, commitments };
}

async function main() {
  const ds = AppDataSource;
  await ds.initialize();

  try {
    const { ReportGeneratorService } =
      await import('../report-generator.service');
    const stubs = makeStubServices();

    await teardown(ds);
    await setup(ds);

    // 1. includeAiSummary=false → no aiSummary field
    const svcNoAi = new (ReportGeneratorService as any)(
      ds,
      stubs.costDashboard,
      stubs.costAllocation,
      stubs.commitments,
      new DisabledCompletionClient(),
      { resolveClient: async () => new DisabledCompletionClient() } as any,
    );
    const tableNoAi = await svcNoAi.generate(
      FAKE_TENANT_ID,
      'cost_dashboard',
      {},
      false,
    );
    assert(!tableNoAi.aiSummary, 'no aiSummary when includeAiSummary=false');
    console.log('OK no aiSummary when flag is false');

    // 2. includeAiSummary=true + disabled client → aiSummary is undefined (graceful)
    const tableDisabled = await svcNoAi.generate(
      FAKE_TENANT_ID,
      'cost_dashboard',
      {},
      true,
    );
    assert(
      !tableDisabled.aiSummary,
      'disabled client returns no aiSummary (graceful)',
    );
    console.log('OK disabled AI client omits aiSummary gracefully');

    // 3. includeAiSummary=true + enabled fake client → aiSummary string
    const summaryText =
      'AWS spend is on track at $1,500 MTD with EC2 as the top cost driver. No anomalies detected. Consider reviewing S3 storage lifecycle policies.';
    const fakeClient = {
      enabled: true,
      async complete(_s: string, user: string) {
        assert(user.includes('Cost Dashboard'), 'report title in prompt');
        // The cost_dashboard table is metric/value rows, so assert on a real
        // row label plus the stubbed MTD figure actually reaching the prompt.
        assert(user.includes('Month to date'), 'table row label in prompt');
        assert(user.includes('1500.00'), 'table data in prompt');
        return summaryText;
      },
    };
    const svcWithAi = new (ReportGeneratorService as any)(
      ds,
      stubs.costDashboard,
      stubs.costAllocation,
      stubs.commitments,
      fakeClient,
      { resolveClient: async () => null } as any,
    );
    const tableWithAi = await svcWithAi.generate(
      FAKE_TENANT_ID,
      'cost_dashboard',
      {},
      true,
    );
    assert.equal(
      tableWithAi.aiSummary,
      summaryText,
      'AI summary stored in table',
    );
    console.log('OK AI summary generated and returned in report table');

    // 4. AI failure doesn't break the report — still returns table without summary
    const brokenClient = {
      enabled: true,
      async complete() {
        throw new Error('network error');
      },
    };
    const svcBroken = new (ReportGeneratorService as any)(
      ds,
      stubs.costDashboard,
      stubs.costAllocation,
      stubs.commitments,
      brokenClient,
      { resolveClient: async () => null } as any,
    );
    const tableBroken = await svcBroken.generate(
      FAKE_TENANT_ID,
      'cost_dashboard',
      {},
      true,
    );
    assert(tableBroken.title, 'report table still returned on AI failure');
    assert(!tableBroken.aiSummary, 'aiSummary is undefined on AI failure');
    console.log('OK AI failure does not break report delivery');

    // 5. include_ai_summary column exists on scheduled_reports table
    const [col] = await ds.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'scheduled_reports' AND column_name = 'include_ai_summary'`,
    );
    assert(col, 'include_ai_summary column exists on scheduled_reports');
    console.log('OK include_ai_summary column present in scheduled_reports');

    console.log('\nAll verify-report-ai-summary checks passed.');
  } finally {
    await teardown(ds).catch(() => {});
    await ds.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
