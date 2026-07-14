import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ApiError,
  createAutomationRule,
  deleteAutomationRule,
  listAgents,
  listAutomationRules,
  listGroups,
  updateAutomationRule,
} from "../../lib/apiClient";
import type {
  Agent,
  AutomationActionType,
  AutomationConditionField,
  AutomationConditionOperator,
  AutomationRule,
  AutomationTrigger,
  Group,
} from "../../types/ticket";

const TRIGGERS: AutomationTrigger[] = ["ticket_created", "ticket_updated"];
const FIELDS: AutomationConditionField[] = ["status", "priority", "source", "subject", "ticket_type_id", "group_id"];
const OPERATORS: AutomationConditionOperator[] = ["equals", "contains"];
const ACTION_TYPES: AutomationActionType[] = ["set_status", "set_priority", "set_group", "set_agent", "add_note"];
const STATUS_VALUES = ["new", "open", "pending", "resolved", "closed"];
const PRIORITY_VALUES = ["low", "medium", "high", "urgent"];

export default function AutomationRulesAdmin({
  tenantId,
  onChange,
  refreshSignal,
}: {
  tenantId: string;
  onChange?: () => void;
  refreshSignal?: number;
}) {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<AutomationTrigger>("ticket_created");
  const [conditionField, setConditionField] = useState<AutomationConditionField>("status");
  const [conditionOperator, setConditionOperator] = useState<AutomationConditionOperator>("equals");
  const [conditionValue, setConditionValue] = useState("");
  const [actionType, setActionType] = useState<AutomationActionType>("set_status");
  const [actionValue, setActionValue] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    Promise.all([listAutomationRules(tenantId), listGroups(tenantId), listAgents(tenantId)]).then(
      ([rulesRes, groupsRes, agentsRes]) => {
        setRules(rulesRes);
        setGroups(groupsRes);
        setAgents(agentsRes);
      },
    );
  };

  useEffect(load, [tenantId, refreshSignal]);

  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? id;
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;

  const describeCondition = (c: AutomationRule["conditions"][number]) => `${c.field} ${c.operator} "${c.value}"`;
  const describeAction = (a: AutomationRule["actions"][number]) => {
    if (a.type === "set_group") return `set group to ${groupName(a.value)}`;
    if (a.type === "set_agent") return `set agent to ${agentName(a.value)}`;
    if (a.type === "add_note") return `add note "${a.value}"`;
    return `${a.type.replace("set_", "set ")} to ${a.value}`;
  };

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !conditionValue.trim() || !actionValue.trim()) return;
    setBusy(true);
    setError(null);
    createAutomationRule(tenantId, {
      name,
      trigger,
      conditions: [{ field: conditionField, operator: conditionOperator, value: conditionValue }],
      actions: [{ type: actionType, value: actionValue }],
    })
      .then(() => {
        setName("");
        setConditionValue("");
        setActionValue("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create automation rule"))
      .finally(() => setBusy(false));
  };

  const handleToggleActive = (rule: AutomationRule) => {
    setError(null);
    updateAutomationRule(tenantId, rule.id, { isActive: !rule.is_active })
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to update automation rule"));
  };

  const handleDelete = (rule: AutomationRule) => {
    setError(null);
    deleteAutomationRule(tenantId, rule.id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete automation rule"));
  };

  const renderActionValueInput = () => {
    if (actionType === "set_status") {
      return (
        <select value={actionValue} onChange={(e) => setActionValue(e.target.value)} required>
          <option value="">Select status</option>
          {STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      );
    }
    if (actionType === "set_priority") {
      return (
        <select value={actionValue} onChange={(e) => setActionValue(e.target.value)} required>
          <option value="">Select priority</option>
          {PRIORITY_VALUES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      );
    }
    if (actionType === "set_group") {
      return (
        <select value={actionValue} onChange={(e) => setActionValue(e.target.value)} required>
          <option value="">Select group</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      );
    }
    if (actionType === "set_agent") {
      return (
        <select value={actionValue} onChange={(e) => setActionValue(e.target.value)} required>
          <option value="">Select agent</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      );
    }
    return <input placeholder="Note text" value={actionValue} onChange={(e) => setActionValue(e.target.value)} required />;
  };

  return (
    <div className="admin-entity">
      <h4>Automation rules</h4>
      {error && <p className="error">{error}</p>}
      {rules.length === 0 && <p className="hint">No automation rules yet.</p>}
      {rules.length > 0 && (
        <ul className="admin-list">
          {rules.map((rule) => (
            <li key={rule.id}>
              <span>
                <strong>{rule.name}</strong>{" "}
                <span className={`badge ${rule.is_active ? "status-resolved" : ""}`}>
                  {rule.is_active ? "active" : "inactive"}
                </span>
                <br />
                <span className="hint">
                  on {rule.trigger}: if {rule.conditions.map(describeCondition).join(" and ")} then{" "}
                  {rule.actions.map(describeAction).join(", ")}
                </span>
              </span>
              <span>
                <button type="button" className="link-button" onClick={() => handleToggleActive(rule)}>
                  {rule.is_active ? "Deactivate" : "Activate"}
                </button>
                <button type="button" className="link-button" onClick={() => handleDelete(rule)}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleCreate}>
        <input placeholder="Rule name" value={name} onChange={(e) => setName(e.target.value)} required />
        <select value={trigger} onChange={(e) => setTrigger(e.target.value as AutomationTrigger)}>
          {TRIGGERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <div className="admin-form-row">
          <span className="hint">If</span>
          <select value={conditionField} onChange={(e) => setConditionField(e.target.value as AutomationConditionField)}>
            {FIELDS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <select value={conditionOperator} onChange={(e) => setConditionOperator(e.target.value as AutomationConditionOperator)}>
            {OPERATORS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <input placeholder="Value" value={conditionValue} onChange={(e) => setConditionValue(e.target.value)} required />
        </div>
        <div className="admin-form-row">
          <span className="hint">Then</span>
          <select
            value={actionType}
            onChange={(e) => {
              setActionType(e.target.value as AutomationActionType);
              setActionValue("");
            }}
          >
            {ACTION_TYPES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          {renderActionValueInput()}
        </div>
        <button type="submit" disabled={busy}>
          Add automation rule
        </button>
      </form>
    </div>
  );
}
