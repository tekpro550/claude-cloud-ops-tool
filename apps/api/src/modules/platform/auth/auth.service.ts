import { createHash, randomBytes } from 'crypto';
import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { NotificationsService } from '../../../notifications/notifications.service';
import { credentialsEncryptionKey } from '../../monitoring/credentials-crypto';
import {
  clearLoginAttempts,
  registerLoginAttempt,
  revokeUserSessions,
} from './auth-security';
import { signJwt } from './jwt';
import { verifyTotp } from './totp';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async login(
    tenantId: string,
    email: string,
    password: string,
    totpCode?: string,
  ) {
    // Rate-limit before touching the DB so a brute-force run is cheap to shed.
    const throttleKey = `${tenantId}:${email.toLowerCase()}`;
    const throttle = await registerLoginAttempt(throttleKey);
    if (!throttle.allowed) {
      throw new HttpException(
        `Too many login attempts. Try again in ${throttle.retryAfterSeconds} seconds.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [user] = await queryRunner.query(
        `SELECT * FROM users WHERE email = $1`,
        [email],
      );
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        throw new UnauthorizedException('Invalid email or password');
      }

      // Second factor: only after the password checks out (so the mfaRequired
      // signal can't be used to enumerate accounts). A missing code prompts the
      // client for one rather than failing the login outright.
      if (user.totp_enabled) {
        if (!totpCode) {
          return { mfaRequired: true } as const;
        }
        const key = credentialsEncryptionKey(this.config);
        const [secretRow] = await queryRunner.query(
          `SELECT pgp_sym_decrypt(totp_secret_encrypted, $2) AS secret
             FROM users WHERE id = $1`,
          [user.id, key],
        );
        if (!secretRow || !verifyTotp(secretRow.secret, totpCode)) {
          throw new UnauthorizedException('Invalid authentication code');
        }
      }

      await clearLoginAttempts(throttleKey);

      const token = signJwt({
        sub: user.id,
        tenantId,
        email: user.email,
        role: user.role,
        kind: 'agent',
      });
      return {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      };
    });
  }

  me(tenantId: string, userId: string) {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [user] = await queryRunner.query(
        `SELECT id, email, name, role FROM users WHERE id = $1`,
        [userId],
      );
      if (!user) {
        throw new UnauthorizedException('User not found');
      }
      return user;
    });
  }

  /** Invalidate every token this user currently holds ("log out everywhere"). */
  logout(userId: string): Promise<void> {
    return revokeUserSessions(userId);
  }

  /**
   * Create a single-use, 1-hour reset token and email the user a link. Returns
   * the raw token to the caller (for the email + tests) but the controller
   * never echoes it back over HTTP, and a missing email is a silent no-op so
   * the endpoint can't be used to probe which addresses exist.
   */
  requestPasswordReset(
    tenantId: string,
    email: string,
  ): Promise<string | null> {
    return withTenantContext(this.dataSource, tenantId, async (queryRunner) => {
      const [user] = await queryRunner.query(
        `SELECT id, name, email FROM users WHERE email = $1`,
        [email],
      );
      if (!user) return null;

      const token = randomBytes(32).toString('hex');
      await queryRunner.query(
        `INSERT INTO password_reset_tokens (tenant_id, user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, now() + interval '1 hour')`,
        [tenantId, user.id, hashToken(token)],
      );

      const baseUrl = this.config.get<string>(
        'WEB_APP_URL',
        'http://localhost:5173',
      );
      const resetUrl = `${baseUrl}/reset-password?token=${token}`;
      await this.notifications
        .enqueue({
          tenantId,
          channel: 'email',
          recipient: user.email,
          templateName: 'platform.password_reset',
          payload: { name: user.name, resetUrl },
        })
        .catch(() => undefined);

      return token;
    });
  }

  /**
   * Consume a reset token: set the new password, mark the token used, and
   * revoke every existing session so old tokens (and anyone who had the old
   * password) can't keep acting as the user.
   */
  async resetPassword(
    tenantId: string,
    token: string,
    newPassword: string,
  ): Promise<void> {
    const userId = await withTenantContext(
      this.dataSource,
      tenantId,
      async (queryRunner) => {
        const [row] = await queryRunner.query(
          `SELECT id, user_id FROM password_reset_tokens
           WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
          [hashToken(token)],
        );
        if (!row) {
          throw new UnauthorizedException('Invalid or expired reset token');
        }

        const passwordHash = await bcrypt.hash(newPassword, 10);
        await queryRunner.query(
          `UPDATE users SET password_hash = $1 WHERE id = $2`,
          [passwordHash, row.user_id],
        );
        await queryRunner.query(
          `UPDATE password_reset_tokens SET used_at = now() WHERE id = $1`,
          [row.id],
        );
        return row.user_id as string;
      },
    );

    await revokeUserSessions(userId);
  }
}
