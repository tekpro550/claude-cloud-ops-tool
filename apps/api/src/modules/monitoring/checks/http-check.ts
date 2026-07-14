import { CheckResult, HttpCheckConfig } from './types';

export async function httpCheck(config: HttpCheckConfig): Promise<CheckResult> {
  const timeoutMs = config.timeoutMs ?? 10_000;
  const expectedStatus = config.expectedStatus ?? 200;
  const degradedThresholdMs = config.degradedThresholdMs ?? timeoutMs * 0.8;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const response = await fetch(config.url, {
      method: config.method ?? 'GET',
      signal: controller.signal,
    });
    const responseTimeMs = Date.now() - start;

    if (response.status !== expectedStatus) {
      return {
        status: 'critical',
        responseTimeMs,
        rawOutput: { httpStatus: response.status, expectedStatus },
      };
    }

    if (config.bodyContains) {
      const body = await response.text();
      if (!body.includes(config.bodyContains)) {
        return {
          status: 'critical',
          responseTimeMs,
          rawOutput: { httpStatus: response.status, reason: 'body_mismatch' },
        };
      }
    }

    if (responseTimeMs > degradedThresholdMs) {
      return {
        status: 'trouble',
        responseTimeMs,
        rawOutput: { httpStatus: response.status, reason: 'slow_response' },
      };
    }

    return {
      status: 'up',
      responseTimeMs,
      rawOutput: { httpStatus: response.status },
    };
  } catch (err) {
    return {
      status: 'down',
      responseTimeMs: Date.now() - start,
      rawOutput: { error: (err as Error).message },
    };
  } finally {
    clearTimeout(timer);
  }
}
