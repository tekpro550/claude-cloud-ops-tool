import { Socket } from 'net';
import { CheckResult, PortCheckConfig } from './types';

export function portCheck(config: PortCheckConfig): Promise<CheckResult> {
  const timeoutMs = config.timeoutMs ?? 5_000;
  const start = Date.now();

  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (result: CheckResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      finish({
        status: 'up',
        responseTimeMs: Date.now() - start,
        rawOutput: {},
      });
    });
    socket.once('timeout', () => {
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
    socket.connect(config.port, config.host);
  });
}
