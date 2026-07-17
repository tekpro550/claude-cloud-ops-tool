import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import * as jwt from 'jsonwebtoken';
import { DataSource } from 'typeorm';
import { withTenantContext } from '../../../database/context/tenant-context';
import { credentialsEncryptionKey } from '../../monitoring/credentials-crypto';
import { signJwt } from './jwt';
import {
  OIDC_HTTP_CLIENT,
  OidcEndpoints,
  OidcHttpClient,
} from './oidc-http.client';

interface SsoConfigRow {
  tenant_id: string;
  provider: string;
  issuer: string;
  client_id: string;
  client_secret: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  default_role: string;
  is_enabled: boolean;
}

/**
 * OpenID Connect single sign-on. An admin registers the tenant's IdP; users then
 * bounce through the provider's authorization-code flow and land back with a
 * normal agent JWT. Provisioning is just-in-time: a first-time SSO user is
 * created in the tenant with the configured default role. (Full SAML remains a
 * follow-up; OIDC covers the common Google/Okta/Entra/Auth0 case.)
 */
@Injectable()
export class SsoService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    @Inject(OIDC_HTTP_CLIENT) private readonly oidc: OidcHttpClient,
  ) {}

  private secret(): string {
    return this.config.get<string>('JWT_SECRET', 'dev-jwt-secret-change-me');
  }

  private redirectUri(): string {
    const base = this.config.get<string>(
      'API_PUBLIC_URL',
      'http://localhost:3000/api/v1',
    );
    return `${base}/auth/sso/callback`;
  }

  /** Admin-facing view of the config — never returns the client secret. */
  getConfig(tenantId: string) {
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [row] = await qr.query(
        `SELECT tenant_id, provider, issuer, client_id, authorization_endpoint,
                token_endpoint, userinfo_endpoint, default_role, is_enabled,
                (client_secret_encrypted IS NOT NULL) AS has_client_secret
           FROM tenant_sso_configs WHERE tenant_id = $1`,
        [tenantId],
      );
      return row ?? null;
    });
  }

  upsertConfig(
    tenantId: string,
    dto: {
      issuer: string;
      clientId: string;
      clientSecret?: string;
      authorizationEndpoint: string;
      tokenEndpoint: string;
      userinfoEndpoint: string;
      defaultRole?: string;
      isEnabled?: boolean;
    },
  ) {
    const key = credentialsEncryptionKey(this.config);
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [existing] = await qr.query(
        `SELECT tenant_id FROM tenant_sso_configs WHERE tenant_id = $1`,
        [tenantId],
      );
      const secret = dto.clientSecret?.trim();
      if (!existing && !secret) {
        throw new BadRequestException(
          'A client secret is required to configure SSO',
        );
      }

      const shared = [
        dto.issuer,
        dto.clientId,
        dto.authorizationEndpoint,
        dto.tokenEndpoint,
        dto.userinfoEndpoint,
        dto.defaultRole ?? 'agent',
        dto.isEnabled ?? true,
      ];

      if (!existing) {
        // New config: secret is guaranteed present by the check above.
        await qr.query(
          `INSERT INTO tenant_sso_configs (
             tenant_id, issuer, client_id, authorization_endpoint,
             token_endpoint, userinfo_endpoint, default_role, is_enabled,
             client_secret_encrypted
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, pgp_sym_encrypt($9, $10))`,
          [tenantId, ...shared, secret, key],
        );
      } else if (secret) {
        // Update including a new secret.
        await qr.query(
          `UPDATE tenant_sso_configs SET
             issuer = $2, client_id = $3, authorization_endpoint = $4,
             token_endpoint = $5, userinfo_endpoint = $6, default_role = $7,
             is_enabled = $8, client_secret_encrypted = pgp_sym_encrypt($9, $10),
             updated_at = now()
           WHERE tenant_id = $1`,
          [tenantId, ...shared, secret, key],
        );
      } else {
        // Update keeping the stored secret untouched.
        await qr.query(
          `UPDATE tenant_sso_configs SET
             issuer = $2, client_id = $3, authorization_endpoint = $4,
             token_endpoint = $5, userinfo_endpoint = $6, default_role = $7,
             is_enabled = $8, updated_at = now()
           WHERE tenant_id = $1`,
          [tenantId, ...shared],
        );
      }
      return this.getConfig(tenantId);
    });
  }

  private loadConfig(tenantId: string): Promise<SsoConfigRow | null> {
    const key = credentialsEncryptionKey(this.config);
    return withTenantContext(this.dataSource, tenantId, async (qr) => {
      const [row] = await qr.query(
        `SELECT tenant_id, provider, issuer, client_id,
                pgp_sym_decrypt(client_secret_encrypted, $2) AS client_secret,
                authorization_endpoint, token_endpoint, userinfo_endpoint,
                default_role, is_enabled
           FROM tenant_sso_configs WHERE tenant_id = $1`,
        [tenantId, key],
      );
      return (row as SsoConfigRow) ?? null;
    });
  }

  /**
   * Step 1: build the IdP authorization URL. `state` is a short-lived signed
   * token binding the round-trip to this tenant (and carrying a nonce), so the
   * callback can trust which tenant it's completing without a server-side table.
   */
  async beginLogin(tenantId: string): Promise<{ redirectUrl: string }> {
    const config = await this.loadConfig(tenantId);
    if (!config || !config.is_enabled) {
      throw new NotFoundException('SSO is not configured for this tenant');
    }
    const state = jwt.sign(
      { purpose: 'sso', tenantId, nonce: randomUUID() },
      this.secret(),
      { expiresIn: '10m' },
    );
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.client_id,
      redirect_uri: this.redirectUri(),
      scope: 'openid email profile',
      state,
    });
    return {
      redirectUrl: `${config.authorization_endpoint}?${params.toString()}`,
    };
  }

  /**
   * Step 2: verify state, exchange the code, read the user's profile, then match
   * or just-in-time provision the user and mint our own agent JWT.
   */
  async completeLogin(code: string, state: string) {
    let tenantId: string;
    try {
      const decoded = jwt.verify(state, this.secret()) as {
        purpose?: string;
        tenantId?: string;
      };
      if (decoded.purpose !== 'sso' || !decoded.tenantId) {
        throw new Error('bad state');
      }
      tenantId = decoded.tenantId;
    } catch {
      throw new UnauthorizedException('Invalid or expired SSO state');
    }

    const config = await this.loadConfig(tenantId);
    if (!config || !config.is_enabled) {
      throw new BadRequestException('SSO is not configured for this tenant');
    }

    const endpoints: OidcEndpoints = {
      tokenEndpoint: config.token_endpoint,
      userinfoEndpoint: config.userinfo_endpoint,
      clientId: config.client_id,
      clientSecret: config.client_secret,
    };
    const { accessToken } = await this.oidc.exchangeCode(
      endpoints,
      code,
      this.redirectUri(),
    );
    const profile = await this.oidc.fetchUserInfo(endpoints, accessToken);

    const user = await withTenantContext(
      this.dataSource,
      tenantId,
      async (qr) => {
        const [existing] = await qr.query(
          `SELECT id, email, name, role FROM users WHERE email = $1`,
          [profile.email],
        );
        if (existing) return existing;
        // Just-in-time provisioning: SSO users have no local password.
        const [created] = await qr.query(
          `INSERT INTO users (tenant_id, email, name, password_hash, role)
           VALUES ($1, $2, $3, '', $4)
           RETURNING id, email, name, role`,
          [
            tenantId,
            profile.email,
            profile.name ?? profile.email,
            config.default_role,
          ],
        );
        return created;
      },
    );

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
  }
}
