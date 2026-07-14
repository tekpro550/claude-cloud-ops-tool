import { useEffect, useState } from "react";
import type { ReactNode } from "react";

const STORAGE_KEY = "cloud-ops-tool.sidePanelLayout";

export interface SidePanelSection {
  id: string;
  title: string;
  content: ReactNode;
}

interface StoredLayout {
  order: string[];
  hidden: string[];
}

function loadLayout(): StoredLayout | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Generic drag-to-reorder / toggle-visibility panel (Sprint 3.5). Order and
 * visibility persist to localStorage so they survive a reload, same as the
 * tenant id (lib/tenant.tsx) -- there's no per-user server-side settings
 * store yet. Section content is passed in by the caller; this component only
 * owns layout, not what's inside each section.
 */
export default function SidePanel({ sections }: { sections: SidePanelSection[] }) {
  const ids = sections.map((s) => s.id);

  const [order, setOrder] = useState<string[]>(() => {
    const stored = loadLayout();
    if (!stored) return ids;
    const known = stored.order.filter((id) => ids.includes(id));
    const missing = ids.filter((id) => !known.includes(id));
    return [...known, ...missing];
  });
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(loadLayout()?.hidden ?? []));
  const [draggedId, setDraggedId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ order, hidden: Array.from(hidden) }));
  }, [order, hidden]);

  const byId = new Map(sections.map((s) => [s.id, s]));

  const toggleVisible = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDrop = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    setOrder((prev) => {
      const next = prev.filter((id) => id !== draggedId);
      next.splice(next.indexOf(targetId), 0, draggedId);
      return next;
    });
    setDraggedId(null);
  };

  return (
    <div className="side-panel">
      <div className="side-panel-toggles">
        {sections.map((s) => (
          <label key={s.id} className="side-panel-toggle">
            <input type="checkbox" checked={!hidden.has(s.id)} onChange={() => toggleVisible(s.id)} />
            {s.title}
          </label>
        ))}
      </div>
      {order.map((id) => {
        const section = byId.get(id);
        if (!section || hidden.has(id)) return null;
        return (
          <div
            key={id}
            className={`side-panel-section${draggedId === id ? " dragging" : ""}`}
            draggable
            onDragStart={() => setDraggedId(id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(id)}
            onDragEnd={() => setDraggedId(null)}
          >
            <div className="side-panel-section-header">
              <span className="drag-handle" aria-hidden="true">
                ⠿
              </span>
              {section.title}
            </div>
            <div className="side-panel-section-body">{section.content}</div>
          </div>
        );
      })}
    </div>
  );
}
