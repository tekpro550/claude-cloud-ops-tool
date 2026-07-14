import { useEffect, useState } from "react";
import AgentsAdmin from "../components/admin/AgentsAdmin";
import AutomationRulesAdmin from "../components/admin/AutomationRulesAdmin";
import CannedResponsesAdmin from "../components/admin/CannedResponsesAdmin";
import GroupsAdmin from "../components/admin/GroupsAdmin";
import SlaPoliciesAdmin from "../components/admin/SlaPoliciesAdmin";
import TicketTypesAdmin from "../components/admin/TicketTypesAdmin";
import { getSetupStatus } from "../lib/apiClient";
import { useTenant } from "../lib/tenant";
import type { SetupStatus } from "../types/ticket";

export default function AdminPage() {
  const { tenantId } = useTenant();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);

  const loadStatus = () => {
    if (!tenantId) return;
    getSetupStatus(tenantId).then(setStatus);
  };

  const handleChange = () => {
    loadStatus();
    setRefreshSignal((s) => s + 1);
  };

  useEffect(loadStatus, [tenantId]);

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to view admin settings.</p>;
  }

  return (
    <div>
      <h2>Admin settings</h2>
      {status && (
        <>
          <p className="hint">
            Setup {status.complete ? "complete" : `${status.completedCount} of ${status.totalCount} steps complete`}
          </p>
          <ul className="setup-checklist">
            {status.items.map((item) => (
              <li key={item.key} className={item.complete ? "setup-complete" : "setup-incomplete"}>
                <span className="setup-icon" aria-hidden="true">
                  {item.complete ? "✓" : "○"}
                </span>
                {item.label}
                {item.count > 0 && <span className="hint"> ({item.count})</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      <section className="admin-group">
        <h3>Team</h3>
        <GroupsAdmin tenantId={tenantId} onChange={handleChange} />
        <AgentsAdmin tenantId={tenantId} onChange={handleChange} />
      </section>

      <section className="admin-group">
        <h3>Support Operations</h3>
        <TicketTypesAdmin tenantId={tenantId} onChange={handleChange} refreshSignal={refreshSignal} />
        <SlaPoliciesAdmin tenantId={tenantId} onChange={handleChange} />
      </section>

      <section className="admin-group">
        <h3>Workflows</h3>
        <AutomationRulesAdmin tenantId={tenantId} onChange={handleChange} refreshSignal={refreshSignal} />
        <CannedResponsesAdmin tenantId={tenantId} onChange={handleChange} />
      </section>
    </div>
  );
}
