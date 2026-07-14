import { promises as dns } from 'dns';
import { CheckResult, DnsCheckConfig } from './types';
import { withTimeout } from './with-timeout';

export async function dnsCheck(config: DnsCheckConfig): Promise<CheckResult> {
  const recordType = config.recordType ?? 'A';
  const timeoutMs = config.timeoutMs ?? 5_000;
  const start = Date.now();

  try {
    // dns.resolve()'s return type is a union keyed off rrtype (A/AAAA/CNAME/TXT
    // give arrays, MX/SOA/SRV give richer per-record objects); our supported
    // recordType set only exercises the array shapes, so this cast just
    // avoids threading dns.resolve's full overload union through here.
    const records = (await withTimeout(
      dns.resolve(config.hostname, recordType),
      timeoutMs,
    )) as unknown as unknown[];
    const responseTimeMs = Date.now() - start;

    if (
      config.expectedValue &&
      !records.some((record) =>
        String(record).includes(config.expectedValue as string),
      )
    ) {
      return {
        status: 'critical',
        responseTimeMs,
        rawOutput: {
          records,
          reason: 'value_mismatch',
          expectedValue: config.expectedValue,
        },
      };
    }

    return { status: 'up', responseTimeMs, rawOutput: { records } };
  } catch (err) {
    return {
      status: 'down',
      responseTimeMs: Date.now() - start,
      rawOutput: { error: (err as Error).message },
    };
  }
}
