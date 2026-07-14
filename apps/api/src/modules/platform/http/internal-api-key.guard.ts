import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Stand-in for real service-to-service auth on internal, non-browser
 * endpoints (currently just POST /internal/tickets/from_alert, which Module 2
 * will call once it exists). There's no service mesh / mTLS / signed-request
 * scheme yet, so this checks a shared secret header instead -- replace with
 * whatever real inter-service auth the platform adopts later; every caller of
 * this guard is already isolated behind the "internal" route prefix.
 */
@Injectable()
export class InternalApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header('x-internal-api-key');
    const expected = this.config.get<string>(
      'INTERNAL_API_KEY',
      'dev-internal-api-key',
    );

    if (!provided || provided !== expected) {
      throw new UnauthorizedException(
        'X-Internal-Api-Key header is required and must match',
      );
    }
    return true;
  }
}
