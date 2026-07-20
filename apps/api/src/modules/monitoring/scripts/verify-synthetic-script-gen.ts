/**
 * Verify script for Task 8: AI-powered synthetic script generation (M2).
 * Uses a fake AI client — no Playwright or real AI API needed.
 */
import 'reflect-metadata';
import assert from 'assert';
import { BadRequestException } from '@nestjs/common';
import { AiCompletionClient } from '../../../ai/ai-completion.client';
import { TenantAiSettingsService } from '../../../ai/tenant-ai-settings.service';
import { SyntheticScriptGenService } from '../synthetic/synthetic-script-gen.service';

const NO_SETTINGS = {
  resolveClient: async () => null,
} as unknown as TenantAiSettingsService;

class FakeScriptClient implements AiCompletionClient {
  readonly enabled = true;
  returnValue: string;
  constructor(returnValue: string) { this.returnValue = returnValue; }
  async complete(_s: string, _u: string): Promise<string> { return this.returnValue; }
}

class DisabledFake implements AiCompletionClient {
  readonly enabled = false;
  async complete(): Promise<string> { throw new Error('should not be called'); }
}

const VALID_SCRIPT = JSON.stringify({
  steps: [
    { action: 'goto', url: 'https://example.com' },
    { action: 'click', selector: '#login' },
    { action: 'fill', selector: '#email', value: 'user@test.com' },
    { action: 'expectText', selector: '.welcome', value: 'Welcome' },
  ],
  maxStepMs: 10000,
});

function ok(message: string) {
  console.log(`  OK  ${message}`);
}

async function main() {
  // --- 1. Valid AI output → valid SyntheticScript returned ---
  const valid = new SyntheticScriptGenService(new FakeScriptClient(VALID_SCRIPT), NO_SETTINGS);
  const script = await valid.generateScript('t1', 'Login to example.com and check welcome');
  assert.deepEqual(script.steps.length, 4, 'all 4 steps are present');
  assert.equal(script.steps[0].action, 'goto', 'first step is goto');
  assert.equal(script.maxStepMs, 10000, 'maxStepMs preserved');
  ok('valid AI script is parsed and validated');

  // --- 2. AI returns JSON wrapped in prose/fences — JSON is extracted ---
  const fenced = new SyntheticScriptGenService(
    new FakeScriptClient(`Here's the script:\n\`\`\`json\n${VALID_SCRIPT}\n\`\`\``),
    NO_SETTINGS,
  );
  const fencedScript = await fenced.generateScript('t1', 'Login flow');
  assert.equal(fencedScript.steps.length, 4, 'JSON extracted from fenced prose');
  ok('JSON is extracted even when wrapped in markdown fences');

  // --- 3. Disallowed action → BadRequestException ---
  const badAction = JSON.stringify({
    steps: [{ action: 'eval', code: 'alert(1)' }],
    maxStepMs: 5000,
  });
  let badActionThrew = false;
  try {
    await new SyntheticScriptGenService(new FakeScriptClient(badAction), NO_SETTINGS)
      .generateScript('t1', 'description');
  } catch (e) {
    badActionThrew = e instanceof BadRequestException;
  }
  assert.ok(badActionThrew, 'disallowed action throws BadRequestException');
  ok('disallowed action is rejected by allowlist');

  // --- 4. Invalid JSON → BadRequestException ---
  let invalidJsonThrew = false;
  try {
    await new SyntheticScriptGenService(new FakeScriptClient('not json at all'), NO_SETTINGS)
      .generateScript('t1', 'description');
  } catch (e) {
    invalidJsonThrew = e instanceof BadRequestException;
  }
  assert.ok(invalidJsonThrew, 'non-JSON AI response throws BadRequestException');
  ok('non-JSON AI response is rejected');

  // --- 5. Empty description → BadRequestException ---
  let emptyThrew = false;
  try {
    await new SyntheticScriptGenService(new FakeScriptClient(VALID_SCRIPT), NO_SETTINGS)
      .generateScript('t1', '');
  } catch (e) {
    emptyThrew = e instanceof BadRequestException;
  }
  assert.ok(emptyThrew, 'empty description throws');
  ok('empty description throws BadRequestException');

  // --- 6. Disabled client → BadRequestException ---
  let disabledThrew = false;
  try {
    await new SyntheticScriptGenService(new DisabledFake(), NO_SETTINGS)
      .generateScript('t1', 'something');
  } catch (e) {
    disabledThrew = e instanceof BadRequestException;
  }
  assert.ok(disabledThrew, 'disabled client throws BadRequestException');
  ok('disabled client throws BadRequestException');

  // --- 7. Description > 2000 chars → BadRequestException ---
  let longThrew = false;
  try {
    await new SyntheticScriptGenService(new FakeScriptClient(VALID_SCRIPT), NO_SETTINGS)
      .generateScript('t1', 'x'.repeat(2001));
  } catch (e) {
    longThrew = e instanceof BadRequestException;
  }
  assert.ok(longThrew, 'description > 2000 chars throws BadRequestException');
  ok('over-length description throws BadRequestException');

  console.log('\nAll synthetic script gen checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
