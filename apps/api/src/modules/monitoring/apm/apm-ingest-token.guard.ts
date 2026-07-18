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
import { verifyApmIngestJwt } from '../../platform/auth/jwt';

export interface ApmScopedRequest extends Request {
  tenantId: string;
  apmIngestKeyId: string;
  service: string;
}

/** Machine-to-machine auth for POST /apm/traces -- same shape as LogSourceTokenGuard. */
@Injectable()
export class ApmIngestTokenGuard implements CanActivate {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApmScopedRequest>();

    const authHeader = request.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Authorization: Bearer <APM ingest key> is required',
      );
    }

    const claims = verifyApmIngestJwt(authHeader.slice('Bearer '.length));
    if (!claims) {
      throw new UnauthorizedException('Invalid or expired APM ingest key');
    }

    const key = await withTenantContext(
      this.dataSource,
      claims.tenantId,
      async (queryRunner) => {
        const [row] = await queryRunner.query(
          `SELECT is_active, service FROM apm_ingest_keys WHERE id = $1`,
          [claims.sub],
        );
        return row?.is_active === true ? row : null;
      },
    );
    if (!key) {
      throw new UnauthorizedException(
        'APM ingest key has been revoked or no longer exists',
      );
    }

    request.tenantId = claims.tenantId;
    request.apmIngestKeyId = claims.sub;
    request.service = key.service;
    return true;
  }
}
