import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";
import { login as loginRequest, register as registerRequest, setAuthToken } from "./apiClient";
import type { PortalContact } from "../types/portal";

const TOKEN_KEY = "cloud-ops-tool-portal.authToken";
const CONTACT_KEY = "cloud-ops-tool-portal.authContact";

interface AuthContextValue {
  contact: PortalContact | null;
  login: (tenantId: string, email: string, password: string) => Promise<void>;
  register: (tenantId: string, name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadStoredContact(): PortalContact | null {
  const raw = localStorage.getItem(CONTACT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PortalContact;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [contact, setContact] = useState<PortalContact | null>(() => {
    const storedContact = loadStoredContact();
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (storedContact && storedToken) {
      setAuthToken(storedToken);
      return storedContact;
    }
    return null;
  });

  const applySession = (result: { token: string; contact: PortalContact }) => {
    localStorage.setItem(TOKEN_KEY, result.token);
    localStorage.setItem(CONTACT_KEY, JSON.stringify(result.contact));
    setAuthToken(result.token);
    setContact(result.contact);
  };

  const login = async (tenantId: string, email: string, password: string) => {
    applySession(await loginRequest(tenantId, { email, password }));
  };

  const register = async (tenantId: string, name: string, email: string, password: string) => {
    applySession(await registerRequest(tenantId, { name, email, password }));
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(CONTACT_KEY);
    setAuthToken(null);
    setContact(null);
  };

  return <AuthContext.Provider value={{ contact, login, register, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
