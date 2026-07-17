import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import { createResource, deleteResource, listResources } from "../../lib/monitoringApiClient";
import type { Resource, ResourceType } from "../../types/monitoring";
import { useConfirm } from "../useConfirm";

const RESOURCE_TYPES: ResourceType[] = ["server", "cloud_account", "service", "website", "database", "other"];

export default function ResourcesAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [resources, setResources] = useState<Resource[]>([]);
  const [name, setName] = useState("");
  const [resourceType, setResourceType] = useState<ResourceType>("server");
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const load = () => {
    listResources(tenantId).then(setResources);
  };

  useEffect(load, [tenantId]);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setError(null);
    createResource(tenantId, { name, resourceType })
      .then(() => {
        setName("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create resource"));
  };

  const handleDelete = (id: string) => {
    deleteResource(tenantId, id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete resource"));
  };

  return (
    <div className="admin-entity">
      <h4>Resources</h4>
      {error && <p className="error">{error}</p>}
      {resources.length === 0 && <p className="hint">No resources yet.</p>}
      {resources.length > 0 && (
        <ul className="admin-list">
          {resources.map((r) => (
            <li key={r.id}>
              <span>
                <strong>{r.name}</strong> <span className="hint">({r.resource_type})</span>
              </span>
              <span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    confirm({
                      title: "Delete resource",
                      message: `Delete “${r.name}”? This can't be undone.`,
                      onConfirm: () => handleDelete(r.id),
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
        <input placeholder="Resource name" value={name} onChange={(e) => setName(e.target.value)} required />
        <select value={resourceType} onChange={(e) => setResourceType(e.target.value as ResourceType)}>
          {RESOURCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button type="submit">Add resource</button>
      </form>
      {confirmDialog}
    </div>
  );
}
