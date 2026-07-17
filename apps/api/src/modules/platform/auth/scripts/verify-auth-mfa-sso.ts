import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcryptjs';
import { Client } from 'pg';
import { AppModule } from '../../../../app.module';
import { AuthService } from '../auth.service';
import { MfaService } from '../mfa.service';
import { OIDC_HTTP_CLIENT, OidcHttpClient } from '../oidc-http.client';
import { SsoService } from '../sso.service';
import { totpCodeAt, verifyTotp } from '../totp';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Auth MFA/SSO verification FAILED: ${message}`);
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

// A fake OpenID provider: the token endpoint always yields the same access
// token, and userinfo returns a fixed profile. This lets the SSO flow run
// end to end with no real IdP or network.
class FakeOidcClient implements OidcHttpClient {
  constructor(private readonly profileEmail: string) {}
  async exchangeCode() {
    return { accessToken: 'fake-access-token' };
  }
  async fetchUserInfo() {
    return {
      sub: 'idp-user-1',
      email: this.profileEmail,
      name: 'SSO Person',
    };
  }
}

async function main() {
  const migrator = migratorClient();
  await migrator.connect();

  const slug = `auth-mfa-sso-verify-${Date.now()}`;
  const {
    rows: [tenant],
  } = await migrator.query(
    `INSERT INTO tenants (name, slug, plan_tier) VALUES ($1, $2, 'internal') RETURNING id`,
    ['Auth MFA/SSO Verify', slug],
  );
  const email = `mfa-user-${Date.now()}@example.com`;
  const password = 'correct horse battery';
  const passwordHash = await bcrypt.hash(password, 10);
  await migrator.query(
    `INSERT INTO users (tenant_id, email, name, password_hash, role)
     VALUES ($1, $2, 'MFA User', $3, 'admin')`,
    [tenant.id, email, passwordHash],
  );
  const {
    rows: [userRow],
  } = await migrator.query(
    `SELECT id FROM users WHERE tenant_id = $1 AND email = $2`,
    [tenant.id, email],
  );
  const userId = userRow.id as string;
  const ssoEmail = `sso-${Date.now()}@example.com`;

  const testApp = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  const auth = testApp.get(AuthService);
  const mfa = testApp.get(MfaService);
  const sso = testApp.get(SsoService);
  // Swap the real OIDC HTTP client for the fake IdP by mutating the singleton
  // instance SsoService already holds a reference to.
  const oidcSlot = testApp.get(OIDC_HTTP_CLIENT) as Record<string, unknown>;
  const fake = new FakeOidcClient(ssoEmail);
  oidcSlot.exchangeCode = fake.exchangeCode.bind(fake);
  oidcSlot.fetchUserInfo = fake.fetchUserInfo.bind(fake);

  try {
    // ---- TOTP primitive ----
    const now = Date.now();
    assert(
      verifyTotp('JBSWY3DPEHPK3PXP', totpCodeAt('JBSWY3DPEHPK3PXP', now), now),
      'a freshly generated TOTP code verifies against its secret',
    );
    assert(
      !verifyTotp('JBSWY3DPEHPK3PXP', '000000', now) ||
        totpCodeAt('JBSWY3DPEHPK3PXP', now) === '000000',
      'a wrong TOTP code is rejected',
    );

    // ---- Login without 2FA ----
    const plain = await auth.login(tenant.id, email, password);
    assert(
      'token' in plain && typeof plain.token === 'string',
      'password login issues a JWT when 2FA is off',
    );

    // ---- 2FA enrollment ----
    const setup = await mfa.beginSetup(tenant.id, userId);
    assert(
      typeof setup.secret === 'string' &&
        setup.otpauthUri.startsWith('otpauth://'),
      'setup returns a secret and an otpauth:// URI',
    );
    assert(
      (await mfa.status(tenant.id, userId)).enabled === false,
      'setup alone does not enable 2FA',
    );

    let badEnable: any = null;
    try {
      await mfa.enable(tenant.id, userId, '000000');
    } catch (err) {
      badEnable = err;
    }
    assert(
      badEnable?.status === 401,
      'enabling 2FA with a wrong code is rejected',
    );

    await mfa.enable(tenant.id, userId, totpCodeAt(setup.secret));
    assert(
      (await mfa.status(tenant.id, userId)).enabled === true,
      'enabling with the correct code turns 2FA on',
    );

    // ---- Login now demands the second factor ----
    const challenge = await auth.login(tenant.id, email, password);
    assert(
      'mfaRequired' in challenge && challenge.mfaRequired === true,
      'password-only login now returns an mfaRequired challenge',
    );

    let wrongCode: any = null;
    try {
      await auth.login(tenant.id, email, password, '123456');
    } catch (err) {
      wrongCode = err;
    }
    assert(
      wrongCode?.status === 401,
      'login with a wrong 2FA code is rejected',
    );

    const full = await auth.login(
      tenant.id,
      email,
      password,
      totpCodeAt(setup.secret),
    );
    assert(
      'token' in full && typeof full.token === 'string',
      'login with the correct 2FA code issues a JWT',
    );

    // ---- Disable requires a valid code ----
    await mfa.disable(tenant.id, userId, totpCodeAt(setup.secret));
    assert(
      (await mfa.status(tenant.id, userId)).enabled === false,
      'disabling with a valid code turns 2FA back off',
    );

    // Secret must be gone after disable (not just the flag).
    const {
      rows: [secretCheck],
    } = await migrator.query(
      `SELECT totp_secret_encrypted IS NULL AS cleared FROM users WHERE id = $1`,
      [userId],
    );
    assert(
      secretCheck.cleared === true,
      'disabling 2FA also clears the stored secret',
    );

    // ---- OIDC SSO ----
    let notConfigured: any = null;
    try {
      await sso.beginLogin(tenant.id);
    } catch (err) {
      notConfigured = err;
    }
    assert(
      notConfigured?.status === 404,
      'beginLogin fails before an IdP is configured',
    );

    await sso.upsertConfig(tenant.id, {
      issuer: 'https://idp.example.com',
      clientId: 'client-123',
      clientSecret: 'super-secret',
      authorizationEndpoint: 'https://idp.example.com/authorize',
      tokenEndpoint: 'https://idp.example.com/token',
      userinfoEndpoint: 'https://idp.example.com/userinfo',
      defaultRole: 'agent',
      isEnabled: true,
    });

    const cfg = await sso.getConfig(tenant.id);
    assert(
      cfg && !('client_secret' in cfg) && cfg.has_client_secret === true,
      'getConfig reports a stored secret but never returns its value',
    );

    const begin = await sso.beginLogin(tenant.id);
    assert(
      begin.redirectUrl.startsWith('https://idp.example.com/authorize?') &&
        begin.redirectUrl.includes('state=') &&
        begin.redirectUrl.includes('client_id=client-123'),
      'beginLogin builds the IdP authorization URL with a signed state',
    );
    const state = new URL(begin.redirectUrl).searchParams.get('state')!;

    const ssoResult = await sso.completeLogin('auth-code-xyz', state);
    assert(
      'token' in ssoResult && ssoResult.user.email === ssoEmail,
      'completeLogin exchanges the code and just-in-time provisions the SSO user',
    );

    const {
      rows: [provisioned],
    } = await migrator.query(
      `SELECT role FROM users WHERE tenant_id = $1 AND email = $2`,
      [tenant.id, ssoEmail],
    );
    assert(
      provisioned?.role === 'agent',
      'a provisioned SSO user gets the configured default role',
    );

    // A second SSO login for the same email matches, not duplicates.
    const state2 = new URL(
      (await sso.beginLogin(tenant.id)).redirectUrl,
    ).searchParams.get('state')!;
    await sso.completeLogin('auth-code-2', state2);
    const {
      rows: [count],
    } = await migrator.query(
      `SELECT count(*)::int AS n FROM users WHERE tenant_id = $1 AND email = $2`,
      [tenant.id, ssoEmail],
    );
    assert(count.n === 1, 'a repeat SSO login matches the existing user');

    let tamperedState: any = null;
    try {
      await sso.completeLogin('code', 'not-a-real-state');
    } catch (err) {
      tamperedState = err;
    }
    assert(
      tamperedState?.status === 401,
      'an invalid/forged state is rejected at the callback',
    );

    console.log('\nAll auth MFA/SSO checks passed.');
  } finally {
    await testApp.close();
    await migrator.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);
    await migrator.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
