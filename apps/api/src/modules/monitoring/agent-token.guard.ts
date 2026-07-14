import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Request } from 'express';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../database/context/tenant-context';
import { verifyDeviceJwt } from '../platform/auth/jwt';

export interface AgentScopedRequest extends Request {
  tenantId: string;
  resourceId: string;
  agentTokenId: string;
}

/**
 * Machine-to-machine auth for the server agent binary's ingestion endpoints
 * (/agent/heartbeat, /agent/report) -- always a Bearer device JWT, no
 * X-Tenant-Id fallback the way TenantHeaderGuard has, since there's no
 * browser session behind this to fall back to. The JWT is self-describing
 * (see jwt.ts), so tenantId is known before the revocation check below ever
 * touches the RLS-protected agent_tokens table.
 */
@Injectable()
export class AgentTokenGuard implements CanActivate {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AgentScopedRequest>();

    const authHeader = request.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Authorization: Bearer <device token> is required',
      );
    }

    const claims = verifyDeviceJwt(authHeader.slice('Bearer '.length));
    if (!claims) {
      throw new UnauthorizedException('Invalid or expired device token');
    }

    const isEnabled = await withTenantContext(
      this.dataSource,
      claims.tenantId,
      async (queryRunner) => {
        const [row] = await queryRunner.query(
          `SELECT is_enabled FROM agent_tokens WHERE id = $1 AND resource_id = $2`,
          [claims.sub, claims.resourceId],
        );
        return row?.is_enabled === true;
      },
    );
    if (!isEnabled) {
      throw new UnauthorizedException(
        'Device token has been revoked or no longer exists',
      );
    }

    request.tenantId = claims.tenantId;
    request.resourceId = claims.resourceId;
    request.agentTokenId = claims.sub;
    return true;
  }
}
