import { Logger } from '@nestjs/common';
import { withTimeout } from '../checks/with-timeout';
import { SyntheticStep } from './synthetic-script';
import {
  SyntheticRunner,
  SyntheticRunOptions,
  SyntheticRunResult,
  SyntheticStepResult,
} from './synthetic-runner';

// Typed loosely: playwright is a real dependency here (unlike the AI SDK),
// but its Page type isn't worth importing into this small a surface.
interface SyntheticPage {
  goto(url: string): Promise<unknown>;
  click(selector: string): Promise<unknown>;
  fill(selector: string, value: string): Promise<unknown>;
  locator(selector: string): { innerText(): Promise<string> };
}

/**
 * Real backend: runs each step against a headless Chromium page. Chromium
 * is pre-installed in this environment at PLAYWRIGHT_BROWSERS_PATH; the
 * `playwright` package is loaded lazily (require in run()) so the app still
 * boots if it's ever missing -- in that case run() rejects and the
 * scheduler logs and skips that tick's monitor rather than crashing.
 */
export class PlaywrightSyntheticRunner implements SyntheticRunner {
  private readonly logger = new Logger(PlaywrightSyntheticRunner.name);

  async run(
    steps: SyntheticStep[],
    opts: SyntheticRunOptions,
  ): Promise<SyntheticRunResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { chromium } = require('playwright');
    const start = Date.now();
    const browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
    });
    const results: SyntheticStepResult[] = [];
    let failingStepIndex: number | null = null;
    try {
      const page = (await browser.newPage()) as SyntheticPage;
      for (let index = 0; index < steps.length; index++) {
        const step = steps[index];
        const stepStart = Date.now();
        try {
          await withTimeout(this.runStep(page, step), opts.maxStepMs);
          results.push({
            index,
            action: step.action,
            status: 'ok',
            durationMs: Date.now() - stepStart,
          });
        } catch (err) {
          results.push({
            index,
            action: step.action,
            status: 'failed',
            durationMs: Date.now() - stepStart,
            error: (err as Error).message,
          });
          failingStepIndex = index;
          break;
        }
      }
    } finally {
      await browser.close().catch((err: Error) => {
        this.logger.warn(`failed to close browser: ${err.message}`);
      });
    }
    return {
      ok: failingStepIndex === null,
      totalMs: Date.now() - start,
      steps: results,
      failingStepIndex,
    };
  }

  private async runStep(
    page: SyntheticPage,
    step: SyntheticStep,
  ): Promise<void> {
    switch (step.action) {
      case 'goto':
        await page.goto(step.url as string);
        return;
      case 'click':
        await page.click(step.selector as string);
        return;
      case 'fill':
        await page.fill(step.selector as string, step.value as string);
        return;
      case 'expectText': {
        const text = await page.locator(step.selector as string).innerText();
        if (!text.includes(step.value as string)) {
          throw new Error(
            `expected text "${step.value}" in "${step.selector}", got "${text}"`,
          );
        }
        return;
      }
    }
  }
}
