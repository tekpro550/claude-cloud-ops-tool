import { useState } from "react";
import type { FormEvent } from "react";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import "./App.css";
import NeedsAttentionBanner from "./components/NeedsAttentionBanner";
import { ApiError } from "./lib/apiClient";
import { useAuth } from "./lib/auth";
import { useTenant } from "./lib/tenant";
import AdminPage from "./pages/AdminPage";
import AlertsPage from "./pages/AlertsPage";
import CompaniesPage from "./pages/CompaniesPage";
import ComposeOutboundPage from "./pages/ComposeOutboundPage";
import ContactsPage from "./pages/ContactsPage";
import DashboardPage from "./pages/DashboardPage";
import MonitoringFleetPage from "./pages/MonitoringFleetPage";
import NewTicketPage from "./pages/NewTicketPage";
import ResourceDashboardPage from "./pages/ResourceDashboardPage";
import SearchPage from "./pages/SearchPage";
import TicketDetailPage from "./pages/TicketDetailPage";
import TicketListPage from "./pages/TicketListPage";

function HeaderSearch() {
  const [q, setQ] = useState("");
  const navigate = useNavigate();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!q.trim()) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  return (
    <form className="header-search" onSubmit={handleSubmit}>
      <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
    </form>
  );
}

function HeaderAuth() {
  const { tenantId } = useTenant();
  const { user, login, logout } = useAuth();
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
          Log out
        </button>
      </div>
    );
  }

  if (!expanded) {
    return (
      <div className="header-auth">
        <button type="button" onClick={() => setExpanded(true)}>
          Log in
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
        {submitting ? "Logging in…" : "Log in"}
      </button>
      <button type="button" onClick={() => setExpanded(false)}>
        Cancel
      </button>
      {error && <span className="header-auth-error">{error}</span>}
    </form>
  );
}

type NavItem = { label: string; to: string; icon: string; end?: boolean };

const TICKETS_NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", to: "/dashboard", icon: "📊" },
  { label: "Tickets", to: "/", icon: "🎫", end: true },
  { label: "Contacts", to: "/contacts", icon: "👤" },
  { label: "Companies", to: "/companies", icon: "🏢" },
  { label: "Compose email", to: "/compose", icon: "✉️" },
];

const MONITORING_NAV_ITEMS: NavItem[] = [
  { label: "Fleet", to: "/monitoring", icon: "🖥️" },
  { label: "Alerts", to: "/alerts", icon: "🔔" },
];

function NavPanelButton({ item, extraClassName, onClick }: { item: NavItem; extraClassName?: string; onClick: () => void }) {
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
      {item.label}
    </NavLink>
  );
}

function NavPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <>
      <div className="nav-panel-backdrop" onClick={onClose} />
      <nav className="nav-panel" aria-label="Main navigation">
        <button type="button" className="nav-panel-close" onClick={onClose} aria-label="Close menu">
          ×
        </button>
        <div className="nav-panel-group">
          <span className="nav-group-label">Tickets</span>
          {TICKETS_NAV_ITEMS.map((item) => (
            <NavPanelButton key={item.to} item={item} onClick={onClose} />
          ))}
        </div>
        <div className="nav-panel-group">
          <span className="nav-group-label">Monitoring</span>
          {MONITORING_NAV_ITEMS.map((item) => (
            <NavPanelButton key={item.to} item={item} onClick={onClose} />
          ))}
        </div>
        <div className="nav-panel-group">
          <NavPanelButton item={{ label: "Admin", to: "/admin", icon: "⚙️" }} extraClassName="nav-admin-button" onClick={onClose} />
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
          <Route path="/monitoring" element={<MonitoringFleetPage />} />
          <Route path="/monitoring/resources/:id" element={<ResourceDashboardPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/compose" element={<ComposeOutboundPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
