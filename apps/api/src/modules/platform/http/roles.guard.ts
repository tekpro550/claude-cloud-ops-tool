import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';
import { TenantScopedRequest } from './tenant-header.guard';

/**
 * Enforces @Roles(...) on top of TenantHeaderGuard. Until this guard, the
 * users.role column was written, signed into the JWT, and attached to the
 * request -- but read by nothing, so every authenticated agent was an
 * effective super-admin. This closes that gap.
 *
 * Policy:
 *  - A route with no @Roles is unrestricted (this guard is a no-op).
 *  - A request carrying a verified agent JWT (request.userRole present) must
 *    have a role in the allowed set, else 403.
 *  - A header-only request (no verified identity, so no role) is governed by
 *    RBAC_REQUIRE_AUTH: when 'false' (the default, preserving the existing
 *    X-Tenant-Id pilot flow) it passes through; when 'true' it is rejected
 *    with 401 so production can require a real login on role-gated routes.
 *
 * The guard must run after TenantHeaderGuard (which populates userRole);
 * controllers list them in that order in @UseGuards.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<TenantScopedRequest>();
    const role = request.userRole;

    if (!role) {
      // No verified identity -- header-only request.
      const requireAuth =
        this.config.get<string>('RBAC_REQUIRE_AUTH', 'false') === 'true';
      if (requireAuth) {
        throw new UnauthorizedException(
          'This action requires a signed-in agent (RBAC_REQUIRE_AUTH is enabled)',
        );
      }
      return true;
    }

    if (!requiredRoles.includes(role)) {
      throw new ForbiddenException(
        `This action requires one of: ${requiredRoles.join(', ')} (your role: ${role})`,
      );
    }
    return true;
  }
}
