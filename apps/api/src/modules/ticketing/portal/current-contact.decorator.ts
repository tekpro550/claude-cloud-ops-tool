import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ContactScopedRequest } from './portal-auth.guard';

export const CurrentContactId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<ContactScopedRequest>();
    return request.contactId;
  },
);
