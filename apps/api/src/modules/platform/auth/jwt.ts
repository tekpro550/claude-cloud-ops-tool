import * as jwt from 'jsonwebtoken';

/**
 * `kind` keeps agent-app tokens and customer-portal tokens from being
 * interchangeable -- a contact who logs into the portal must never be able
 * to present that token to an agent-only endpoint (or vice versa), even
 * though both are signed with the same secret and carry a tenantId.
 */
export interface AppJwtClaims {
  sub: string;
  tenantId: string;
  email: string;
  kind: 'agent' | 'contact';
  role?: string;
  /** Issued-at (seconds), set by jsonwebtoken on sign; used for session revocation. */
  iat?: number;
}

function secret(): string {
  return process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me';
}

export function signJwt(claims: AppJwtClaims): string {
  const expiresIn = process.env.JWT_EXPIRES_IN ?? '12h';
  return jwt.sign(claims, secret(), { expiresIn } as jwt.SignOptions);
}

export function verifyJwt(token: string): AppJwtClaims | null {
  try {
    return jwt.verify(token, secret()) as AppJwtClaims;
  } catch {
    return null;
  }
}

/**
 * A third `kind`, alongside agent/contact, for the Module 2 server agent
 * binary (Sprint 3) -- long-lived by design (a device installed once
 * shouldn't need re-auth on every heartbeat) and self-describing the same
 * way agent/contact tokens are, so AgentTokenGuard can resolve tenantId
 * without an RLS-gated DB lookup happening before the tenant is even known.
 */
export interface DeviceJwtClaims {
  sub: string;
  tenantId: string;
  resourceId: string;
  kind: 'device';
}

export function signDeviceJwt(claims: DeviceJwtClaims): string {
  const expiresIn = process.env.DEVICE_JWT_EXPIRES_IN ?? '3650d';
  return jwt.sign(claims, secret(), { expiresIn } as jwt.SignOptions);
}

export function verifyDeviceJwt(token: string): DeviceJwtClaims | null {
  try {
    const claims = jwt.verify(token, secret()) as DeviceJwtClaims;
    return claims.kind === 'device' ? claims : null;
  } catch {
    return null;
  }
}

/**
 * A fifth `kind`, for a log source's ingest credential (Module 2 log
 * management) -- self-describing exactly like DeviceJwtClaims, so
 * LogSourceTokenGuard can resolve tenantId from the token itself rather
 * than needing an RLS-gated cross-tenant lookup by a stored hash before the
 * tenant is even known.
 */
export interface LogSourceJwtClaims {
  sub: string;
  tenantId: string;
  kind: 'log_source';
}

export function signLogSourceJwt(claims: LogSourceJwtClaims): string {
  const expiresIn = process.env.DEVICE_JWT_EXPIRES_IN ?? '3650d';
  return jwt.sign(claims, secret(), { expiresIn } as jwt.SignOptions);
}

export function verifyLogSourceJwt(token: string): LogSourceJwtClaims | null {
  try {
    const claims = jwt.verify(token, secret()) as LogSourceJwtClaims;
    return claims.kind === 'log_source' ? claims : null;
  } catch {
    return null;
  }
}

/** A sixth `kind`, for an APM ingest key (Module 2 APM). Same self-describing shape as LogSourceJwtClaims. */
export interface ApmIngestJwtClaims {
  sub: string;
  tenantId: string;
  kind: 'apm_ingest';
}

export function signApmIngestJwt(claims: ApmIngestJwtClaims): string {
  const expiresIn = process.env.DEVICE_JWT_EXPIRES_IN ?? '3650d';
  return jwt.sign(claims, secret(), { expiresIn } as jwt.SignOptions);
}

export function verifyApmIngestJwt(token: string): ApmIngestJwtClaims | null {
  try {
    const claims = jwt.verify(token, secret()) as ApmIngestJwtClaims;
    return claims.kind === 'apm_ingest' ? claims : null;
  } catch {
    return null;
  }
}

/**
 * A seventh `kind`, for a RUM app key. Unlike the other machine-to-machine
 * kinds, this token is never sent as an Authorization header -- RUM beacons
 * are browser fetch()/sendBeacon() calls that can't reliably set custom
 * headers cross-origin, so the app key travels in the request body instead
 * (see rum-ingestion.controller.ts). It's still the same signed,
 * self-describing shape; only the transport differs.
 */
export interface RumAppJwtClaims {
  sub: string;
  tenantId: string;
  kind: 'rum_app';
}

export function signRumAppJwt(claims: RumAppJwtClaims): string {
  const expiresIn = process.env.DEVICE_JWT_EXPIRES_IN ?? '3650d';
  return jwt.sign(claims, secret(), { expiresIn } as jwt.SignOptions);
}

export function verifyRumAppJwt(token: string): RumAppJwtClaims | null {
  try {
    const claims = jwt.verify(token, secret()) as RumAppJwtClaims;
    return claims.kind === 'rum_app' ? claims : null;
  } catch {
    return null;
  }
}
