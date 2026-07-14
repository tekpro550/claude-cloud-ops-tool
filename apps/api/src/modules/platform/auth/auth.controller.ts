import {
  Body,
  Controller,
  Get,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenantId } from '../http/current-tenant.decorator';
import { CurrentUserId } from '../http/current-user.decorator';
import { TenantHeaderGuard } from '../http/tenant-header.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './login.dto';

@UseGuards(TenantHeaderGuard)
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@CurrentTenantId() tenantId: string, @Body() dto: LoginDto) {
    return this.auth.login(tenantId, dto.email, dto.password);
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
}
