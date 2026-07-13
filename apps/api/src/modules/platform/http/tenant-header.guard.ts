import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TenantScopedRequest extends Request {
  tenantId: string;
}

/**
 * Stand-in for the "bearer token resolved to a tenant + user by the [API]
 * gateway" described in section 4 of the architecture plan. There's no auth
 * service yet (Sprint 1 is ticket core, not auth), so this reads the tenant
 * straight off an X-Tenant-Id header. Replace with real bearer-token
 * resolution once auth exists — every RLS-protected query already goes
 * through withTenantContext keyed off request.tenantId, so that swap is
 * confined to this guard.
 */
@Injectable()
export class TenantHeaderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<TenantScopedRequest>();
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
