import { useEffect, useState } from "react";
import AgentsAdmin from "../components/admin/AgentsAdmin";
import AgentTokensAdmin from "../components/admin/AgentTokensAdmin";
import AlertRulesAdmin from "../components/admin/AlertRulesAdmin";
import AutomationRulesAdmin from "../components/admin/AutomationRulesAdmin";
import CannedResponseFoldersAdmin from "../components/admin/CannedResponseFoldersAdmin";
import CannedResponsesAdmin from "../components/admin/CannedResponsesAdmin";
import CloudCredentialsAdmin from "../components/admin/CloudCredentialsAdmin";
import EscalationPoliciesAdmin from "../components/admin/EscalationPoliciesAdmin";
import GroupsAdmin from "../components/admin/GroupsAdmin";
import NotificationTemplatesAdmin from "../components/admin/NotificationTemplatesAdmin";
import OnCallSchedulesAdmin from "../components/admin/OnCallSchedulesAdmin";
import ResourcesAdmin from "../components/admin/ResourcesAdmin";
import ScenariosAdmin from "../components/admin/ScenariosAdmin";
import SlaPoliciesAdmin from "../components/admin/SlaPoliciesAdmin";
import SolutionsAdmin from "../components/admin/SolutionsAdmin";
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
        <ScenariosAdmin tenantId={tenantId} onChange={handleChange} />
        <CannedResponseFoldersAdmin tenantId={tenantId} onChange={handleChange} />
        <CannedResponsesAdmin tenantId={tenantId} onChange={handleChange} refreshSignal={refreshSignal} />
      </section>

      <section className="admin-group">
        <h3>Knowledge base</h3>
        <SolutionsAdmin tenantId={tenantId} onChange={handleChange} />
      </section>

      <section className="admin-group">
        <h3>Monitoring</h3>
        <ResourcesAdmin tenantId={tenantId} onChange={handleChange} />
        <AlertRulesAdmin tenantId={tenantId} onChange={handleChange} />
        <AgentTokensAdmin tenantId={tenantId} onChange={handleChange} />
        <CloudCredentialsAdmin tenantId={tenantId} onChange={handleChange} />
        <EscalationPoliciesAdmin tenantId={tenantId} onChange={handleChange} />
        <OnCallSchedulesAdmin tenantId={tenantId} onChange={handleChange} />
        <NotificationTemplatesAdmin tenantId={tenantId} onChange={handleChange} />
      </section>
    </div>
  );
}
