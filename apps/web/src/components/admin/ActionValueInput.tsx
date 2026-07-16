import { platformLabel, PLATFORMS } from "../../lib/platform";
import type { Agent, AutomationActionType, Group } from "../../types/ticket";

export const ACTION_TYPES: AutomationActionType[] = [
  "set_status",
  "set_priority",
  "set_group",
  "set_agent",
  "set_platform",
  "add_note",
  "add_tag",
];
const STATUS_VALUES = ["new", "open", "pending", "resolved", "closed"];
const PRIORITY_VALUES = ["low", "medium", "high", "urgent"];

/** Shared by AutomationRulesAdmin and ScenariosAdmin -- same action shape, per the spec's scenarios doc comment. */
export default function ActionValueInput({
  actionType,
  value,
  onChange,
  groups,
  agents,
}: {
  actionType: AutomationActionType;
  value: string;
  onChange: (value: string) => void;
  groups: Group[];
  agents: Agent[];
}) {
  if (actionType === "set_status") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} required>
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
      <select value={value} onChange={(e) => onChange(e.target.value)} required>
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
      <select value={value} onChange={(e) => onChange(e.target.value)} required>
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
      <select value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Select agent</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    );
  }
  if (actionType === "set_platform") {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} required>
        <option value="">Select platform</option>
        {PLATFORMS.map((p) => (
          <option key={p} value={p}>
            {platformLabel(p)}
          </option>
        ))}
      </select>
    );
  }
  const placeholder = actionType === "add_tag" ? "Tag" : "Note text";
  return <input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} required />;
}
