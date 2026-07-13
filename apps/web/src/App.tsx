import { Route, Routes } from "react-router-dom";
import "./App.css";
import { useTenant } from "./lib/tenant";
import TicketDetailPage from "./pages/TicketDetailPage";
import TicketListPage from "./pages/TicketListPage";

function App() {
  const { tenantId, setTenantId } = useTenant();

  return (
    <div className="app">
      <header className="app-header">
        <h1>Cloud Ops Tool — Tickets</h1>
        <label className="tenant-input">
          X-Tenant-Id
          <input
            placeholder="Paste tenant UUID"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value.trim())}
          />
        </label>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<TicketListPage />} />
          <Route path="/tickets/:id" element={<TicketDetailPage />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
