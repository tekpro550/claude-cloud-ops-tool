import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcryptjs';
import { Client } from 'pg';
import Redis from 'ioredis';
import { AppModule } from '../../../../app.module';
import { AuthService } from '../auth.service';
import { isSessionRevoked, registerLoginAttempt } from '../auth-security';
import { verifyJwt } from '../jwt';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Auth hygiene verification FAILED: ${message}`);
  }
  console.log(`  OK  ${message}`);
}

function migratorClient() {
  return new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    database: process.env.DB_NAME ?? 'cloud_ops_tool',
    user: process.env.DB_MIGRATOR_USER ?? 'postgres',
    password: process.env.DB_MIGRATOR_PASSWORD ?? 'postgres',
  });
}

/**
 * Proves the auth-hygiene controls: login rate-limiting, password reset via a
 * single-use token, and session revocation (a reset invalidates old tokens).
 */
async function main() {
  const migrator = migratorClient();
  await migrator.connect();
  const slug = `auth-hygiene-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Auth Hygiene Verify', slug],
  );
  const email = `agent-${Date.now()}@example.com`;
  const passwordHash = await bcrypt.hash('OldPassw0rd!', 10);
  const {
    rows: [user],
  } = await migrator.query(
    `INSERT INTO users (tenant_id, email, name, role, password_hash)
     VALUES ($1, $2, 'Hygiene Agent', 'agent', $3) RETURNING id`,
    [tenant.id, email, passwordHash],
  );

  const redis = new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
  });

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const auth = app.get(AuthService);

  try {
    // --- login works and issues a token ---
    const result = await auth.login(tenant.id, email, 'OldPassw0rd!');
    assert(!!result.token, 'login with correct credentials returns a token');
    const claims = verifyJwt(result.token);
    assert(claims?.kind === 'agent', 'the token is an agent token');

    // --- rate-limiting: too many attempts on one key get blocked ---
    const key = `${tenant.id}:throttle-probe`;
    let blocked = false;
    for (let i = 0; i < 7; i++) {
      const r = await registerLoginAttempt(key);
      if (!r.allowed) blocked = true;
    }
    assert(blocked, 'login rate-limiter blocks after too many attempts');

    // A wrong-password login surfaces as 401 (not revealing which was wrong).
    let unauthorized = false;
    try {
      await auth.login(tenant.id, email, 'wrong-password');
    } catch (e) {
      unauthorized = (e as { status?: number }).status === 401;
    }
    assert(unauthorized, 'login with a wrong password is rejected (401)');

    // --- session revocation: logout-all invalidates the earlier token ---
    await auth.logout(user.id);
    assert(
      await isSessionRevoked(user.id, claims!.iat),
      'logout revokes tokens issued before it',
    );

    // --- password reset flow ---
    const token = await auth.requestPasswordReset(tenant.id, email);
    assert(!!token, 'requesting a reset for a real email returns a token');
    const missing = await auth.requestPasswordReset(
      tenant.id,
      'nobody@example.com',
    );
    assert(
      missing === null,
      'requesting a reset for an unknown email is a silent no-op',
    );

    await auth.resetPassword(tenant.id, token as string, 'BrandNewP@ss1');
    // Old password no longer works; new one does.
    let oldRejected = false;
    try {
      await auth.login(tenant.id, email, 'OldPassw0rd!');
    } catch {
      oldRejected = true;
    }
    assert(oldRejected, 'the old password stops working after a reset');
    const relogin = await auth.login(tenant.id, email, 'BrandNewP@ss1');
    assert(!!relogin.token, 'the new password works after a reset');

    // A used reset token can't be replayed.
    let replayRejected = false;
    try {
      await auth.resetPassword(tenant.id, token as string, 'Another1Pass');
    } catch {
      replayRejected = true;
    }
    assert(replayRejected, 'a reset token is single-use (replay rejected)');

    console.log('\nAll auth hygiene checks passed.');
  } finally {
    await migrator.query(
      `DELETE FROM password_reset_tokens WHERE tenant_id = $1`,
      [tenant.id],
    );
    await migrator.query(`DELETE FROM users WHERE tenant_id = $1`, [tenant.id]);
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
    await migrator.end();
    await redis.del(`auth:revoke:${user.id}`);
    redis.disconnect();
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
