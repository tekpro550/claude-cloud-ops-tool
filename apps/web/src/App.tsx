import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Route, Routes, useNavigate } from "react-router-dom";
import "./App.css";
import NeedsAttentionBanner from "./components/NeedsAttentionBanner";
import { ApiError } from "./lib/apiClient";
import { useAuth } from "./lib/auth";
import { useTenant } from "./lib/tenant";
import AdminPage from "./pages/AdminPage";
import CompaniesPage from "./pages/CompaniesPage";
import ComposeOutboundPage from "./pages/ComposeOutboundPage";
import ContactsPage from "./pages/ContactsPage";
import DashboardPage from "./pages/DashboardPage";
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

function App() {
  const { tenantId, setTenantId } = useTenant();

  return (
    <div className="app">
      <header className="app-header">
        <h1>Cloud Ops Tool — Tickets</h1>
        <nav className="app-nav">
          <Link to="/">Tickets</Link>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/contacts">Contacts</Link>
          <Link to="/companies">Companies</Link>
          <Link to="/compose">Compose email</Link>
          <Link to="/admin">Admin</Link>
        </nav>
        <HeaderSearch />
        <label className="tenant-input">
          X-Tenant-Id
          <input
            placeholder="Paste tenant UUID"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value.trim())}
          />
        </label>
        <HeaderAuth />
      </header>

      <NeedsAttentionBanner />

      <main>
        <Routes>
          <Route path="/" element={<TicketListPage />} />
          <Route path="/tickets/:id" element={<TicketDetailPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
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
