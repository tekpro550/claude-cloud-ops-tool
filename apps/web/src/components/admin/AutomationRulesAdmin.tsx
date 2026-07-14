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
import { platformLabel, PLATFORMS } from "../../lib/platform";
import type {
  Agent,
  AutomationActionType,
  AutomationConditionField,
  AutomationConditionOperator,
  AutomationRule,
  AutomationTrigger,
  Group,
} from "../../types/ticket";
import ActionValueInput, { ACTION_TYPES } from "./ActionValueInput";

const TRIGGERS: AutomationTrigger[] = ["ticket_created", "ticket_updated"];
const FIELDS: AutomationConditionField[] = [
  "status",
  "priority",
  "source",
  "subject",
  "ticket_type_id",
  "group_id",
  "platform",
];
const OPERATORS: AutomationConditionOperator[] = ["equals", "contains"];

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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTrigger, setEditTrigger] = useState<AutomationTrigger>("ticket_created");
  const [editConditionField, setEditConditionField] = useState<AutomationConditionField>("status");
  const [editConditionOperator, setEditConditionOperator] = useState<AutomationConditionOperator>("equals");
  const [editConditionValue, setEditConditionValue] = useState("");
  const [editActionType, setEditActionType] = useState<AutomationActionType>("set_status");
  const [editActionValue, setEditActionValue] = useState("");

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
    if (a.type === "set_platform") return `set platform to ${platformLabel(a.value as (typeof PLATFORMS)[number])}`;
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

  const startEdit = (rule: AutomationRule) => {
    setEditingId(rule.id);
    setEditName(rule.name);
    setEditTrigger(rule.trigger);
    const condition = rule.conditions[0];
    setEditConditionField(condition?.field ?? "status");
    setEditConditionOperator(condition?.operator ?? "equals");
    setEditConditionValue(condition?.value ?? "");
    const action = rule.actions[0];
    setEditActionType(action?.type ?? "set_status");
    setEditActionValue(action?.value ?? "");
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = (id: string) => {
    if (!editName.trim() || !editConditionValue.trim() || !editActionValue.trim()) return;
    setError(null);
    updateAutomationRule(tenantId, id, {
      name: editName,
      trigger: editTrigger,
      conditions: [{ field: editConditionField, operator: editConditionOperator, value: editConditionValue }],
      actions: [{ type: editActionType, value: editActionValue }],
    })
      .then(() => {
        setEditingId(null);
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to update automation rule"));
  };

  return (
    <div className="admin-entity">
      <h4>Automation rules</h4>
      {error && <p className="error">{error}</p>}
      {rules.length === 0 && <p className="hint">No automation rules yet.</p>}
      {rules.length > 0 && (
        <ul className="admin-list">
          {rules.map((rule) =>
            editingId === rule.id ? (
              <li key={rule.id}>
                <span className="admin-form">
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} />
                  <select value={editTrigger} onChange={(e) => setEditTrigger(e.target.value as AutomationTrigger)}>
                    {TRIGGERS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <div className="admin-form-row">
                    <span className="hint">If</span>
                    <select
                      value={editConditionField}
                      onChange={(e) => setEditConditionField(e.target.value as AutomationConditionField)}
                    >
                      {FIELDS.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                    <select
                      value={editConditionOperator}
                      onChange={(e) => setEditConditionOperator(e.target.value as AutomationConditionOperator)}
                    >
                      {OPERATORS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                    <input
                      placeholder="Value"
                      value={editConditionValue}
                      onChange={(e) => setEditConditionValue(e.target.value)}
                    />
                  </div>
                  <div className="admin-form-row">
                    <span className="hint">Then</span>
                    <select
                      value={editActionType}
                      onChange={(e) => {
                        setEditActionType(e.target.value as AutomationActionType);
                        setEditActionValue("");
                      }}
                    >
                      {ACTION_TYPES.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                    <ActionValueInput
                      actionType={editActionType}
                      value={editActionValue}
                      onChange={setEditActionValue}
                      groups={groups}
                      agents={agents}
                    />
                  </div>
                </span>
                <span>
                  <button type="button" className="link-button" onClick={() => saveEdit(rule.id)}>
                    Save
                  </button>
                  <button type="button" className="link-button" onClick={cancelEdit}>
                    Cancel
                  </button>
                </span>
              </li>
            ) : (
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
                  <button type="button" className="link-button" onClick={() => startEdit(rule)}>
                    Edit
                  </button>
                  <button type="button" className="link-button" onClick={() => handleToggleActive(rule)}>
                    {rule.is_active ? "Deactivate" : "Activate"}
                  </button>
                  <button type="button" className="link-button" onClick={() => handleDelete(rule)}>
                    Delete
                  </button>
                </span>
              </li>
            ),
          )}
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
          <ActionValueInput actionType={actionType} value={actionValue} onChange={setActionValue} groups={groups} agents={agents} />
        </div>
        <button type="submit" disabled={busy}>
          Add automation rule
        </button>
      </form>
    </div>
  );
}
