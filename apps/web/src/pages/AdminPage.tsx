import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Modal from "../components/Modal";
import AgentsAdmin from "../components/admin/AgentsAdmin";
import AiSettingsAdmin from "../components/admin/AiSettingsAdmin";
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
import SsoConfigAdmin from "../components/admin/SsoConfigAdmin";
import TwoFactorAdmin from "../components/admin/TwoFactorAdmin";
import TenantCostSettingsAdmin from "../components/admin/TenantCostSettingsAdmin";
import TicketTypesAdmin from "../components/admin/TicketTypesAdmin";
import { getSetupStatus } from "../lib/apiClient";
import { useTenant } from "../lib/tenant";
import type { SetupStatus } from "../types/ticket";

type AdminModule = "ticket" | "monitor" | "cost";

/** Props every setting editor is invoked with; each render() picks the ones its component accepts. */
interface SettingRenderProps {
  tenantId: string;
  onChange: () => void;
  refreshSignal: number;
}

interface SettingDef {
  key: string;
  label: string;
  description: string;
  icon: string;
  render: (props: SettingRenderProps) => ReactNode;
}

interface SettingGroup {
  heading: string;
  items: SettingDef[];
}

const MODULES: { key: AdminModule; label: string; icon: string; description: string }[] = [
  { key: "ticket", label: "Ticket admin", icon: "🎫", description: "Team, SLAs, workflows and the knowledge base" },
  { key: "monitor", label: "Monitor admin", icon: "📡", description: "Resources, alerts, escalations and on-call" },
  { key: "cost", label: "Cost admin", icon: "💰", description: "Budgets and cost tracking settings" },
];

// Each module's settings, grouped by heading. Rendering the actual editor is a
// closure so every component receives exactly the props its signature accepts
// (only some take refreshSignal; the audit log takes no onChange).
const SETTINGS: Record<AdminModule, SettingGroup[]> = {
  ticket: [
    {
      heading: "Team",
      items: [
        { key: "groups", label: "Groups", description: "Support teams tickets are routed to", icon: "👥", render: (p) => <GroupsAdmin tenantId={p.tenantId} onChange={p.onChange} /> },
        { key: "agents", label: "Agents", description: "People who work tickets and their roles", icon: "🧑‍💼", render: (p) => <AgentsAdmin tenantId={p.tenantId} onChange={p.onChange} /> },
      ],
    },
    {
      heading: "Support operations",
      items: [
        { key: "ticket-types", label: "Ticket types", description: "Categories with default group and SLA", icon: "🏷️", render: (p) => <TicketTypesAdmin tenantId={p.tenantId} onChange={p.onChange} refreshSignal={p.refreshSignal} /> },
        { key: "sla-policies", label: "SLA policies", description: "First-response and resolution targets", icon: "⏱️", render: (p) => <SlaPoliciesAdmin tenantId={p.tenantId} onChange={p.onChange} /> },
        { key: "business-hours", label: "Business hours", description: "Working window SLA clocks respect", icon: "🕐", render: (p) => <BusinessHoursAdmin tenantId={p.tenantId} onChange={p.onChange} /> },
        { key: "custom-fields", label: "Custom fields", description: "Extra fields captured on tickets", icon: "🧩", render: (p) => <CustomFieldsAdmin tenantId={p.tenantId} onChange={p.onChange} /> },
      ],
    },
    {
      heading: "Workflows",
      items: [
        { key: "automation-rules", label: "Automation rules", description: "Trigger-based actions on tickets", icon: "⚙️", render: (p) => <AutomationRulesAdmin tenantId={p.tenantId} onChange={p.onChange} refreshSignal={p.refreshSignal} /> },
        { key: "scenarios", label: "Scenarios", description: "One-click macros agents can apply", icon: "🎬", render: (p) => <ScenariosAdmin tenantId={p.tenantId} onChange={p.onChange} /> },
        { key: "canned-folders", label: "Canned response folders", description: "Organize reusable replies", icon: "🗂️", render: (p) => <CannedResponseFoldersAdmin tenantId={p.tenantId} onChange={p.onChange} /> },
        { key: "canned-responses", label: "Canned responses", description: "Reusable reply templates", icon: "💬", render: (p) => <CannedResponsesAdmin tenantId={p.tenantId} onChange={p.onChange} refreshSignal={p.refreshSignal} /> },
      ],
    },
    {
      heading: "Knowledge base",
      items: [
        { key: "solutions", label: "Solutions", description: "Help articles for agents and the portal", icon: "📚", render: (p) => <SolutionsAdmin tenantId={p.tenantId} onChange={p.onChange} /> },
      ],
    },
    {
      heading: "AI assist",
      items: [
        { key: "ai-settings", label: "AI provider", description: "Model + API key for summaries and suggested replies", icon: "🤖", render: (p) => <AiSettingsAdmin tenantId={p.tenantId} onChange={p.onChange} /> },
      ],
    },
  ],
  monitor: [
    {
      heading: "Monitoring",
      items: [
        { key: "resources", label: "Resources", description: "Servers and services being monitored", icon: "🖥️", render: (p) => <ResourcesAdmin tenantId={p.tenantId} onChange={p.onChange} /> },
        { key: "alert-rules", label: "Alert rules", description: "Thresholds that raise alerts", icon: "🔔", render: (p) => <AlertRulesAdmin tenantId={p.tenantId} onChange={p.onChange} /> },
        { key: "agent-tokens", label: "Agent tokens", description: "Device tokens for the server agent", icon: "🔑", render: (p) => <AgentTokensAdmin tenantId={p.tenantId} onChange={p.onChange} /> },
        { key: "cloud-credentials", label: "Cloud credentials", description: "AWS / Azure keys for polling", icon: "☁️", render: (p) => <CloudCredentialsAdmin tenantId={p.tenantId} onChange={p.onChange} /> },
        { key: "escalation-policies", label: "Escalation policies", description: "Who gets paged and when", icon: "📣", render: (p) => <EscalationPoliciesAdmin tenantId={p.tenantId} onChange={p.onChange} /> },
        { key: "on-call", label: "On-call schedules", description: "Rotations for escalation targets", icon: "📅", render: (p) => <OnCallSchedulesAdmin tenantId={p.tenantId} onChange={p.onChange} /> },
        { key: "notification-templates", label: "Notification templates", description: "Message bodies for alert channels", icon: "✉️", render: (p) => <NotificationTemplatesAdmin tenantId={p.tenantId} onChange={p.onChange} /> },
      ],
    },
  ],
  cost: [
    {
      heading: "Cost",
      items: [
        { key: "budgets", label: "Budgets", description: "Spend limits and pace alerting", icon: "💵", render: (p) => <CostBudgetsAdmin tenantId={p.tenantId} onChange={p.onChange} /> },
        { key: "cost-settings", label: "Cost settings", description: "Currency and tracking preferences", icon: "🧾", render: (p) => <TenantCostSettingsAdmin tenantId={p.tenantId} onChange={p.onChange} /> },
      ],
    },
  ],
};

