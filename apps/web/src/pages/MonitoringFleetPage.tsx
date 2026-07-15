import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../lib/apiClient";
import { createResource, getFleetSummary } from "../lib/monitoringApiClient";
import { useTenant } from "../lib/tenant";
import type { FleetSummaryItem, ResourceType } from "../types/monitoring";

const RESOURCE_TYPES: ResourceType[] = ["server", "cloud_account", "service", "website", "database", "other"];

/**
 * Fleet-wide status view (Module 2 Sprint 6 scope section 6) -- the default
 * landing page for the Monitoring section. Each resource rolls up to the
 * worst status across its monitors (see ResourcesService.fleetSummary).
 */
export default function MonitoringFleetPage() {
  const { tenantId } = useTenant();
  const [items, setItems] = useState<FleetSummaryItem[]>([]);
  const [name, setName] = useState("");
  const [resourceType, setResourceType] = useState<ResourceType>("server");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!tenantId) return;
    getFleetSummary(tenantId).then(setItems);
  };

  useEffect(load, [tenantId]);

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to view monitoring.</p>;
  }

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    createResource(tenantId, { name, resourceType })
      .then(() => {
        setName("");
        load();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create resource"))
      .finally(() => setBusy(false));
  };

  return (
    <div>
      <h2>Fleet status</h2>
      {error && <p className="error">{error}</p>}
      {items.length === 0 && <p className="hint">No resources yet — add one below to start monitoring it.</p>}
      {items.length > 0 && (
        <div className="fleet-row-list">
          {items.map((item) => {
            const status = item.worst_status ?? "none";
            return (
              <Link key={item.id} to={`/monitoring/resources/${item.id}`} className={`fleet-row fleet-row-status-${status}`}>
                <span className={`status-dot status-dot-${status}`} title={item.worst_status ?? "no monitors"} />
                <div className="fleet-row-main">
                  <span className="fleet-row-name">{item.name}</span>
                  <span className="fleet-row-meta">
                    {item.resource_type}
                    {item.group_name ? ` · ${item.group_name}` : ""}
                  </span>
                </div>
                <span className={`badge status-${status}`}>{item.worst_status ?? "no monitors"}</span>
                <span className="fleet-row-count">
                  {item.monitor_count} monitor{item.monitor_count === 1 ? "" : "s"}
                </span>
              </Link>
            );
          })}
        </div>
      )}

      <form className="admin-form" onSubmit={handleCreate} style={{ marginTop: "1rem" }}>
        <input placeholder="Resource name" value={name} onChange={(e) => setName(e.target.value)} required />
        <select value={resourceType} onChange={(e) => setResourceType(e.target.value as ResourceType)}>
          {RESOURCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-primary" disabled={busy}>
          Add resource
        </button>
      </form>
    </div>
  );
}
