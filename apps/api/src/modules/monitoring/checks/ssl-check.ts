import { connect } from 'tls';
import { CheckResult, SslCheckConfig } from './types';

const DAY_MS = 86_400_000;

export function sslCheck(config: SslCheckConfig): Promise<CheckResult> {
  const port = config.port ?? 443;
  const timeoutMs = config.timeoutMs ?? 10_000;
  const warnDaysBeforeExpiry = config.warnDaysBeforeExpiry ?? 14;
  const start = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: CheckResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const socket = connect(
      { host: config.host, port, servername: config.host, timeout: timeoutMs },
      () => {
        const responseTimeMs = Date.now() - start;
        const cert = socket.getPeerCertificate();
        socket.end();

        if (!cert || !cert.valid_to) {
          finish({
            status: 'down',
            responseTimeMs,
            rawOutput: { error: 'no certificate presented' },
          });
          return;
        }

        const expiresAt = new Date(cert.valid_to);
        const daysRemaining = (expiresAt.getTime() - Date.now()) / DAY_MS;

        if (daysRemaining < 0) {
          finish({
            status: 'critical',
            responseTimeMs,
            rawOutput: {
              expiresAt: cert.valid_to,
              daysRemaining,
              reason: 'expired',
            },
          });
        } else if (daysRemaining < warnDaysBeforeExpiry) {
          finish({
            status: 'trouble',
            responseTimeMs,
            rawOutput: {
              expiresAt: cert.valid_to,
              daysRemaining,
              reason: 'expiring_soon',
            },
          });
        } else {
          finish({
            status: 'up',
            responseTimeMs,
            rawOutput: { expiresAt: cert.valid_to, daysRemaining },
          });
        }
      },
    );

    socket.once('timeout', () => {
      socket.destroy();
      finish({
        status: 'down',
        responseTimeMs: Date.now() - start,
        rawOutput: { error: 'timeout' },
      });
    });
    socket.once('error', (err) => {
      finish({
        status: 'down',
        responseTimeMs: Date.now() - start,
        rawOutput: { error: err.message },
      });
    });
  });
}
