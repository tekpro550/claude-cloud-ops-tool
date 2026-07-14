import type { ReactNode } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import { useAuth } from "./lib/auth";
import { useTenant } from "./lib/tenant";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import SolutionDetailPage from "./pages/SolutionDetailPage";
import SolutionsPage from "./pages/SolutionsPage";
import SubmitTicketPage from "./pages/SubmitTicketPage";
import TicketDetailPage from "./pages/TicketDetailPage";
import TicketListPage from "./pages/TicketListPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { contact } = useAuth();
  if (!contact) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function App() {
  const { tenantId, setTenantId } = useTenant();
  const { contact, logout } = useAuth();

  return (
    <div className="portal-app">
      <header className="portal-header">
        <Link to="/" className="portal-logo">
          Support
        </Link>
        <nav className="portal-nav">
          <Link to="/submit">Submit a ticket</Link>
          <Link to="/solutions">Solutions</Link>
          {contact ? (
            <>
              <Link to="/tickets">My tickets</Link>
              <span className="hint">{contact.name}</span>
              <button type="button" onClick={logout}>
                Log out
              </button>
            </>
          ) : (
            <>
              <Link to="/login">Log in</Link>
              <Link to="/register">Sign up</Link>
            </>
          )}
        </nav>
        {!import.meta.env.VITE_DEFAULT_TENANT_ID && (
          <label className="tenant-input">
            Tenant
            <input
              placeholder="Paste tenant UUID"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value.trim())}
            />
          </label>
        )}
      </header>

      <main className="portal-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/submit" element={<SubmitTicketPage />} />
          <Route path="/solutions" element={<SolutionsPage />} />
          <Route path="/solutions/:id" element={<SolutionDetailPage />} />
          <Route
            path="/tickets"
            element={
              <RequireAuth>
                <TicketListPage />
              </RequireAuth>
            }
          />
          <Route
            path="/tickets/:id"
            element={
              <RequireAuth>
                <TicketDetailPage />
              </RequireAuth>
            }
          />
        </Routes>
      </main>
    </div>
  );
}

export default App;
