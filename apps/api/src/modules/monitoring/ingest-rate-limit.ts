import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Redis-backed fixed-window rate limiter for the token-authed ingestion
 * endpoints (APM traces, RUM beacons, log entries). Same lazily-created
 * client + INCR/EXPIRE pattern as auth-security.ts's login throttle, kept as
 * a plain module function so each ingestion path can enforce it without
 * pulling a Redis provider through its DI graph.
 *
 * Deliberately **fails open**: if Redis is unreachable the limiter allows the
 * request rather than blocking all ingestion on a cache blip (availability
 * over strictness, the usual choice for a rate limiter that isn't the sole
 * security control -- tenant scoping still comes from the signed key).
 */
let client: Redis | null = null;
function redis(): Redis {
  if (!client) {
    client = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      maxRetriesPerRequest: 2,
    });
  }
  return client;
}

const logger = new Logger('IngestRateLimit');

function maxPerWindow(): number {
  return Number(process.env.INGEST_MAX_REQUESTS_PER_WINDOW ?? 300);
}
function windowSeconds(): number {
  return Number(process.env.INGEST_RATE_WINDOW_SECONDS ?? 60);
}

/**
 * Counts one request for `key` (e.g. `apm:<keyId>`) in the current fixed
 * window. Throws 429 once the per-window cap is exceeded; the response
 * carries a Retry-After hint via the exception body.
 */
export async function enforceIngestRate(key: string): Promise<void> {
  const redisKey = `ingest:rate:${key}`;
  const limit = maxPerWindow();
  const window = windowSeconds();

  let count: number;
  try {
    count = await redis().incr(redisKey);
    if (count === 1) {
      await redis().expire(redisKey, window);
    }
  } catch (err) {
    // Fail open -- a Redis outage must not take ingestion down with it.
    logger.warn(
      `rate-limit check skipped (redis error): ${(err as Error).message}`,
    );
    return;
  }

  if (count > limit) {
    let ttl = window;
    try {
      const t = await redis().ttl(redisKey);
      if (t > 0) ttl = t;
    } catch {
      // keep the default window as the retry hint
    }
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: 'Ingestion rate limit exceeded',
        retryAfterSeconds: ttl,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
