import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import {
  addStatusPageMonitor,
  createStatusPage,
  deleteStatusPage,
  getStatusPage,
  listMonitors,
  listStatusPages,
  removeStatusPageMonitor,
  updateStatusPage,
} from "../../lib/monitoringApiClient";
import type { Monitor, StatusPage, StatusPageDetail } from "../../types/monitoring";
import { useConfirm } from "../useConfirm";

export default function StatusPagesAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [pages, setPages] = useState<StatusPage[]>([]);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<StatusPageDetail | null>(null);
  const [monitorToAdd, setMonitorToAdd] = useState("");

  const publicBase = typeof window !== "undefined" ? window.location.origin : "";

  const load = () => {
    listStatusPages(tenantId).then(setPages);
    listMonitors(tenantId).then(setMonitors);
  };

  useEffect(load, [tenantId]);

  const loadDetail = (id: string) => {
    getStatusPage(tenantId, id).then(setDetail);
  };

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!slug.trim() || !title.trim()) return;
    setBusy(true);
    setError(null);
    createStatusPage(tenantId, { slug: slug.trim(), title: title.trim() })
      .then(() => {
        setSlug("");
        setTitle("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create status page"))
      .finally(() => setBusy(false));
  };

  const handleTogglePublic = (page: StatusPage) => {
    updateStatusPage(tenantId, page.id, { isPublic: !page.is_public })
      .then(() => {
        load();
        if (openId === page.id) loadDetail(page.id);
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to update status page"));
  };

  const handleDelete = (page: StatusPage) => {
    deleteStatusPage(tenantId, page.id)
      .then(() => {
        if (openId === page.id) setOpenId(null);
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete status page"));
  };

  const toggleOpen = (page: StatusPage) => {
    if (openId === page.id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(page.id);
    loadDetail(page.id);
  };

  const handleAddMonitor = (statusPageId: string) => {
    if (!monitorToAdd) return;
    addStatusPageMonitor(tenantId, statusPageId, { monitorId: monitorToAdd })
      .then(() => {
        setMonitorToAdd("");
        loadDetail(statusPageId);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to add monitor"));
  };

  const handleRemoveMonitor = (statusPageId: string, linkId: string) => {
    removeStatusPageMonitor(tenantId, statusPageId, linkId)
      .then(() => loadDetail(statusPageId))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to remove monitor"));
  };

  return (
    <div className="admin-entity">
      <h4>Status pages</h4>
      <p className="hint">
        A published page is reachable, unauthenticated, at its public URL below — share it with customers.
      </p>
      {error && <p className="error">{error}</p>}
      {pages.length === 0 && <p className="hint">No status pages yet.</p>}
      {pages.length > 0 && (
        <ul className="admin-list">
          {pages.map((page) => (
            <li key={page.id} className={openId === page.id ? "admin-list-item-expanded" : undefined}>
              <div className="admin-list-row">
                <span>
                  <strong>{page.title}</strong>{" "}
                  <span className={`badge ${page.is_public ? "kb-badge-published" : "kb-badge-draft"}`}>
                    {page.is_public ? "Published" : "Unpublished"}
                  </span>
                  <br />
                  <span className="hint">{publicBase}/status/{page.slug}</span>
                </span>
                <span>
                  <button type="button" className="link-button" onClick={() => toggleOpen(page)}>
                    {openId === page.id ? "Close" : "Manage monitors"}
                  </button>
                  <button type="button" className="link-button" onClick={() => handleTogglePublic(page)}>
                    {page.is_public ? "Unpublish" : "Publish"}
                  </button>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() =>
                      confirm({
                        title: "Delete status page",
                        message: `Delete “${page.title}”? This can't be undone.`,
                        onConfirm: () => handleDelete(page),
                      })
                    }
                  >
                    Delete
                  </button>
                </span>
              </div>
              {openId === page.id && detail && (
                <div className="admin-nested">
                  {detail.monitors.length === 0 && <p className="hint">No monitors on this page yet.</p>}
                  {detail.monitors.length > 0 && (
                    <ul className="admin-list">
                      {detail.monitors.map((link) => (
                        <li key={link.id}>
                          <span>{link.display_name ?? link.monitor_name}</span>
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => handleRemoveMonitor(page.id, link.id)}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="admin-form">
                    <select value={monitorToAdd} onChange={(e) => setMonitorToAdd(e.target.value)}>
                      <option value="" disabled>
                        Monitor…
                      </option>
                      {monitors.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={() => handleAddMonitor(page.id)}>
                      Add to page
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleCreate}>
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <input
          placeholder="url-slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
          required
        />
        <button type="submit" disabled={busy}>
          Create status page
        </button>
      </form>
      {confirmDialog}
    </div>
  );
}
