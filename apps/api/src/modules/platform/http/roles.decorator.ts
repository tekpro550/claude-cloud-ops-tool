import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'requiredRoles';

/**
 * Restricts a controller or route to the given user roles (from the
 * users.role enum: 'admin' | 'agent' | 'viewer'). Enforced by RolesGuard,
 * which reads request.userRole populated by TenantHeaderGuard from a
 * verified agent JWT. Routes with no @Roles are unrestricted.
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
