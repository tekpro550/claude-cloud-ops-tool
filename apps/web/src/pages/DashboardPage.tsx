import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import TrendsChart from "../components/TrendsChart";
import {
  getDashboardActivity,
  getDashboardSlaSummary,
  getDashboardSummary,
  getDashboardTrends,
  listAgents,
  listGroups,
  listTicketTypes,
} from "../lib/apiClient";
import { relativeTime } from "../lib/relativeTime";
import { useTenant } from "../lib/tenant";
import type {
  Agent,
  DashboardActivityItem,
  DashboardSlaSummary,
  DashboardSummary,
  DashboardTrendPoint,
  Group,
  TicketType,
} from "../types/ticket";

const FIELD_LABELS: Record<string, string> = {
  status: "status",
  priority: "priority",
  platform: "platform",
  group_id: "group",
  agent_id: "agent",
  ticket_type_id: "type",
};

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  open: "Open",
  pending: "Pending",
  resolved: "Resolved",
  closed: "Closed",
};

export default function DashboardPage() {
  const { tenantId } = useTenant();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [trends, setTrends] = useState<DashboardTrendPoint[]>([]);
  const [slaSummary, setSlaSummary] = useState<DashboardSlaSummary | null>(null);
  const [activity, setActivity] = useState<DashboardActivityItem[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    Promise.all([getDashboardSummary(tenantId), getDashboardTrends(tenantId, 14), getDashboardSlaSummary(tenantId)])
      .then(([summaryRes, trendsRes, slaRes]) => {
        setSummary(summaryRes);
        setTrends(trendsRes);
        setSlaSummary(slaRes);
      })
      .finally(() => setLoading(false));
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    getDashboardActivity(tenantId, 30).then(setActivity);
    Promise.all([listGroups(tenantId), listAgents(tenantId), listTicketTypes(tenantId)]).then(
      ([groupsRes, agentsRes, typesRes]) => {
        setGroups(groupsRes);
        setAgents(agentsRes);
        setTicketTypes(typesRes);
      },
    );
  }, [tenantId]);

  const groupNameById = new Map(groups.map((g) => [g.id, g.name]));
  const agentNameById = new Map(agents.map((a) => [a.id, a.name]));
  const typeNameById = new Map(ticketTypes.map((t) => [t.id, t.name]));

  const resolveValue = (field: string | null, value: string | null): string => {
    if (value === null) return "—";
    if (field === "group_id") return groupNameById.get(value) ?? "—";
    if (field === "agent_id") return agentNameById.get(value) ?? "—";
    if (field === "ticket_type_id") return typeNameById.get(value) ?? "—";
    return value;
  };

  const describeActivity = (item: DashboardActivityItem): string => {
    const who = item.actor_name ?? "Someone";
    if (item.kind === "ticket_created") {
      return `${who} raised a new ticket`;
    }
    if (item.kind === "activity" && item.field) {
      const label = FIELD_LABELS[item.field] ?? item.field;
      return `${who} changed the ${label} to ${resolveValue(item.field, item.new_value)}`;
    }
    if (item.kind === "message") {
      const verb = item.message_type === "note" ? "added a note to" : item.message_type === "forward" ? "forwarded" : "replied to";
      return `${who} ${verb} the ticket`;
    }
    return `${who} updated the ticket`;
  };

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to load the dashboard.</p>;
  }

  if (loading && !summary) {
    return <p>Loading…</p>;
  }

  if (!summary || !slaSummary) {
    return null;
  }

  return (
    <div>
      <h2>Dashboard</h2>

      <div className="stat-tiles">
        <StatTile label="Open tickets" value={summary.totalOpen} />
        <StatTile
          label="First response overdue"
          value={summary.overdueFirstResponse}
          tone={summary.overdueFirstResponse > 0 ? "critical" : undefined}
        />
        <StatTile
          label="Resolution overdue"
          value={summary.overdueResolution}
          tone={summary.overdueResolution > 0 ? "critical" : undefined}
        />
        {Object.entries(summary.byStatus).map(([status, count]) => (
          <StatTile key={status} label={STATUS_LABELS[status] ?? status} value={count} />
        ))}
      </div>

      <h3>Trends (last 14 days)</h3>
      <TrendsChart data={trends} />

      <h3>SLA summary</h3>
      <div className="stat-tiles">
        <StatTile label="Tickets with an SLA policy" value={slaSummary.totalWithSla} />
        <StatTile label="First response met" value={slaSummary.firstResponse.met} />
        <StatTile
          label="First response breached"
          value={slaSummary.firstResponse.breached}
          tone={slaSummary.firstResponse.breached > 0 ? "critical" : undefined}
        />
        <StatTile label="Resolution met" value={slaSummary.resolution.met} />
        <StatTile
          label="Resolution breached"
          value={slaSummary.resolution.breached}
          tone={slaSummary.resolution.breached > 0 ? "critical" : undefined}
        />
      </div>

      <h3>Recent activity</h3>
      {activity.length === 0 && <p className="hint">Nothing's happened yet.</p>}
      {activity.length > 0 && (
        <ul className="activity-feed">
          {activity.map((item, index) => (
            <li key={`${item.kind}-${item.ticket_id}-${item.timestamp}-${index}`}>
              <span>
                {describeActivity(item)} —{" "}
                <Link to={`/tickets/${item.ticket_id}`}>
                  #{item.ticket_number} {item.subject}
                </Link>
              </span>
              <span className="hint" title={new Date(item.timestamp).toLocaleString()}>
                {relativeTime(item.timestamp)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone?: "critical" }) {
  return (
    <div className={`stat-tile${tone ? ` stat-tile-${tone}` : ""}`}>
      <div className="stat-tile-value">{value}</div>
      <div className="stat-tile-label">{label}</div>
    </div>
  );
}
