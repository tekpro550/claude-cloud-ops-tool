import { useEffect, useState } from "react";
import { listTicketActivities } from "../lib/apiClient";
import { platformLabel } from "../lib/platform";
import { relativeTime } from "../lib/relativeTime";
import type { Agent, Group, TicketActivity, TicketPlatform, TicketType } from "../types/ticket";

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
  updatedAt,
  groups,
  agents,
  ticketTypes,
}: {
  tenantId: string;
  ticketId: string;
  updatedAt: string;
  groups: Group[];
  agents: Agent[];
  ticketTypes: TicketType[];
}) {
  const [activities, setActivities] = useState<TicketActivity[]>([]);

  // updatedAt changes every time a property change lands (see
  // tickets.service.ts update()), so this refetches whenever a new activity
  // row could exist -- otherwise the list would only ever reflect whatever
  // existed when the ticket detail page first mounted.
  useEffect(() => {
    listTicketActivities(tenantId, ticketId).then(setActivities);
  }, [tenantId, ticketId, updatedAt]);

  const resolveValue = (field: string, value: string | null) => {
    if (value === null) return "unset";
    if (field === "group_id") return groups.find((g) => g.id === value)?.name ?? value;
    if (field === "agent_id") return agents.find((a) => a.id === value)?.name ?? value;
    if (field === "ticket_type_id") return ticketTypes.find((t) => t.id === value)?.name ?? value;
    if (field === "platform") return platformLabel(value as TicketPlatform);
    return value;
  };

  if (activities.length === 0) {
    return <p className="hint">No property changes yet.</p>;
  }

  return (
    <ul className="timeline-list">
      {activities.map((activity) => (
        <li key={activity.id}>
          <span className="hint" title={new Date(activity.created_at).toLocaleString()}>
            {relativeTime(activity.created_at)}
          </span>{" "}
          <strong>{FIELD_LABELS[activity.field] ?? activity.field}</strong> changed from{" "}
          <em>{resolveValue(activity.field, activity.old_value)}</em> to{" "}
          <em>{resolveValue(activity.field, activity.new_value)}</em>
        </li>
      ))}
    </ul>
  );
}
