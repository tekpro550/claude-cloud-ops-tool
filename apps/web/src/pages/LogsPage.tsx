import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { listLogSources, searchLogs } from "../lib/monitoringApiClient";
import { LOG_LEVELS } from "../types/monitoring";
import type { LogEntry, LogLevel, LogSource } from "../types/monitoring";
import { useTenant } from "../lib/tenant";

/**
 * Site24x7-style log search: source picker, level filter, full-text search
 * box, a flat result list (timestamp/level/message). Ingestion and source
 * management live in Admin (LogSourcesAdmin) -- this page is read/search
 * only, agent-facing.
 */
export default function LogsPage() {
  const { tenantId } = useTenant();
  const [sources, setSources] = useState<LogSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [level, setLevel] = useState<LogLevel | "">("");
  const [q, setQ] = useState("");
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    listLogSources(tenantId).then(setSources);
  }, [tenantId]);

  const runSearch = () => {
    if (!tenantId) return;
    setLoading(true);
    searchLogs(tenantId, { sourceId: sourceId || undefined, level: level || undefined, q: q || undefined, limit: 200 })
      .then(setEntries)
      .finally(() => setLoading(false));
  };

  useEffect(runSearch, [tenantId, sourceId, level]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    runSearch();
  };

  const sourceName = (id: string) => sources.find((s) => s.id === id)?.name ?? id;

  if (!tenantId) return <p className="hint">Set a tenant id above to view logs.</p>;

  return (
    <div>
      <div className="reports-header">
        <h2>Logs</h2>
      </div>

      <form className="admin-form" onSubmit={handleSubmit} style={{ marginBottom: "0.75rem" }}>
        <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={level} onChange={(e) => setLevel(e.target.value as LogLevel | "")}>
          <option value="">All levels</option>
          {LOG_LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <input placeholder="Search message text…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: "1 1 16rem" }} />
        <button type="submit" disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {sources.length === 0 && (
        <p className="hint">
          No log sources yet — create one in Admin → Monitor admin → Log sources, then point a shipper at{" "}
          <code>POST /logs/ingest</code>.
        </p>
      )}

      {entries.length === 0 && sources.length > 0 && !loading && <p className="hint">No log entries match.</p>}

      {entries.length > 0 && (
        <ul className="log-entry-list">
          {entries.map((e) => (
            <li key={e.id} className={`log-entry-row log-entry-row-${e.level}`}>
              <span className="log-entry-ts">{new Date(e.ts).toLocaleString()}</span>
              <span className={`badge log-level-badge log-level-badge-${e.level}`}>{e.level}</span>
              <span className="hint">{sourceName(e.log_source_id)}</span>
              <span className="log-entry-message">{e.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
