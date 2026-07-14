import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../lib/apiClient";
import { useAuth } from "../lib/auth";
import { useTenant } from "../lib/tenant";

export default function RegisterPage() {
  const { tenantId } = useTenant();
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    register(tenantId, name, email, password)
      .then(() => navigate("/tickets"))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Registration failed"))
      .finally(() => setSubmitting(false));
  };

  return (
    <div className="auth-page">
      <h2>Sign up</h2>
      <p className="hint">
        Already submitted a ticket as a guest? Register with the same email to see its status here.
      </p>
      <form className="auth-form" onSubmit={handleSubmit}>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Signing up…" : "Sign up"}
        </button>
      </form>

      <div className="oauth-buttons">
        <p className="hint">Or continue with</p>
        <button type="button" disabled title="Google sign-in isn't configured yet">
          Google (coming soon)
        </button>
        <button type="button" disabled title="Facebook sign-in isn't configured yet">
          Facebook (coming soon)
        </button>
      </div>
    </div>
  );
}
