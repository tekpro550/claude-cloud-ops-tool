import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { CurrentTenantId } from '../http/current-tenant.decorator';
import { Roles } from '../http/roles.decorator';
import { RolesGuard } from '../http/roles.guard';
import { TenantHeaderGuard } from '../http/tenant-header.guard';
import { SsoCallbackDto, UpsertSsoConfigDto } from './sso.dto';
import { SsoService } from './sso.service';

/** Admin-only: register/inspect the tenant's OIDC identity provider. */
@UseGuards(TenantHeaderGuard, RolesGuard)
@Controller('auth/sso/config')
export class SsoConfigController {
  constructor(private readonly sso: SsoService) {}

  @Get()
  @Roles('admin')
  get(@CurrentTenantId() tenantId: string) {
    return this.sso.getConfig(tenantId);
  }

  @Put()
  @Roles('admin')
  upsert(@CurrentTenantId() tenantId: string, @Body() dto: UpsertSsoConfigDto) {
    return this.sso.upsertConfig(tenantId, dto);
  }
}

/**
 * The public OIDC round-trip. Unauthenticated by design: `begin` takes the
 * tenant in the path (the login page knows it), and `callback` trusts the
 * signed state, not a header — the browser arriving from the IdP carries
 * neither a Bearer token nor X-Tenant-Id.
 */
@Controller('auth/sso')
export class SsoPublicController {
  constructor(
    private readonly sso: SsoService,
    private readonly config: ConfigService,
  ) {}

  @Get(':tenantId/begin')
  begin(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.sso.beginLogin(tenantId);
  }

  // The IdP redirects the browser here; on success we bounce to the web app
  // with the freshly minted token so the SPA can store it and continue.
  @Get('callback')
  async callback(
    @Query() query: SsoCallbackDto,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.sso.completeLogin(query.code, query.state);
    const webUrl = this.config.get<string>(
      'WEB_APP_URL',
      'http://localhost:5173',
    );
    res.redirect(`${webUrl}/sso-callback#token=${result.token}`);
  }
}
