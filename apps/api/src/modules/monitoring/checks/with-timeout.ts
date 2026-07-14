/**
 * Races `promise` against a timer, since a couple of the Node APIs the
 * checkers use (dns.promises.resolve in particular) don't expose their own
 * timeout option. Does not cancel the underlying operation -- it just stops
 * waiting on it -- so callers should treat a timeout rejection as "no answer
 * in time", not "the operation was aborted".
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
