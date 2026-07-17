import Redis from 'ioredis';

/**
 * Redis-backed login rate-limiting and session revocation. Kept as plain
 * module functions with a lazily-created client (like jwt.ts reads the secret
 * from env) so the central TenantHeaderGuard can enforce revocation without
 * pulling REDIS_CLIENT through the DI graph of every feature module.
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

// --- Login rate-limiting ---

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 15 * 60;

export interface ThrottleResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Counts an attempt for `key` (tenant:email) in a rolling window. Every call
 * increments; a successful login clears the counter (clearLoginAttempts), so a
 * run of failures without a success trips the limit.
 */
export async function registerLoginAttempt(
  key: string,
): Promise<ThrottleResult> {
  const redisKey = `auth:throttle:${key}`;
  const count = await redis().incr(redisKey);
  if (count === 1) {
    await redis().expire(redisKey, LOGIN_WINDOW_SECONDS);
  }
  if (count > MAX_LOGIN_ATTEMPTS) {
    const ttl = await redis().ttl(redisKey);
    return {
      allowed: false,
      retryAfterSeconds: ttl > 0 ? ttl : LOGIN_WINDOW_SECONDS,
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function clearLoginAttempts(key: string): Promise<void> {
  await redis().del(`auth:throttle:${key}`);
}

// --- Session revocation ("log out everywhere") ---

// Comfortably longer than the JWT lifetime (default 12h) so a revoke marker
// outlives every token it needs to invalidate; once all such tokens expire the
// marker is harmless and can lapse.
const REVOKE_TTL_SECONDS = 60 * 60 * 24 * 2;

/** Invalidate every agent token issued for this user before now. */
export async function revokeUserSessions(userId: string): Promise<void> {
  await redis().set(
    `auth:revoke:${userId}`,
    Date.now().toString(),
    'EX',
    REVOKE_TTL_SECONDS,
  );
}

/** True when the token was issued before the user's most recent revoke-all. */
export async function isSessionRevoked(
  userId: string,
  tokenIatSeconds?: number,
): Promise<boolean> {
  if (!tokenIatSeconds) return false;
  const raw = await redis().get(`auth:revoke:${userId}`);
  if (!raw) return false;
  return tokenIatSeconds * 1000 < Number(raw);
}
