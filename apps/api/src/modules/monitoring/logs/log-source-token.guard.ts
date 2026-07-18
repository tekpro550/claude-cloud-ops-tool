import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Request } from 'express';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { verifyLogSourceJwt } from '../../platform/auth/jwt';

export interface LogSourceScopedRequest extends Request {
  tenantId: string;
  logSourceId: string;
}

/**
 * Machine-to-machine auth for /logs/ingest -- a Bearer JWT scoped to one log
 * source, the same shape as AgentTokenGuard's device tokens. The JWT is
 * self-describing (tenantId + sub=sourceId), so tenantId is known before
 * the RLS-protected log_sources table is ever touched.
 */
@Injectable()
export class LogSourceTokenGuard implements CanActivate {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<LogSourceScopedRequest>();

    const authHeader = request.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Authorization: Bearer <log source token> is required',
      );
    }

    const claims = verifyLogSourceJwt(authHeader.slice('Bearer '.length));
    if (!claims) {
      throw new UnauthorizedException('Invalid or expired log source token');
    }

    const isActive = await withTenantContext(
      this.dataSource,
      claims.tenantId,
      async (queryRunner) => {
        const [row] = await queryRunner.query(
          `SELECT is_active FROM log_sources WHERE id = $1`,
          [claims.sub],
        );
        return row?.is_active === true;
      },
    );
    if (!isActive) {
      throw new UnauthorizedException(
        'Log source token has been revoked or no longer exists',
      );
    }

    request.tenantId = claims.tenantId;
    request.logSourceId = claims.sub;
    return true;
  }
}
