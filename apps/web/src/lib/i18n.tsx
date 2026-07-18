import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

// Dependency-free i18n: a tiny key -> string lookup with {var} interpolation and
// English fallback. Deliberately small (no i18next) — the scaffolding is the
// point; new strings are added as keys to the dictionaries below.
export type Locale = "en" | "es";

const STORAGE_KEY = "cloud-ops-tool.locale";

export const LOCALES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
];

type Dictionary = Record<string, string>;

const en: Dictionary = {
  "nav.group.tickets": "Tickets",
  "nav.group.monitoring": "Monitoring",
  "nav.group.cost": "Cost",
  "nav.dashboard": "Dashboard",
  "nav.tickets": "Tickets",
  "nav.reports": "Reports",
  "nav.knowledgeBase": "Knowledge base",
  "nav.contacts": "Contacts",
  "nav.companies": "Companies",
  "nav.compose": "Compose email",
  "nav.chat": "Chat",
  "nav.fleet": "Fleet",
  "nav.alerts": "Alerts",
  "nav.recommendations": "Recommendations",
  "nav.commitments": "Commitments",
  "nav.savingsLog": "Savings log",
  "nav.admin": "Admin",
  "auth.login": "Log in",
  "auth.logout": "Log out",
  "auth.loggingIn": "Logging in…",
  "auth.cancel": "Cancel",
  "auth.forgot": "Forgot?",
  "auth.twoFactorCode": "6-digit code",
  "auth.verify": "Verify",
  "auth.sso": "SSO",
  "common.search": "Search…",
};

const es: Dictionary = {
  "nav.group.tickets": "Tickets",
  "nav.group.monitoring": "Monitoreo",
  "nav.group.cost": "Costos",
  "nav.dashboard": "Panel",
  "nav.tickets": "Tickets",
  "nav.reports": "Informes",
  "nav.knowledgeBase": "Base de conocimiento",
  "nav.contacts": "Contactos",
  "nav.companies": "Empresas",
  "nav.compose": "Redactar correo",
  "nav.chat": "Chat",
  "nav.fleet": "Flota",
  "nav.alerts": "Alertas",
  "nav.recommendations": "Recomendaciones",
  "nav.commitments": "Compromisos",
  "nav.savingsLog": "Registro de ahorros",
  "nav.admin": "Administración",
  "auth.login": "Iniciar sesión",
  "auth.logout": "Cerrar sesión",
  "auth.loggingIn": "Iniciando sesión…",
  "auth.cancel": "Cancelar",
  "auth.forgot": "¿Olvidó?",
  "auth.twoFactorCode": "Código de 6 dígitos",
  "auth.verify": "Verificar",
  "auth.sso": "SSO",
  "common.search": "Buscar…",
};

const dictionaries: Record<Locale, Dictionary> = { en, es };

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(
    () => (localStorage.getItem(STORAGE_KEY) as Locale) || "en",
  );

  const setLocale = useCallback((next: Locale) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLocaleState(next);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let str = dictionaries[locale]?.[key] ?? en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return str;
    },
    [locale],
  );

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>;
}

export function useTranslation(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useTranslation must be used within an I18nProvider");
  }
  return ctx;
}
