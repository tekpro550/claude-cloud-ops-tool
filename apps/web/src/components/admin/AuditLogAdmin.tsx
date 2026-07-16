import { useEffect, useState } from "react";
import { listAuditLog, type AuditLogEntry } from "../../lib/apiClient";
import { relativeTime } from "../../lib/relativeTime";

/**
 * Read-only admin audit trail: who changed configuration, what, and when.
 * Admin-only on the server; here it just renders whatever the endpoint
 * returns (or nothing, silently, for non-admins who get a 403).
 */
export default function AuditLogAdmin({ tenantId, refreshSignal }: { tenantId: string; refreshSignal?: number }) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    listAuditLog(tenantId, 50)
      .then((res) => {
        setEntries(res.items);
        setForbidden(false);
      })
      .catch(() => {
        // A non-admin (or a headerless pilot request) gets a 403 -- treat it
        // as "nothing to show" rather than surfacing an error on the page.
        setForbidden(true);
      });
  }, [tenantId, refreshSignal]);

  if (forbidden) return null;

  return (
    <div className="admin-entity">
      <h4>Audit log</h4>
      <p className="hint">Configuration changes across ticketing, workflows, and cost — most recent first.</p>
      {entries.length === 0 ? (
        <p className="hint">No configuration changes recorded yet.</p>
      ) : (
        <ul className="audit-log-list">
          {entries.map((e) => (
            <li key={e.id} className="audit-log-item">
              <span className="audit-log-action">{e.action}</span>
              <span className="audit-log-summary">{e.summary}</span>
              <span className="audit-log-actor">{e.actor_label ?? "system"}</span>
              <span className="hint audit-log-time" title={new Date(e.created_at).toLocaleString()}>
                {relativeTime(e.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
