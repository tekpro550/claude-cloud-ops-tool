import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../http/current-tenant.decorator';
import { CurrentUserId } from '../http/current-user.decorator';
import { TenantHeaderGuard } from '../http/tenant-header.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './login.dto';
import { MfaCodeDto } from './mfa.dto';
import { MfaService } from './mfa.service';
import {
  RequestPasswordResetDto,
  ResetPasswordDto,
} from './reset-password.dto';

@UseGuards(TenantHeaderGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
  ) {}

  @Post('login')
  login(@CurrentTenantId() tenantId: string, @Body() dto: LoginDto) {
    return this.auth.login(tenantId, dto.email, dto.password, dto.totpCode);
  }

  // ---- Two-factor (TOTP) enrollment ----

  @Get('2fa')
  mfaStatus(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
  ) {
    if (!userId) throw new UnauthorizedException('Requires a Bearer token');
    return this.mfa.status(tenantId, userId);
  }

  // Returns the secret + otpauth URI once, for the user to scan into an app.
  @Post('2fa/setup')
  mfaSetup(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
  ) {
    if (!userId) throw new UnauthorizedException('Requires a Bearer token');
    return this.mfa.beginSetup(tenantId, userId);
  }

  @Post('2fa/enable')
  @HttpCode(204)
  async mfaEnable(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
    @Body() dto: MfaCodeDto,
  ) {
    if (!userId) throw new UnauthorizedException('Requires a Bearer token');
    await this.mfa.enable(tenantId, userId, dto.code);
  }

  @Post('2fa/disable')
  @HttpCode(204)
  async mfaDisable(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
    @Body() dto: MfaCodeDto,
  ) {
    if (!userId) throw new UnauthorizedException('Requires a Bearer token');
    await this.mfa.disable(tenantId, userId, dto.code);
  }

  @Get('me')
  me(
    @CurrentTenantId() tenantId: string,
    @CurrentUserId() userId: string | undefined,
  ) {
    if (!userId) {
      throw new UnauthorizedException(
        'GET /auth/me requires a Bearer token, not just X-Tenant-Id',
      );
    }
    return this.auth.me(tenantId, userId);
  }

  // "Log out everywhere" — revokes every token this user currently holds.
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUserId() userId: string | undefined) {
    if (!userId) {
      throw new UnauthorizedException('Logout requires a Bearer token');
    }
    await this.auth.logout(userId);
  }

  // Always 204, even for an unknown email, so the endpoint can't enumerate users.
  @Post('request-password-reset')
  @HttpCode(204)
  async requestPasswordReset(
    @CurrentTenantId() tenantId: string,
    @Body() dto: RequestPasswordResetDto,
  ) {
    await this.auth.requestPasswordReset(tenantId, dto.email);
  }

  @Post('reset-password')
  @HttpCode(204)
  async resetPassword(
    @CurrentTenantId() tenantId: string,
    @Body() dto: ResetPasswordDto,
  ) {
    await this.auth.resetPassword(tenantId, dto.token, dto.password);
  }
}
