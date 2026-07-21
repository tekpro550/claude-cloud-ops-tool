/**
 * Verify script for the NL custom-report builder (AI value-add).
 * Uses a fake AI client; the generator is pure (validates via
 * buildReportQuery), so no database is needed.
 */
import 'reflect-metadata';
import * as assert from 'assert';
import { BadRequestException } from '@nestjs/common';
import { AiCompletionClient } from '../../../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../../../ai/tenant-ai-settings.service';
import { ReportNlService } from '../report-nl.service';

const NO_SETTINGS = {
  resolveClient: async () => null,
} as unknown as TenantAiSettingsService;

class FakeClient implements AiCompletionClient {
  readonly enabled = true;
  constructor(public returnValue: string) {}
  async complete(): Promise<string> {
    return this.returnValue;
  }
}
class DisabledFake implements AiCompletionClient {
  readonly enabled = false;
  async complete(): Promise<string> {
    throw new Error('should not be called');
  }
}

function ok(m: string) {
  console.log(`  OK  ${m}`);
}
const TENANT = '00000000-0000-0000-0000-0000000000bb';

async function expectReject(fn: () => Promise<unknown>, label: string) {
  let threw = false;
  try {
    await fn();
  } catch (err) {
    threw = true;
    assert(
      err instanceof BadRequestException,
      `${label} → BadRequestException`,
    );
  }
  assert(threw, `${label} → rejected`);
  ok(label);
}

async function main() {
  // 1. A valid question → a config that survives buildReportQuery, with a
  // date range and filter preserved. (Response wrapped in prose + fences.)
  const good = JSON.stringify({
    metric: 'avg_resolution_minutes',
    groupBy: 'month',
    filters: [{ field: 'priority', value: 'urgent' }],
    dateField: 'created_at',
    dateRange: { from: '2026-01-01', to: '2026-06-30' },
  });
  const svc = new ReportNlService(
    new FakeClient('Sure!\n```json\n' + good + '\n```'),
    NO_SETTINGS,
  );
  const cfg = await svc.buildConfig(
    TENANT,
    'average resolution time per month for urgent tickets this year',
  );
  assert.equal(cfg.metric, 'avg_resolution_minutes', 'metric mapped');
  assert.equal(cfg.groupBy, 'month', 'groupBy mapped');
  assert.equal(cfg.filters?.[0].field, 'priority', 'filter field kept');
  assert.equal(cfg.filters?.[0].value, 'urgent', 'filter value kept');
  assert.equal(cfg.dateRange?.from, '2026-01-01', 'date range kept');
  ok('valid question yields an allowlist-valid ReportConfig');

  // 2. ticket_count by status, no filters
  const simple = new ReportNlService(
    new FakeClient(
      JSON.stringify({ metric: 'ticket_count', groupBy: 'status' }),
    ),
    NO_SETTINGS,
  );
  const c2 = await simple.buildConfig(TENANT, 'how many tickets per status');
  assert.equal(c2.metric, 'ticket_count', 'count metric');
  assert.equal(c2.filters, undefined, 'no filters when none given');
  ok('minimal config (count by status) validates');

  // 3. Hallucinated metric is rejected by buildReportQuery — the real gate.
  await expectReject(
    () =>
      new ReportNlService(
        new FakeClient(
          JSON.stringify({ metric: 'revenue', groupBy: 'status' }),
        ),
        NO_SETTINGS,
      ).buildConfig(TENANT, 'show me revenue'),
    'off-allowlist metric rejected by buildReportQuery',
  );

  // 4. Hallucinated groupBy dimension rejected
  await expectReject(
    () =>
      new ReportNlService(
        new FakeClient(
          JSON.stringify({ metric: 'ticket_count', groupBy: 'customer_ssn' }),
        ),
        NO_SETTINGS,
      ).buildConfig(TENANT, 'group by ssn'),
    'off-allowlist groupBy rejected by buildReportQuery',
  );

  // 5. Off-allowlist filter field rejected
  await expectReject(
    () =>
      new ReportNlService(
        new FakeClient(
          JSON.stringify({
            metric: 'ticket_count',
            groupBy: 'status',
            filters: [{ field: 'secret_field', value: 'x' }],
          }),
        ),
        NO_SETTINGS,
      ).buildConfig(TENANT, 'filter by a made-up field'),
    'off-allowlist filter field rejected by buildReportQuery',
  );

  // 6. Non-JSON AI output rejected
  await expectReject(
    () =>
      new ReportNlService(
        new FakeClient('I could not understand that.'),
        NO_SETTINGS,
      ).buildConfig(TENANT, 'gibberish'),
    'non-JSON AI response rejected',
  );

  // 7. Empty question rejected before any AI call
  await expectReject(
    () =>
      new ReportNlService(new FakeClient('{}'), NO_SETTINGS).buildConfig(
        TENANT,
        '',
      ),
    'empty question rejected',
  );

  // 8. Disabled client → clear 400
  await expectReject(
    () =>
      new ReportNlService(new DisabledFake(), NO_SETTINGS).buildConfig(
        TENANT,
        'anything',
      ),
    'disabled client rejects with a clear 400',
  );

  console.log('\nAll report-nl checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
