/**
 * Verify script for the NL automation-rule builder (AI value-add).
 * Uses a fake AI client — no real AI API and no database needed (the
 * generator is a pure allowlist validator, same contract as synthetic-gen).
 */
import 'reflect-metadata';
import * as assert from 'assert';
import { BadRequestException } from '@nestjs/common';
import { AiCompletionClient } from '../../../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../../../ai/tenant-ai-settings.service';
import { AutomationRuleGenService } from '../automation-rule-gen.service';

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
const TENANT = '00000000-0000-0000-0000-0000000000aa';

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
  // 1. A valid NL description → a validated draft, wrapped in prose/fences
  const valid = JSON.stringify({
    name: 'Escalate urgent outages',
    trigger: 'ticket_created',
    conditions: [{ field: 'priority', operator: 'equals', value: 'urgent' }],
    actions: [{ type: 'set_group', value: 'On-call' }],
  });
  const svc = new AutomationRuleGenService(
    new FakeClient('Here is your rule:\n```json\n' + valid + '\n```'),
    NO_SETTINGS,
  );
  const draft = await svc.generateRule(TENANT, 'urgent tickets go to on-call');
  assert.equal(draft.name, 'Escalate urgent outages', 'name preserved');
  assert.equal(draft.trigger, 'ticket_created', 'trigger preserved');
  assert.equal(draft.conditions[0].field, 'priority', 'condition field kept');
  assert.equal(draft.actions[0].type, 'set_group', 'action type kept');
  assert.equal(draft.timeTriggerMinutes, undefined, 'no time trigger');
  ok('valid description yields a validated draft (JSON extracted from prose)');

  // 2. time_based trigger requires timeTriggerMinutes
  const timed = new AutomationRuleGenService(
    new FakeClient(
      JSON.stringify({
        name: 'Auto-close stale',
        trigger: 'time_based',
        timeTriggerMinutes: 1440,
        conditions: [{ field: 'status', operator: 'equals', value: 'pending' }],
        actions: [{ type: 'set_status', value: 'closed' }],
      }),
    ),
    NO_SETTINGS,
  );
  const timedDraft = await timed.generateRule(TENANT, 'close after a day');
  assert.equal(timedDraft.timeTriggerMinutes, 1440, 'time trigger captured');
  ok('time_based rule keeps timeTriggerMinutes');

  // 3. Allowlist gating — an out-of-allowlist action type is rejected, so a
  // hallucinated "delete_ticket" can never reach the database.
  await expectReject(
    () =>
      new AutomationRuleGenService(
        new FakeClient(
          JSON.stringify({
            name: 'Danger',
            trigger: 'ticket_created',
            conditions: [],
            actions: [{ type: 'delete_ticket', value: 'x' }],
          }),
        ),
        NO_SETTINGS,
      ).generateRule(TENANT, 'delete everything'),
    'off-allowlist action type rejected',
  );

  // 4. Out-of-allowlist condition field rejected
  await expectReject(
    () =>
      new AutomationRuleGenService(
        new FakeClient(
          JSON.stringify({
            name: 'Bad field',
            trigger: 'ticket_updated',
            conditions: [{ field: 'ssn', operator: 'equals', value: 'x' }],
            actions: [{ type: 'add_tag', value: 'x' }],
          }),
        ),
        NO_SETTINGS,
      ).generateRule(TENANT, 'match on ssn'),
    'off-allowlist condition field rejected',
  );

  // 5. A rule with no actions is rejected
  await expectReject(
    () =>
      new AutomationRuleGenService(
        new FakeClient(
          JSON.stringify({
            name: 'No actions',
            trigger: 'ticket_created',
            conditions: [],
            actions: [],
          }),
        ),
        NO_SETTINGS,
      ).generateRule(TENANT, 'do nothing'),
    'rule with zero actions rejected',
  );

  // 6. Non-JSON AI output rejected
  await expectReject(
    () =>
      new AutomationRuleGenService(
        new FakeClient('I cannot help with that.'),
        NO_SETTINGS,
      ).generateRule(TENANT, 'nonsense'),
    'non-JSON AI response rejected',
  );

  // 7. Empty description rejected before any AI call
  await expectReject(
    () =>
      new AutomationRuleGenService(
        new FakeClient('{}'),
        NO_SETTINGS,
      ).generateRule(TENANT, '   '),
    'empty description rejected',
  );

  // 8. Disabled client → BadRequest (AI not configured)
  await expectReject(
    () =>
      new AutomationRuleGenService(
        new DisabledFake(),
        NO_SETTINGS,
      ).generateRule(TENANT, 'anything'),
    'disabled client rejects with a clear 400',
  );

  console.log('\nAll automation-rule-gen checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
