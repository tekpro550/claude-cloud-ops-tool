import { Link, Route, Routes } from "react-router-dom";
import "./App.css";
import NeedsAttentionBanner from "./components/NeedsAttentionBanner";
import { useTenant } from "./lib/tenant";
import AdminPage from "./pages/AdminPage";
import CompaniesPage from "./pages/CompaniesPage";
import ContactsPage from "./pages/ContactsPage";
import DashboardPage from "./pages/DashboardPage";
import TicketDetailPage from "./pages/TicketDetailPage";
import TicketListPage from "./pages/TicketListPage";

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
          <Link to="/admin">Admin</Link>
        </nav>
        <label className="tenant-input">
          X-Tenant-Id
          <input
            placeholder="Paste tenant UUID"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value.trim())}
          />
        </label>
      </header>

      <NeedsAttentionBanner />

      <main>
        <Routes>
          <Route path="/" element={<TicketListPage />} />
          <Route path="/tickets/:id" element={<TicketDetailPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/companies" element={<CompaniesPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
