import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenantScopedRequest } from './tenant-header.guard';

export const CurrentTenantId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<TenantScopedRequest>();
    return request.tenantId;
  },
);
