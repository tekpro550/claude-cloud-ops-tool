import { useEffect, useState } from "react";
import AgentsAdmin from "../components/admin/AgentsAdmin";
import AgentTokensAdmin from "../components/admin/AgentTokensAdmin";
import AlertRulesAdmin from "../components/admin/AlertRulesAdmin";
import AuditLogAdmin from "../components/admin/AuditLogAdmin";
import AutomationRulesAdmin from "../components/admin/AutomationRulesAdmin";
import BusinessHoursAdmin from "../components/admin/BusinessHoursAdmin";
import CannedResponseFoldersAdmin from "../components/admin/CannedResponseFoldersAdmin";
import CannedResponsesAdmin from "../components/admin/CannedResponsesAdmin";
import CloudCredentialsAdmin from "../components/admin/CloudCredentialsAdmin";
import CostBudgetsAdmin from "../components/admin/CostBudgetsAdmin";
import CustomFieldsAdmin from "../components/admin/CustomFieldsAdmin";
import EscalationPoliciesAdmin from "../components/admin/EscalationPoliciesAdmin";
import GroupsAdmin from "../components/admin/GroupsAdmin";
import NotificationTemplatesAdmin from "../components/admin/NotificationTemplatesAdmin";
import OnCallSchedulesAdmin from "../components/admin/OnCallSchedulesAdmin";
import ResourcesAdmin from "../components/admin/ResourcesAdmin";
import ScenariosAdmin from "../components/admin/ScenariosAdmin";
import SlaPoliciesAdmin from "../components/admin/SlaPoliciesAdmin";
import SolutionsAdmin from "../components/admin/SolutionsAdmin";
import TenantCostSettingsAdmin from "../components/admin/TenantCostSettingsAdmin";
import TicketTypesAdmin from "../components/admin/TicketTypesAdmin";
import { getSetupStatus } from "../lib/apiClient";
import { useTenant } from "../lib/tenant";
import type { SetupStatus } from "../types/ticket";

type AdminModule = "ticket" | "monitor" | "cost";

const MODULES: { key: AdminModule; label: string; icon: string; description: string }[] = [
  { key: "ticket", label: "Ticket admin", icon: "🎫", description: "Team, SLAs, workflows and the knowledge base" },
  { key: "monitor", label: "Monitor admin", icon: "📡", description: "Resources, alerts, escalations and on-call" },
  { key: "cost", label: "Cost admin", icon: "💰", description: "Budgets and cost tracking settings" },
];

export default function AdminPage() {
  const { tenantId } = useTenant();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [activeModule, setActiveModule] = useState<AdminModule>("ticket");

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
      <div className="page-header">
        <h2>Admin settings</h2>
      </div>

      <div className="admin-module-tabs">
        {MODULES.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`admin-module-tab${activeModule === m.key ? " admin-module-tab-active" : ""}`}
            onClick={() => setActiveModule(m.key)}
          >
            <span className="admin-module-tab-icon" aria-hidden="true">
              {m.icon}
            </span>
            <span className="admin-module-tab-text">
              <span className="admin-module-tab-label">{m.label}</span>
              <span className="admin-module-tab-description">{m.description}</span>
            </span>
          </button>
        ))}
      </div>

      {activeModule === "ticket" && status && (
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

      {activeModule === "ticket" && (
        <>
          <section className="admin-group">
            <h3>Team</h3>
            <GroupsAdmin tenantId={tenantId} onChange={handleChange} />
            <AgentsAdmin tenantId={tenantId} onChange={handleChange} />
          </section>

          <section className="admin-group">
            <h3>Support Operations</h3>
            <TicketTypesAdmin tenantId={tenantId} onChange={handleChange} refreshSignal={refreshSignal} />
            <SlaPoliciesAdmin tenantId={tenantId} onChange={handleChange} />
            <BusinessHoursAdmin tenantId={tenantId} onChange={handleChange} />
            <CustomFieldsAdmin tenantId={tenantId} onChange={handleChange} />
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
        </>
      )}

      {activeModule === "cost" && (
        <section className="admin-group">
          <h3>Cost</h3>
          <CostBudgetsAdmin tenantId={tenantId} onChange={handleChange} />
          <TenantCostSettingsAdmin tenantId={tenantId} onChange={handleChange} />
        </section>
      )}

      {activeModule === "monitor" && (
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
      )}

      <section className="admin-group">
        <h3>Security &amp; audit</h3>
        <AuditLogAdmin tenantId={tenantId} refreshSignal={refreshSignal} />
      </section>
    </div>
  );
}
