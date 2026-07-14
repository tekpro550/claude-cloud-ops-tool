import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, listSolutions, searchSolutions } from "../lib/apiClient";
import { useTenant } from "../lib/tenant";
import type { Solution } from "../types/portal";

export default function SolutionsPage() {
  const { tenantId } = useTenant();
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const [solutions, setSolutions] = useState<Solution[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    listSolutions(tenantId)
      .then(setSolutions)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load solutions"));
  }, [tenantId]);

  const visible = solutions ? (q.trim() ? searchSolutions(solutions, q) : solutions) : null;

  return (
    <div>
      <h2>Solutions</h2>
      <input
        placeholder="Search articles…"
        value={q}
        onChange={(e) => setSearchParams(e.target.value ? { q: e.target.value } : {})}
      />
      {error && <p className="error">{error}</p>}
      {visible === null && !error && <p>Loading…</p>}
      {visible?.length === 0 && <p className="hint">No articles found.</p>}
      {visible && visible.length > 0 && (
        <ul className="solutions-list">
          {visible.map((s) => (
            <li key={s.id}>
              <Link to={`/solutions/${s.id}`}>{s.title}</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
