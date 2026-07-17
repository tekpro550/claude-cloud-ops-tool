import { useState } from "react";
import type { FormEvent } from "react";
import { Link, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import "./App.css";
import NeedsAttentionBanner from "./components/NeedsAttentionBanner";
import { ApiError } from "./lib/apiClient";
import { useAuth } from "./lib/auth";
import { LOCALES, useTranslation } from "./lib/i18n";
import { useTenant } from "./lib/tenant";
import AdminPage from "./pages/AdminPage";
import AlertsPage from "./pages/AlertsPage";
import ChatPage from "./pages/ChatPage";
import CompaniesPage from "./pages/CompaniesPage";
import ComposeOutboundPage from "./pages/ComposeOutboundPage";
import ContactsPage from "./pages/ContactsPage";
import CostAccountDetailPage from "./pages/CostAccountDetailPage";
import CostDashboardPage from "./pages/CostDashboardPage";
import CostRollupPage from "./pages/CostRollupPage";
import DashboardPage from "./pages/DashboardPage";
import KnowledgeBasePage from "./pages/KnowledgeBasePage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import ReportsPage from "./pages/ReportsPage";
import RecommendationsPage from "./pages/RecommendationsPage";
import SavingsLogPage from "./pages/SavingsLogPage";
import MonitoringDashboardPage from "./pages/MonitoringDashboardPage";
import MonitoringFleetPage from "./pages/MonitoringFleetPage";
import NewTicketPage from "./pages/NewTicketPage";
import ResourceDashboardPage from "./pages/ResourceDashboardPage";
import SearchPage from "./pages/SearchPage";
import TicketDetailPage from "./pages/TicketDetailPage";
import TicketListPage from "./pages/TicketListPage";

function HeaderSearch() {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const { t } = useTranslation();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!q.trim()) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <form className="header-search" onSubmit={handleSubmit}>
      <input placeholder={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} />
    </form>
  );
}

function LanguageSelect() {
  const { locale, setLocale } = useTranslation();
  return (
    <select
      className="language-select"
      aria-label="Language"
      value={locale}
      onChange={(e) => setLocale(e.target.value as (typeof LOCALES)[number]["value"])}
    >
      {LOCALES.map((l) => (
        <option key={l.value} value={l.value}>
          {l.label}
        </option>
      ))}
    </select>
  );
}

function HeaderAuth() {
  const { tenantId } = useTenant();
  const { user, login, logout } = useAuth();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) {
    return (
      <div className="header-auth">
        <span className="header-auth-user">
          {user.name} <span className="header-auth-role">({user.role})</span>
        </span>
        <button type="button" onClick={logout}>
          {t("auth.logout")}
        </button>
      </div>
    );
  }

  if (!expanded) {
    return (
      <div className="header-auth">
        <button type="button" onClick={() => setExpanded(true)}>
          {t("auth.login")}
        </button>
      </div>
    );
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(tenantId, email, password);
      setExpanded(false);
      setEmail("");
      setPassword("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="header-auth header-auth-form" onSubmit={handleSubmit}>
      <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input
        placeholder="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="submit" disabled={submitting}>
        {submitting ? t("auth.loggingIn") : t("auth.login")}
      </button>
      <button type="button" onClick={() => setExpanded(false)}>
        {t("auth.cancel")}
      </button>
      <Link className="header-auth-forgot" to="/reset-password" onClick={() => setExpanded(false)}>
        {t("auth.forgot")}
      </Link>
      {error && <span className="header-auth-error">{error}</span>}
    </form>
  );
}

type NavItem = { i18nKey: string; to: string; icon: string; end?: boolean };

const TICKETS_NAV_ITEMS: NavItem[] = [
  { i18nKey: "nav.dashboard", to: "/dashboard", icon: "📊" },
  { i18nKey: "nav.tickets", to: "/", icon: "🎫", end: true },
  { i18nKey: "nav.reports", to: "/reports", icon: "📈" },
  { i18nKey: "nav.knowledgeBase", to: "/knowledge-base", icon: "📚" },
  { i18nKey: "nav.contacts", to: "/contacts", icon: "👤" },
  { i18nKey: "nav.companies", to: "/companies", icon: "🏢" },
  { i18nKey: "nav.compose", to: "/compose", icon: "✉️" },
  { i18nKey: "nav.chat", to: "/chat", icon: "💬" },
];

