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
