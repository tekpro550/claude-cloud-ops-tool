import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import {
  createLogAlertRule,
  deleteLogAlertRule,
  listLogAlertRules,
  listLogSources,
} from "../../lib/monitoringApiClient";
import { LOG_LEVELS } from "../../types/monitoring";
import type { LogAlertRule, LogLevel, LogSource } from "../../types/monitoring";
import { useConfirm } from "../useConfirm";

export default function LogAlertRulesAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [rules, setRules] = useState<LogAlertRule[]>([]);
  const [sources, setSources] = useState<LogSource[]>([]);
  const [name, setName] = useState("");
  const [logSourceId, setLogSourceId] = useState("");
  const [matchQuery, setMatchQuery] = useState("");
  const [levelAtLeast, setLevelAtLeast] = useState<LogLevel>("error");
  const [windowSeconds, setWindowSeconds] = useState("300");
  const [threshold, setThreshold] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const load = () => {
    listLogAlertRules(tenantId).then(setRules);
    listLogSources(tenantId).then(setSources);
  };

  useEffect(load, [tenantId]);

  const sourceName = (id: string) => sources.find((s) => s.id === id)?.name ?? id;

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !logSourceId) return;
    setError(null);
    createLogAlertRule(tenantId, {
      logSourceId,
      name: name.trim(),
      matchQuery: matchQuery.trim() || undefined,
      levelAtLeast,
      windowSeconds: Number(windowSeconds) || 300,
      threshold: Number(threshold) || 1,
    })
      .then(() => {
        setName("");
        setMatchQuery("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create log alert rule"));
  };

  const handleDelete = (rule: LogAlertRule) => {
    deleteLogAlertRule(tenantId, rule.id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete log alert rule"));
  };

  return (
    <div className="admin-entity">
      <h4>Log alert rules</h4>
      <p className="hint">
        When at least <em>threshold</em> matching entries land within the trailing window, a ticket is opened.
      </p>
      {error && <p className="error">{error}</p>}
      {rules.length === 0 && <p className="hint">No log alert rules yet.</p>}
      {rules.length > 0 && (
        <ul className="admin-list">
          {rules.map((r) => (
            <li key={r.id}>
              <span>
                <strong>{r.name}</strong>{" "}
                <span className="hint">
                  · {sourceName(r.log_source_id)} · level ≥ {r.level_at_least} · {r.threshold} in {r.window_seconds}s
                  {r.match_query && <> · matching "{r.match_query}"</>}
                </span>
                {r.last_fired_at && (
                  <span className="hint"> · last fired {new Date(r.last_fired_at).toLocaleString()}</span>
                )}
              </span>
              <span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    confirm({
                      title: "Delete log alert rule",
                      message: `Delete “${r.name}”?`,
                      onConfirm: () => handleDelete(r),
                    })
                  }
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleCreate}>
        <input placeholder="Rule name" value={name} onChange={(e) => setName(e.target.value)} required />
        <select value={logSourceId} onChange={(e) => setLogSourceId(e.target.value)} required>
          <option value="">Select a source…</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select value={levelAtLeast} onChange={(e) => setLevelAtLeast(e.target.value as LogLevel)}>
          {LOG_LEVELS.map((l) => (
            <option key={l} value={l}>
              level ≥ {l}
            </option>
          ))}
        </select>
        <input placeholder="Match text (optional)" value={matchQuery} onChange={(e) => setMatchQuery(e.target.value)} />
        <label className="side-panel-toggle" title="Trailing window, in seconds, entries are counted over">
          Window (s)
          <input type="number" min={10} value={windowSeconds} onChange={(e) => setWindowSeconds(e.target.value)} style={{ width: "5rem" }} />
        </label>
        <label className="side-panel-toggle" title="Minimum matching entries in the window before the rule fires">
          Threshold
          <input type="number" min={1} value={threshold} onChange={(e) => setThreshold(e.target.value)} style={{ width: "4rem" }} />
        </label>
        <button type="submit">Create rule</button>
      </form>
      {confirmDialog}
    </div>
  );
}