// Shown regardless of the active module, same as before.
const SECURITY_GROUP: SettingGroup = {
  heading: "Security & audit",
  items: [
    { key: "two-factor", label: "Two-factor auth", description: "Add a TOTP code to your own sign-in", icon: "🔐", render: (p) => <TwoFactorAdmin tenantId={p.tenantId} onChange={p.onChange} /> },
    { key: "sso", label: "Single sign-on", description: "Connect an OIDC identity provider", icon: "🪪", render: (p) => <SsoConfigAdmin tenantId={p.tenantId} onChange={p.onChange} /> },
    { key: "audit-log", label: "Audit log", description: "History of admin configuration changes", icon: "📜", render: (p) => <AuditLogAdmin tenantId={p.tenantId} refreshSignal={p.refreshSignal} /> },
  ],
};

export default function AdminPage() {
  const { tenantId } = useTenant();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [activeModule, setActiveModule] = useState<AdminModule>("ticket");
  const [openSetting, setOpenSetting] = useState<SettingDef | null>(null);

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

  const groups = [...SETTINGS[activeModule], SECURITY_GROUP];

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

      {groups.map((group) => (
        <section className="admin-group" key={group.heading}>
          <h3>{group.heading}</h3>
          <div className="admin-settings-grid">
            {group.items.map((setting) => (
              <button
                key={setting.key}
                type="button"
                className="admin-setting-card"
                onClick={() => setOpenSetting(setting)}
              >
                <span className="admin-setting-card-icon" aria-hidden="true">
                  {setting.icon}
                </span>
                <span className="admin-setting-card-label">{setting.label}</span>
                <span className="admin-setting-card-desc">{setting.description}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {openSetting && (
        <Modal title={openSetting.label} onClose={() => setOpenSetting(null)}>
          {openSetting.render({ tenantId, onChange: handleChange, refreshSignal })}
        </Modal>
      )}
    </div>
  );
}
