import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, createSolution, deleteSolution, listSolutions, updateSolution } from "../../lib/apiClient";
import type { Solution } from "../../types/ticket";

export default function SolutionsAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const load = () => {
    listSolutions(tenantId).then(setSolutions);
  };

  useEffect(load, [tenantId]);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    setError(null);
    createSolution(tenantId, { title, body })
      .then(() => {
        setTitle("");
        setBody("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create solution"))
      .finally(() => setBusy(false));
  };

  const handleDelete = (solution: Solution) => {
    setError(null);
    deleteSolution(tenantId, solution.id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete solution"));
  };

  const togglePublished = (solution: Solution) => {
    setError(null);
    updateSolution(tenantId, solution.id, { isPublished: !solution.is_published })
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to update solution"));
  };

  const startEdit = (solution: Solution) => {
    setEditingId(solution.id);
    setEditTitle(solution.title);
    setEditBody(solution.body);
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = (id: string) => {
    if (!editTitle.trim() || !editBody.trim()) return;
    setError(null);
    updateSolution(tenantId, id, { title: editTitle, body: editBody })
      .then(() => {
        setEditingId(null);
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to update solution"));
  };

  return (
    <div className="admin-entity">
      <h4>Solutions (knowledge base)</h4>
      {error && <p className="error">{error}</p>}
      {solutions.length === 0 && <p className="hint">No articles yet.</p>}
      {solutions.length > 0 && (
        <ul className="admin-list">
          {solutions.map((s) =>
            editingId === s.id ? (
              <li key={s.id}>
                <span className="admin-form">
                  <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                  <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={3} />
                </span>
                <span>
                  <button type="button" className="link-button" onClick={() => saveEdit(s.id)}>
                    Save
                  </button>
                  <button type="button" className="link-button" onClick={cancelEdit}>
                    Cancel
                  </button>
                </span>
              </li>
            ) : (
              <li key={s.id}>
                <span>
                  <strong>{s.title}</strong>{" "}
                  <span className={s.is_published ? "hint" : "badge sla-state-breached"}>
                    {s.is_published ? "published" : "draft"}
                  </span>
                </span>
                <span>
                  <button type="button" className="link-button" onClick={() => togglePublished(s)}>
                    {s.is_published ? "Unpublish" : "Publish"}
                  </button>
                  <button type="button" className="link-button" onClick={() => startEdit(s)}>
                    Edit
                  </button>
                  <button type="button" className="link-button" onClick={() => handleDelete(s)}>
                    Delete
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleCreate}>
        <input placeholder="Article title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <textarea
          placeholder="Article body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          required
        />
        <button type="submit" disabled={busy}>
          Add article (draft)
        </button>
      </form>
    </div>
  );
}
