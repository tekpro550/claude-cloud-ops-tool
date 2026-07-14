import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { verifyJwt } from '../../platform/auth/jwt';

export interface ContactScopedRequest extends Request {
  tenantId: string;
  contactId: string;
}

/**
 * Guards every portal endpoint that requires a logged-in contact (ticket
 * list/detail). Unlike TenantHeaderGuard, there is no X-Tenant-Id fallback
 * here on purpose -- a guest with no account must not be able to list or
 * read another contact's tickets just by supplying a tenant id, which is
 * exactly the "never accessible to a guest who only submitted without
 * registering" requirement from the Module 1 doc. Guest-accessible portal
 * routes (submit ticket, browse solutions) use TenantHeaderGuard instead,
 * same as the rest of the app, since there's no per-contact data to protect
 * there.
 */
@Injectable()
export class PortalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<ContactScopedRequest>();
    const authHeader = request.header('authorization');

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('A Bearer token is required');
    }
    const claims = verifyJwt(authHeader.slice('Bearer '.length));
    if (!claims || claims.kind !== 'contact') {
      throw new UnauthorizedException('Invalid or expired token');
    }

    request.tenantId = claims.tenantId;
    request.contactId = claims.sub;
    return true;
  }
}
