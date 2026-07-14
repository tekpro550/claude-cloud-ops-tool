import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { type AuthUser, login as loginRequest, setAuthToken } from "./apiClient";

const TOKEN_KEY = "cloud-ops-tool.authToken";
const USER_KEY = "cloud-ops-tool.authUser";

interface AuthContextValue {
  user: AuthUser | null;
  login: (tenantId: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

/**
 * Additive on top of the tenant-header stand-in (lib/tenant.tsx), not a
 * replacement: logging in issues a token that apiClient attaches as a
 * Bearer header, but X-Tenant-Id keeps being sent too, so every page that
 * hasn't been updated to expect a logged-in user still works exactly as
 * before for the un-authenticated tenant-header flow.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const storedUser = loadStoredUser();
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (storedUser && storedToken) {
      setAuthToken(storedToken);
      return storedUser;
    }
    return null;
  });

  const login = async (tenantId: string, email: string, password: string) => {
    const result = await loginRequest(tenantId, email, password);
    localStorage.setItem(TOKEN_KEY, result.token);
    localStorage.setItem(USER_KEY, JSON.stringify(result.user));
    setAuthToken(result.token);
    setUser(result.user);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setAuthToken(null);
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
