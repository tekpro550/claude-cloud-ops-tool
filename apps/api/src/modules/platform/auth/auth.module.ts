import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../../notifications/notifications.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { HttpOidcClient, OIDC_HTTP_CLIENT } from './oidc-http.client';
import { SsoConfigController, SsoPublicController } from './sso.controller';
import { SsoService } from './sso.service';

@Module({
  imports: [NotificationsModule],
  controllers: [AuthController, SsoConfigController, SsoPublicController],
  providers: [
    AuthService,
    MfaService,
    SsoService,
    { provide: OIDC_HTTP_CLIENT, useClass: HttpOidcClient },
  ],
  exports: [AuthService],
})
export class AuthModule {}
