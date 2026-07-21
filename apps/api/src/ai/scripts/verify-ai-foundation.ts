import 'reflect-metadata';
import * as assert from 'assert';
import {
  DisabledCompletionClient,
  buildCompletionClient,
  AiCompletionClient,
} from '../ai-completion.client';
import { runAssist } from '../ai-assist';

async function main() {
  // 1. DisabledCompletionClient.enabled is false
  const disabled = new DisabledCompletionClient();
  assert.equal(disabled.enabled, false, 'disabled client enabled=false');
  console.log('OK disabled client');

  // 2. runAssist with disabled client returns {enabled:false}
  const res = await runAssist(disabled, 'system', 'user');
  assert.equal(res.enabled, false, 'runAssist disabled returns enabled:false');
  assert.equal(res.result, undefined, 'runAssist disabled returns no result');
  console.log('OK runAssist disabled short-circuits');

  // 3. buildCompletionClient with no key returns disabled
  const noKey = buildCompletionClient({
    provider: 'anthropic',
    model: 'x',
    apiKey: null,
    baseUrl: null,
  });
  assert.equal(
    noKey.enabled,
    false,
    'buildCompletionClient no key returns disabled',
  );
  console.log('OK buildCompletionClient no key');

  // 4. buildCompletionClient openai_compatible with no baseUrl returns disabled
  const noUrl = buildCompletionClient({
    provider: 'openai_compatible',
    model: 'x',
    apiKey: 'k',
    baseUrl: null,
  });
  assert.equal(
    noUrl.enabled,
    false,
    'openai_compatible no baseUrl returns disabled',
  );
  console.log('OK buildCompletionClient openai_compatible no baseUrl');

  // 5. Fake client works with runAssist
  const fake: AiCompletionClient = {
    enabled: true,
    async complete(_s, user) {
      return `echo:${user}`;
    },
  };
  const fakeRes = await runAssist(fake, 'sys', 'hello');
  assert.equal(fakeRes.enabled, true);
  assert.equal(fakeRes.result, 'echo:hello');
  console.log('OK runAssist with real client');

  console.log('\nAll verify-ai-foundation checks passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