const MONITORING_NAV_ITEMS: NavItem[] = [
  { i18nKey: "nav.dashboard", to: "/monitoring/dashboard", icon: "📊" },
  { i18nKey: "nav.fleet", to: "/monitoring", icon: "🖥️", end: true },
  { i18nKey: "nav.alerts", to: "/alerts", icon: "🔔" },
];

const COST_NAV_ITEMS: NavItem[] = [
  { i18nKey: "nav.dashboard", to: "/cost/dashboard", icon: "📊" },
  { i18nKey: "nav.group.cost", to: "/cost", icon: "💰", end: true },
  { i18nKey: "nav.recommendations", to: "/cost/recommendations", icon: "💡" },
  { i18nKey: "nav.savingsLog", to: "/cost/savings", icon: "📈" },
];

function NavPanelButton({ item, extraClassName, onClick }: { item: NavItem; extraClassName?: string; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onClick}
      className={({ isActive }) =>
        ["nav-panel-button", extraClassName, isActive && "nav-panel-button-active"].filter(Boolean).join(" ")
      }
    >
      <span className="nav-panel-button-icon" aria-hidden="true">
        {item.icon}
      </span>
      {t(item.i18nKey)}
    </NavLink>
  );
}

function NavPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <>
      <div className="nav-panel-backdrop" onClick={onClose} />
      <nav className="nav-panel" aria-label="Main navigation">
        <button type="button" className="nav-panel-close" onClick={onClose} aria-label="Close menu">
          ×
        </button>
        <div className="nav-panel-group">
          <span className="nav-group-label">{t("nav.group.tickets")}</span>
          {TICKETS_NAV_ITEMS.map((item) => (
            <NavPanelButton key={item.to} item={item} onClick={onClose} />
          ))}
        </div>
        <div className="nav-panel-group">
          <span className="nav-group-label">{t("nav.group.monitoring")}</span>
          {MONITORING_NAV_ITEMS.map((item) => (
            <NavPanelButton key={item.to} item={item} onClick={onClose} />
          ))}
        </div>
        <div className="nav-panel-group">
          <span className="nav-group-label">{t("nav.group.cost")}</span>
          {COST_NAV_ITEMS.map((item) => (
            <NavPanelButton key={item.to} item={item} onClick={onClose} />
          ))}
        </div>
        <div className="nav-panel-group">
          <NavPanelButton item={{ i18nKey: "nav.admin", to: "/admin", icon: "⚙️" }} extraClassName="nav-admin-button" onClick={onClose} />
        </div>
      </nav>
    </>
  );
}

function App() {
  const { tenantId, setTenantId } = useTenant();
  const { user } = useAuth();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Cloud Ops Tool</h1>
        <HeaderSearch />
        <label className="tenant-input" title={user ? "Log out to switch tenants — while logged in, requests use the tenant from your login, not this field" : undefined}>
          X-Tenant-Id
          <input
            placeholder="Paste tenant UUID"
            value={tenantId}
            disabled={!!user}
            onChange={(e) => setTenantId(e.target.value.trim())}
          />
        </label>
        <LanguageSelect />
        <HeaderAuth />
        <button
          type="button"
          className="nav-toggle"
          aria-label="Open menu"
          aria-expanded={navOpen}
          onClick={() => setNavOpen(true)}
        >
          ☰
        </button>
      </header>

      <NavPanel open={navOpen} onClose={() => setNavOpen(false)} />

      <NeedsAttentionBanner />

      <main>
        <Routes>
          <Route path="/" element={<TicketListPage />} />
          <Route path="/tickets/new" element={<NewTicketPage />} />
          <Route path="/tickets/:id" element={<TicketDetailPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/knowledge-base" element={<KnowledgeBasePage />} />
          <Route path="/monitoring" element={<MonitoringFleetPage />} />
          <Route path="/monitoring/dashboard" element={<MonitoringDashboardPage />} />
          <Route path="/monitoring/resources/:id" element={<ResourceDashboardPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/cost" element={<CostRollupPage />} />
          <Route path="/cost/dashboard" element={<CostDashboardPage />} />
          <Route path="/cost/accounts/:id" element={<CostAccountDetailPage />} />
          <Route path="/cost/recommendations" element={<RecommendationsPage />} />
          <Route path="/cost/savings" element={<SavingsLogPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/compose" element={<ComposeOutboundPage />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
