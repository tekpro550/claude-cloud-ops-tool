import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ApiError,
  disableMfa,
  enableMfa,
  getMfaStatus,
  setupMfa,
  type MfaSetup,
} from "../../lib/apiClient";

// Self-service TOTP enrollment for the signed-in agent. Requires a Bearer
// token (log in first); the tenant-header-only flow can't enroll since there's
// no user identity to attach the secret to.
export default function TwoFactorAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = () => {
    getMfaStatus(tenantId)
      .then((s) => setEnabled(s.enabled))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Log in as an agent to manage two-factor auth"),
      );
  };

  useEffect(loadStatus, [tenantId]);

  const beginSetup = () => {
    setBusy(true);
    setError(null);
    setupMfa(tenantId)
      .then(setSetup)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to start 2FA setup"))
      .finally(() => setBusy(false));
  };

  const confirmEnable = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    enableMfa(tenantId, code.trim())
      .then(() => {
        setSetup(null);
        setCode("");
        setEnabled(true);
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "That code didn't verify"))
      .finally(() => setBusy(false));
  };

  const confirmDisable = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    disableMfa(tenantId, code.trim())
      .then(() => {
        setCode("");
        setEnabled(false);
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "That code didn't verify"))
      .finally(() => setBusy(false));
  };

  return (
    <div className="admin-entity">
      <h4>Two-factor authentication</h4>
      <p className="hint">
        Add a time-based one-time code (Google Authenticator, 1Password, Authy…) to your own sign-in. Applies to the
        logged-in agent account.
      </p>
      {error && <p className="error">{error}</p>}

      {enabled === true && !setup && (
        <form className="modal-form" onSubmit={confirmDisable}>
          <p className="hint">
            <span className="badge kb-badge-published">Enabled</span> Two-factor is on for your account.
          </p>
          <label>
            Enter a current code to turn it off
            <input inputMode="numeric" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <div className="modal-form-actions">
            <button type="submit" className="btn-danger" disabled={busy || code.trim().length !== 6}>
              {busy ? "Working…" : "Disable 2FA"}
            </button>
          </div>
        </form>
      )}

      {enabled === false && !setup && (
        <div className="modal-form-actions">
          <button type="button" className="btn-primary" onClick={beginSetup} disabled={busy}>
            {busy ? "Working…" : "Set up 2FA"}
          </button>
        </div>
      )}

      {setup && (
        <form className="modal-form" onSubmit={confirmEnable}>
          <p className="hint">
            Add this secret to your authenticator app, then enter the 6-digit code it shows to confirm.
          </p>
          <label>
            Secret key
            <input readOnly value={setup.secret} onFocus={(e) => e.currentTarget.select()} />
          </label>
          <p className="hint mfa-otpauth">{setup.otpauthUri}</p>
          <label>
            Verification code
            <input
              inputMode="numeric"
              placeholder="123456"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <div className="modal-form-actions">
            <button type="button" onClick={() => setSetup(null)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={busy || code.trim().length !== 6}>
              {busy ? "Verifying…" : "Enable 2FA"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
