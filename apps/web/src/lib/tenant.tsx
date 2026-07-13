import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

const STORAGE_KEY = "cloud-ops-tool.tenantId";

interface TenantContextValue {
  tenantId: string;
  setTenantId: (id: string) => void;
}

const TenantContext = createContext<TenantContextValue | null>(null);

/**
 * There's no auth/login yet (Sprint 1 is ticket core, not auth), so the
 * frontend's only notion of "who am I" is this locally-stored tenant id,
 * sent as X-Tenant-Id on every request — mirroring the backend's own
 * documented stand-in (TenantHeaderGuard) for the bearer-token auth
 * described in the architecture plan. Replace both together once real
 * auth exists.
 */
export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenantId, setTenantIdState] = useState(() => localStorage.getItem(STORAGE_KEY) ?? "");

  const setTenantId = (id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    setTenantIdState(id);
  };

  return <TenantContext.Provider value={{ tenantId, setTenantId }}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantContextValue {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error("useTenant must be used within a TenantProvider");
  }
  return context;
}
