import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthUser } from "../lib/apiClient";
import { useAuth } from "../lib/auth";

// Landing page for the OIDC redirect. The API bounces the browser here with the
// freshly minted JWT in the URL fragment (#token=...); we decode its payload for
// the display identity, store the session, and continue into the app.
function decodeToken(token: string): AuthUser | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1])) as {
      sub: string;
      email: string;
      role?: string;
    };
    return {
      id: payload.sub,
      email: payload.email,
      name: payload.email,
      role: (payload.role as AuthUser["role"]) ?? "agent",
    };
  } catch {
    return null;
  }
}

export default function SsoCallbackPage() {
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
    const user = token ? decodeToken(token) : null;
    if (token && user) {
      loginWithToken(token, user);
      navigate("/", { replace: true });
    } else {
      setError("Single sign-on did not return a valid session.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="auth-panel">
      <h2>Signing you in…</h2>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
