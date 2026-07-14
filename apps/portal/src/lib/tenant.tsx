import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

const STORAGE_KEY = "cloud-ops-tool-portal.tenantId";

interface TenantContextValue {
  tenantId: string;
  setTenantId: (id: string) => void;
}

const TenantContext = createContext<TenantContextValue | null>(null);

/**
 * There's no domain-based tenant resolution yet -- a real deployment would
 * resolve the tenant from the portal's own subdomain/custom domain (see
 * TenantHeaderGuard on the backend). VITE_DEFAULT_TENANT_ID pre-fills tenant
 * zero so a visitor never sees this in the common case; it's stored and
 * overridable the same way the agent app's tenant-id field works.
 */
export function TenantProvider({ children }: { children: ReactNode }) {
  const [tenantId, setTenantIdState] = useState(
    () => localStorage.getItem(STORAGE_KEY) ?? import.meta.env.VITE_DEFAULT_TENANT_ID ?? "",
  );

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
