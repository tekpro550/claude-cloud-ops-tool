import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ApiError, requestPasswordReset, resetPassword } from "../lib/apiClient";
import { useTenant } from "../lib/tenant";

// Handles both steps of the reset flow: with no ?token it shows "request a
// reset link"; with a ?token (from the emailed link) it sets a new password.
export default function ResetPasswordPage() {
  const { tenantId } = useTenant();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to reset a password.</p>;
  }

  const handleRequest = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    requestPasswordReset(tenantId, email)
      .then(() => setDone(true))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Request failed"))
      .finally(() => setBusy(false));
  };

  const handleReset = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    resetPassword(tenantId, token, password)
      .then(() => {
        setDone(true);
        setTimeout(() => navigate("/"), 1500);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Reset failed"))
      .finally(() => setBusy(false));
  };

  return (
    <div className="auth-panel">
      <h2>Reset password</h2>
      {error && <p className="error">{error}</p>}

      {token ? (
        done ? (
          <p className="hint">Password updated. Redirecting to sign in…</p>
        ) : (
          <form className="modal-form" onSubmit={handleReset}>
            <label>
              New password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
                autoFocus
              />
            </label>
            <div className="modal-form-actions">
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Saving…" : "Set new password"}
              </button>
            </div>
          </form>
        )
      ) : done ? (
        <p className="hint">
          If an account exists for that email, a reset link is on its way.
        </p>
      ) : (
        <form className="modal-form" onSubmit={handleRequest}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <div className="modal-form-actions">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
