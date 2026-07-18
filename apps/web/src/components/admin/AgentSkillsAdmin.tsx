import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, addAgentSkill, listAgents, listAgentSkills, removeAgentSkill } from "../../lib/apiClient";
import type { Agent } from "../../types/ticket";
import { useConfirm } from "../useConfirm";

// Skills feed skill_based group auto-assignment: a ticket carrying
// requiredSkill only routes to an agent who has that skill here.
export default function AgentSkillsAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<{ id: string; agent_id: string; skill: string }[]>([]);
  const [agentId, setAgentId] = useState("");
  const [skill, setSkill] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const load = () => {
    listAgents(tenantId).then(setAgents);
    listAgentSkills(tenantId).then(setSkills);
  };

  useEffect(load, [tenantId]);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;

  const handleAdd = (event: FormEvent) => {
    event.preventDefault();
    if (!agentId || !skill.trim()) return;
    setBusy(true);
    setError(null);
    addAgentSkill(tenantId, { agentId, skill: skill.trim() })
      .then(() => {
        setSkill("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to add skill"))
      .finally(() => setBusy(false));
  };

  const handleRemove = (id: string, label: string) => {
    setError(null);
    removeAgentSkill(tenantId, id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : `Failed to remove ${label}`));
  };

  return (
    <div className="admin-entity">
      <h4>Agent skills</h4>
      <p className="hint">Tags an agent can be matched on by a group using the skill-based assignment strategy.</p>
      {error && <p className="error">{error}</p>}
      {skills.length === 0 && <p className="hint">No skills assigned yet.</p>}
      {skills.length > 0 && (
        <ul className="admin-list">
          {skills.map((s) => (
            <li key={s.id}>
              <span>
                <strong>{s.skill}</strong> <span className="hint">— {agentName(s.agent_id)}</span>
              </span>
              <span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    confirm({
                      title: "Remove skill",
                      message: `Remove “${s.skill}” from ${agentName(s.agent_id)}?`,
                      onConfirm: () => handleRemove(s.id, s.skill),
                    })
                  }
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleAdd}>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} required>
          <option value="" disabled>
            Agent…
          </option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input placeholder="Skill (e.g. billing)" value={skill} onChange={(e) => setSkill(e.target.value)} required />
        <button type="submit" disabled={busy}>
          Add skill
        </button>
      </form>
      {confirmDialog}
    </div>
  );
}
