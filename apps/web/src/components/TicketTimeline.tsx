import { useEffect, useState } from "react";
import { getTicketTimeline } from "../lib/apiClient";
import { platformLabel } from "../lib/platform";
import { relativeTime } from "../lib/relativeTime";
import type { Agent, Group, TicketPlatform, TicketTimelineItem, TicketType } from "../types/ticket";

const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  priority: "Priority",
  platform: "Platform",
  group_id: "Group",
  agent_id: "Agent",
  ticket_type_id: "Ticket type",
};

export default function TicketTimeline({
  tenantId,
  ticketId,
  refreshSignal,
  groups,
  agents,
  ticketTypes,
}: {
  tenantId: string;
  ticketId: string;
  /** Bump whenever a message, time log, or property change could have landed, to refetch. */
  refreshSignal: number;
  groups: Group[];
  agents: Agent[];
  ticketTypes: TicketType[];
}) {
  const [items, setItems] = useState<TicketTimelineItem[]>([]);

  useEffect(() => {
    getTicketTimeline(tenantId, ticketId).then(setItems);
  }, [tenantId, ticketId, refreshSignal]);

  const resolveValue = (field: string, value: string | null) => {
    if (value === null) return "unset";
    if (field === "group_id") return groups.find((g) => g.id === value)?.name ?? value;
    if (field === "agent_id") return agents.find((a) => a.id === value)?.name ?? value;
    if (field === "ticket_type_id") return ticketTypes.find((t) => t.id === value)?.name ?? value;
    if (field === "platform") return platformLabel(value as TicketPlatform);
    return value;
  };

  if (items.length === 0) {
    return <p className="hint">Nothing here yet.</p>;
  }

  return (
    <ul className="timeline-list">
      {items.map((item) => (
        <li key={`${item.kind}-${item.id}`}>
          <span className="hint" title={new Date(item.timestamp).toLocaleString()}>
            {relativeTime(item.timestamp)}
          </span>{" "}
          {item.kind === "activity" && (
            <>
              <strong>{FIELD_LABELS[item.field] ?? item.field}</strong> changed from{" "}
              <em>{resolveValue(item.field, item.old_value)}</em> to <em>{resolveValue(item.field, item.new_value)}</em>
            </>
          )}
          {item.kind === "message" && (
            <>
              <strong className="hint">{item.type}</strong> by {item.author_type}: {item.body.slice(0, 120)}
              {item.body.length > 120 ? "…" : ""}
            </>
          )}
          {item.kind === "time_log" && (
            <>
              logged <strong>{item.minutes} min</strong>
              {item.note ? ` — ${item.note}` : ""}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
