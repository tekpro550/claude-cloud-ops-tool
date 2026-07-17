/**
 * The outbound half of the OIDC flow, behind a DI token so tests substitute a
 * fake identity provider (no real IdP or network needed to verify SSO). The
 * real client just speaks the standard authorization-code token + userinfo
 * requests over HTTPS.
 */
export const OIDC_HTTP_CLIENT = 'OIDC_HTTP_CLIENT';

export interface OidcEndpoints {
  tokenEndpoint: string;
  userinfoEndpoint: string;
  clientId: string;
  clientSecret: string;
}

export interface OidcUserInfo {
  sub: string;
  email: string;
  name?: string;
}

export interface OidcHttpClient {
  exchangeCode(
    endpoints: OidcEndpoints,
    code: string,
    redirectUri: string,
  ): Promise<{ accessToken: string }>;
  fetchUserInfo(
    endpoints: OidcEndpoints,
    accessToken: string,
  ): Promise<OidcUserInfo>;
}

export class HttpOidcClient implements OidcHttpClient {
  async exchangeCode(
    endpoints: OidcEndpoints,
    code: string,
    redirectUri: string,
  ): Promise<{ accessToken: string }> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: endpoints.clientId,
      client_secret: endpoints.clientSecret,
    });
    const res = await fetch(endpoints.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`OIDC token exchange failed (${res.status})`);
    }
    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) {
      throw new Error('OIDC token response had no access_token');
    }
    return { accessToken: json.access_token };
  }

  async fetchUserInfo(
    endpoints: OidcEndpoints,
    accessToken: string,
  ): Promise<OidcUserInfo> {
    const res = await fetch(endpoints.userinfoEndpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`OIDC userinfo request failed (${res.status})`);
    }
    const json = (await res.json()) as OidcUserInfo & {
      preferred_username?: string;
    };
    if (!json.email) {
      throw new Error('OIDC userinfo had no email claim');
    }
    return { sub: json.sub, email: json.email, name: json.name };
  }
}
