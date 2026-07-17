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
