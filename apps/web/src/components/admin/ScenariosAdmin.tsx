import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ApiError,
  createScenario,
  deleteScenario,
  listAgents,
  listGroups,
  listScenarios,
  updateScenario,
} from "../../lib/apiClient";
import { platformLabel, PLATFORMS } from "../../lib/platform";
import type { Agent, AutomationActionType, Group, Scenario } from "../../types/ticket";
import ActionValueInput, { ACTION_TYPES } from "./ActionValueInput";
import { useConfirm } from "../useConfirm";

export default function ScenariosAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  const [name, setName] = useState("");
  const [actionType, setActionType] = useState<AutomationActionType>("set_status");
  const [actionValue, setActionValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editActionType, setEditActionType] = useState<AutomationActionType>("set_status");
  const [editActionValue, setEditActionValue] = useState("");

  const load = () => {
    Promise.all([listScenarios(tenantId), listGroups(tenantId), listAgents(tenantId)]).then(
      ([scenariosRes, groupsRes, agentsRes]) => {
        setScenarios(scenariosRes);
        setGroups(groupsRes);
        setAgents(agentsRes);
      },
    );
  };

  useEffect(load, [tenantId]);

  const groupName = (id: string) => groups.find((g) => g.id === id)?.name ?? id;
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const describeAction = (a: Scenario["actions"][number]) => {
    if (a.type === "set_group") return `set group to ${groupName(a.value)}`;
    if (a.type === "set_agent") return `set agent to ${agentName(a.value)}`;
    if (a.type === "set_platform") return `set platform to ${platformLabel(a.value as (typeof PLATFORMS)[number])}`;
    if (a.type === "add_note") return `add note "${a.value}"`;
    return `${a.type.replace("set_", "set ")} to ${a.value}`;
  };

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !actionValue.trim()) return;
    setBusy(true);
    setError(null);
    createScenario(tenantId, { name, actions: [{ type: actionType, value: actionValue }] })
      .then(() => {
        setName("");
        setActionValue("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create scenario"))
      .finally(() => setBusy(false));
  };

  const handleDelete = (scenario: Scenario) => {
    setError(null);
    deleteScenario(tenantId, scenario.id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete scenario"));
  };

  const startEdit = (scenario: Scenario) => {
    setEditingId(scenario.id);
    setEditName(scenario.name);
    const action = scenario.actions[0];
    setEditActionType(action?.type ?? "set_status");
    setEditActionValue(action?.value ?? "");
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = (id: string) => {
    if (!editName.trim() || !editActionValue.trim()) return;
    setError(null);
    updateScenario(tenantId, id, { name: editName, actions: [{ type: editActionType, value: editActionValue }] })
      .then(() => {
        setEditingId(null);
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to update scenario"));
  };

  return (
    <div className="admin-entity">
      <h4>Scenarios</h4>
      <p className="hint">One-click macros agents can run on a ticket instead of setting each property by hand.</p>
      {error && <p className="error">{error}</p>}
      {scenarios.length === 0 && <p className="hint">No scenarios yet.</p>}
      {scenarios.length > 0 && (
        <ul className="admin-list">
          {scenarios.map((s) =>
            editingId === s.id ? (
              <li key={s.id}>
                <span className="admin-form">
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} />
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
                </span>
                <span>
                  <button type="button" className="link-button" onClick={() => saveEdit(s.id)}>
                    Save
                  </button>
                  <button type="button" className="link-button" onClick={cancelEdit}>
                    Cancel
                  </button>
                </span>
              </li>
            ) : (
              <li key={s.id}>
                <span>
                  <strong>{s.name}</strong>{" "}
                  <span className="hint">{s.actions.map(describeAction).join(", ")}</span>
                </span>
                <span>
                  <button type="button" className="link-button" onClick={() => startEdit(s)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() =>
                      confirm({
                        title: "Delete scenario",
                        message: `Delete the scenario “${s.name}”? This can't be undone.`,
                        onConfirm: () => handleDelete(s),
                      })
                    }
                  >
                    Delete
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleCreate}>
        <input placeholder="Scenario name" value={name} onChange={(e) => setName(e.target.value)} required />
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
        <button type="submit" disabled={busy}>
          Add scenario
        </button>
      </form>
      {confirmDialog}
    </div>
  );
}
