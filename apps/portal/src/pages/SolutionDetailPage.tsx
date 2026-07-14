import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, getSolution } from "../lib/apiClient";
import { useTenant } from "../lib/tenant";
import type { Solution } from "../types/portal";

export default function SolutionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { tenantId } = useTenant();
  const [solution, setSolution] = useState<Solution | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId || !id) return;
    getSolution(tenantId, id)
      .then(setSolution)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load article"));
  }, [tenantId, id]);

  if (error) return <p className="error">{error}</p>;
  if (!solution) return <p>Loading…</p>;

  return (
    <div>
      <p>
        <Link to="/solutions">&larr; Back to solutions</Link>
      </p>
      <h2>{solution.title}</h2>
      <div className="solution-body">{solution.body}</div>
    </div>
  );
}
