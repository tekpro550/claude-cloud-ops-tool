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
 * also populates userId/userRole. Falling back to the X-Tenant-Id header
 * when there's no bearer token keeps every pre-existing caller -- the 45
 * prior verify scripts, the live internal pilot -- working unmodified while
 * login rolls out gradually, per the additive rollout decision.
 */
@Injectable()
export class TenantHeaderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<TenantScopedRequest>();

    const authHeader = request.header('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const claims = verifyJwt(authHeader.slice('Bearer '.length));
      if (!claims || claims.kind !== 'agent') {
        throw new UnauthorizedException('Invalid or expired token');
      }
      request.tenantId = claims.tenantId;
      request.userId = claims.sub;
      request.userRole = claims.role;
      return true;
    }

    const tenantId = request.header('x-tenant-id');
    if (!tenantId || !UUID_RE.test(tenantId)) {
      throw new UnauthorizedException(
        'X-Tenant-Id header is required and must be a UUID',
      );
    }

    request.tenantId = tenantId;
    return true;
  }
}
