import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { credentialsEncryptionKey } from '../../monitoring/credentials-crypto';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp';

/**
 * Two-factor (TOTP) enrollment and lifecycle. The secret is stored encrypted at
 * rest (pgcrypto, same key as cloud credentials) and only ever leaves the server
 * once — at setup, so the user can scan it into an authenticator. Enable/disable
 * both require a valid current code, proving the user actually holds the device.
 */
@Injectable()
export class MfaService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  status(tenantId: string, userId: string) {
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [user] = await qr.query(
        `SELECT totp_enabled FROM users WHERE id = $1`,
        [userId],
      );
      if (!user) throw new UnauthorizedException('User not found');
      return { enabled: user.totp_enabled as boolean };
    });
  }

  /** Generate + store a pending secret (not yet enabled) and return it once. */
  beginSetup(tenantId: string, userId: string) {
    const key = credentialsEncryptionKey(this.config);
    const secret = generateTotpSecret();
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [user] = await qr.query(`SELECT email FROM users WHERE id = $1`, [
        userId,
      ]);
      if (!user) throw new UnauthorizedException('User not found');
      await qr.query(
        `UPDATE users
           SET totp_secret_encrypted = pgp_sym_encrypt($1, $2), totp_enabled = false
         WHERE id = $3`,
        [secret, key, userId],
      );
      return { secret, otpauthUri: otpauthUri(secret, user.email) };
    });
  }

  /** Verify a code against the pending secret and flip 2FA on. */
  async enable(tenantId: string, userId: string, code: string): Promise<void> {
    const key = credentialsEncryptionKey(this.config);
    await withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [user] = await qr.query(
        `SELECT pgp_sym_decrypt(totp_secret_encrypted, $2) AS secret
           FROM users WHERE id = $1 AND totp_secret_encrypted IS NOT NULL`,
        [userId, key],
      );
      if (!user) {
        throw new BadRequestException('Start 2FA setup before enabling it');
      }
      if (!verifyTotp(user.secret, code)) {
        throw new UnauthorizedException('Invalid authentication code');
      }
      await qr.query(`UPDATE users SET totp_enabled = true WHERE id = $1`, [
        userId,
      ]);
    });
  }

  /** Require a valid code, then turn 2FA off and drop the stored secret. */
  async disable(tenantId: string, userId: string, code: string): Promise<void> {
    const key = credentialsEncryptionKey(this.config);
    await withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [user] = await qr.query(
        `SELECT pgp_sym_decrypt(totp_secret_encrypted, $2) AS secret
           FROM users WHERE id = $1 AND totp_enabled = true`,
        [userId, key],
      );
      if (!user) {
        throw new BadRequestException('2FA is not enabled for this account');
      }
      if (!verifyTotp(user.secret, code)) {
        throw new UnauthorizedException('Invalid authentication code');
      }
      await qr.query(
        `UPDATE users
           SET totp_enabled = false, totp_secret_encrypted = NULL
         WHERE id = $1`,
        [userId],
      );
    });
  }
}
