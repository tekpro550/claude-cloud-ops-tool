import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenantScopedRequest } from './tenant-header.guard';

export const CurrentUserId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined => {
    const request = context.switchToHttp().getRequest<TenantScopedRequest>();
    return request.userId;
  },
);
