import { execFile } from 'child_process';
import { promisify } from 'util';
import { CheckResult, PingCheckConfig } from './types';

const execFileAsync = promisify(execFile);

/**
 * Shells out to the system `ping` binary rather than sending raw ICMP
 * directly, since that needs a privileged socket Node doesn't get by
 * default. `-c 1 -W <seconds>` is understood by both iputils-ping (Debian
 * build images) and busybox ping (the alpine runtime image this ships in) --
 * the two ping implementations this monitor will actually run under.
 */
export async function pingCheck(config: PingCheckConfig): Promise<CheckResult> {
  const timeoutMs = config.timeoutMs ?? 5_000;
  const timeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const start = Date.now();

  try {
    const { stdout } = await execFileAsync(
      'ping',
      ['-c', '1', '-W', String(timeoutSeconds), config.host],
      { timeout: timeoutMs + 1_000 },
    );
    const responseTimeMs = Date.now() - start;
    const match = stdout.match(/time[=<]([\d.]+)\s*ms/);
    const rttMs = match ? parseFloat(match[1]) : responseTimeMs;
    return {
      status: 'up',
      responseTimeMs: rttMs,
      rawOutput: { stdout: stdout.trim() },
    };
  } catch (err) {
    return {
      status: 'down',
      responseTimeMs: Date.now() - start,
      rawOutput: { error: (err as Error).message },
    };
  }
}
