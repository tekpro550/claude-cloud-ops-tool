import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, getSsoConfig, upsertSsoConfig } from "../../lib/apiClient";

// Admin-only: register the tenant's OpenID Connect identity provider. Once
// saved and enabled, the header "SSO" button sends users through the provider.
export default function SsoConfigAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authorizationEndpoint, setAuthorizationEndpoint] = useState("");
  const [tokenEndpoint, setTokenEndpoint] = useState("");
  const [userinfoEndpoint, setUserinfoEndpoint] = useState("");
  const [defaultRole, setDefaultRole] = useState<"admin" | "agent">("agent");
  const [isEnabled, setIsEnabled] = useState(true);
  const [hasSecret, setHasSecret] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getSsoConfig(tenantId)
      .then((cfg) => {
        if (!cfg) return;
        setIssuer(cfg.issuer);
        setClientId(cfg.client_id);
        setAuthorizationEndpoint(cfg.authorization_endpoint);
        setTokenEndpoint(cfg.token_endpoint);
        setUserinfoEndpoint(cfg.userinfo_endpoint);
        setDefaultRole(cfg.default_role);
        setIsEnabled(cfg.is_enabled);
        setHasSecret(cfg.has_client_secret);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load SSO config"));
  }, [tenantId]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!hasSecret && !clientSecret.trim()) {
      setError("A client secret is required.");
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    upsertSsoConfig(tenantId, {
      issuer: issuer.trim(),
      clientId: clientId.trim(),
      // Omit when blank on an update so the stored secret is kept.
      clientSecret: clientSecret.trim() || undefined,
      authorizationEndpoint: authorizationEndpoint.trim(),
      tokenEndpoint: tokenEndpoint.trim(),
      userinfoEndpoint: userinfoEndpoint.trim(),
      defaultRole,
      isEnabled,
    })
      .then((cfg) => {
        setHasSecret(cfg.has_client_secret);
        setClientSecret("");
        setSaved(true);
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to save SSO config"))
      .finally(() => setBusy(false));
  };

  return (
    <div className="admin-entity">
      <h4>Single sign-on (OIDC)</h4>
      <p className="hint">
        Connect an OpenID Connect provider (Okta, Entra ID, Google, Auth0…). Users signing in via SSO are provisioned
        just-in-time with the default role below.
      </p>
      {error && <p className="error">{error}</p>}

      <form className="modal-form" onSubmit={handleSubmit}>
        <label>
          Issuer
          <input placeholder="https://example.okta.com" value={issuer} onChange={(e) => setIssuer(e.target.value)} required />
        </label>
        <label>
          Client ID
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} required />
        </label>
        <label>
          Client secret
          <input
            type="password"
            placeholder={hasSecret ? "•••••••• (stored — leave blank to keep)" : "Provider client secret"}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label>
          Authorization endpoint
          <input
            placeholder="https://…/authorize"
            value={authorizationEndpoint}
            onChange={(e) => setAuthorizationEndpoint(e.target.value)}
            required
          />
        </label>
        <label>
          Token endpoint
          <input placeholder="https://…/token" value={tokenEndpoint} onChange={(e) => setTokenEndpoint(e.target.value)} required />
        </label>
        <label>
          Userinfo endpoint
          <input
            placeholder="https://…/userinfo"
            value={userinfoEndpoint}
            onChange={(e) => setUserinfoEndpoint(e.target.value)}
            required
          />
        </label>
        <label>
          Default role for new SSO users
          <select value={defaultRole} onChange={(e) => setDefaultRole(e.target.value as "admin" | "agent")}>
            <option value="agent">Agent</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className="inline-check">
          <input type="checkbox" checked={isEnabled} onChange={(e) => setIsEnabled(e.target.checked)} /> Enable SSO
        </label>

        <div className="modal-form-actions">
          {saved && <span className="hint">Saved.</span>}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save SSO config"}
          </button>
        </div>
      </form>
    </div>
  );
}
