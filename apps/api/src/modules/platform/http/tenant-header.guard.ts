import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { verifyJwt } from '../auth/jwt';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TenantScopedRequest extends Request {
  tenantId: string;
  userId?: string;
  userRole?: string;
}

/**
 * Resolves tenant (and, once logged in, user) from either a real bearer
 * token or the original X-Tenant-Id header, so the swap to real auth stays
 * confined to this guard the way the original stand-in comment intended.
 *
 * A valid `kind: 'agent'` JWT (from POST /auth/login) takes priority and
 * also populates userId/userRole. A *present but invalid* bearer token
 * (expired, malformed, or the wrong kind) falls back to the X-Tenant-Id
 * header rather than hard-rejecting -- otherwise a stale token sitting in
 * localStorage would 401 every request forever, even though the caller is
 * still sending a perfectly valid X-Tenant-Id and the whole point of the
 * additive rollout is that header-only auth keeps working. Falling back
 * doesn't grant anything a bare X-Tenant-Id request couldn't already do on
 * its own -- it just loses the userId/userRole identity that came with the
 * (now-rejected) token.
 */
@Injectable()
export class TenantHeaderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<TenantScopedRequest>();

    const authHeader = request.header('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const claims = verifyJwt(authHeader.slice('Bearer '.length));
      if (claims?.kind === 'agent') {
        request.tenantId = claims.tenantId;
        request.userId = claims.sub;
        request.userRole = claims.role;
        return true;
      }
      // Invalid/expired/wrong-kind token: fall through to X-Tenant-Id
      // instead of rejecting outright.
    }

    const tenantId = request.header('x-tenant-id');
    if (!tenantId || !UUID_RE.test(tenantId)) {
      throw new UnauthorizedException(
        authHeader?.startsWith('Bearer ')
          ? 'Invalid or expired token, and no valid X-Tenant-Id fallback was provided'
          : 'X-Tenant-Id header is required and must be a UUID',
      );
    }

    request.tenantId = tenantId;
    return true;
  }
}
