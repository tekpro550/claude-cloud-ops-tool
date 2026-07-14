import {
  Body,
  Controller,
  Get,
  NotImplementedException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../../platform/http/current-tenant.decorator';
import { TenantHeaderGuard } from '../../platform/http/tenant-header.guard';
import { CurrentContactId } from './current-contact.decorator';
import { PortalAuthGuard } from './portal-auth.guard';
import { PortalLoginDto, PortalRegisterDto } from './portal-auth.dto';
import { PortalAuthService } from './portal-auth.service';

const OAUTH_PROVIDERS: Record<string, string> = {
  google: 'GOOGLE_OAUTH_CLIENT_ID',
  facebook: 'FACEBOOK_OAUTH_CLIENT_ID',
};

@Controller('portal/auth')
export class PortalAuthController {
  constructor(private readonly portalAuth: PortalAuthService) {}

  @UseGuards(TenantHeaderGuard)
  @Post('register')
  register(
    @CurrentTenantId() tenantId: string,
    @Body() dto: PortalRegisterDto,
  ) {
    return this.portalAuth.register(tenantId, dto);
  }

  @UseGuards(TenantHeaderGuard)
  @Post('login')
  login(@CurrentTenantId() tenantId: string, @Body() dto: PortalLoginDto) {
    return this.portalAuth.login(tenantId, dto);
  }

  @UseGuards(PortalAuthGuard)
  @Get('me')
  me(
    @CurrentTenantId() tenantId: string,
    @CurrentContactId() contactId: string,
  ) {
    return this.portalAuth.me(tenantId, contactId);
  }

  /**
   * Scaffold only -- Google/Facebook OAuth needs a real client id/secret
   * from each provider, which this deployment doesn't have. The button UI
   * exists in the portal frontend and points here; this returns a clear
   * 501 rather than a broken redirect until real credentials are set.
   */
  @Get('oauth/:provider/callback')
  oauthCallback(@Param('provider') provider: string) {
    const envVar = OAUTH_PROVIDERS[provider];
    if (!envVar || !process.env[envVar]) {
      throw new NotImplementedException(
        `${provider} OAuth is not configured yet -- set ${envVar ?? '(unknown provider)'} to enable it`,
      );
    }
    // Real credentials are present: the actual token exchange would happen
    // here once this provider is prioritized. Deliberately not building the
    // exchange logic against credentials that don't exist yet.
    throw new NotImplementedException(
      `${provider} OAuth credentials are configured, but the token exchange isn't implemented yet`,
    );
  }
}
