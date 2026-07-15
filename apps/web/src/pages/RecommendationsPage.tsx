import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../lib/apiClient";
import {
  createTicketFromRecommendation,
  dismissRecommendation,
  listRecommendations,
  resolveRecommendation,
} from "../lib/costApiClient";
import { useTenant } from "../lib/tenant";
import type { RightsizingRecommendation, RightsizingRecommendationStatus } from "../types/cost";

const STATUSES: (RightsizingRecommendationStatus | "all")[] = [
  "all",
  "open",
  "dismissed",
  "ticket_created",
  "resolved",
];

/** Rightsizing recommendations list (scope doc section 6): reason text, "create ticket" / "dismiss" actions, status filter. */
export default function RecommendationsPage() {
  const { tenantId } = useTenant();
  const [status, setStatus] = useState<RightsizingRecommendationStatus | "all">("open");
  const [recommendations, setRecommendations] = useState<RightsizingRecommendation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    if (!tenantId) return;
    listRecommendations(tenantId, status === "all" ? {} : { status }).then(setRecommendations);
  };

  useEffect(load, [tenantId, status]);

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to view recommendations.</p>;
  }

  const handleDismiss = (id: string) => {
    setError(null);
    setBusyId(id);
    dismissRecommendation(tenantId, id)
      .then(load)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to dismiss recommendation"))
      .finally(() => setBusyId(null));
  };

  const handleResolve = (id: string) => {
    setError(null);
    setBusyId(id);
    resolveRecommendation(tenantId, id)
      .then(load)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to resolve recommendation"))
      .finally(() => setBusyId(null));
  };

  const handleCreateTicket = (id: string) => {
    setError(null);
    setBusyId(id);
    createTicketFromRecommendation(tenantId, id)
      .then(load)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create ticket"))
      .finally(() => setBusyId(null));
  };

  return (
    <div>
      <h2>Rightsizing recommendations</h2>
      <div className="view-tabs">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className={`view-tab${s === status ? " view-tab-active" : ""}`}
            onClick={() => setStatus(s)}
          >
            {s}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {recommendations.length === 0 && <p className="hint">No recommendations.</p>}
      {recommendations.map((r) => (
        <div key={r.id} className="alert-card">
          <div className="alert-card-header">
            <span>
              <span className="badge">{r.recommendation_type}</span>{" "}
              <span className="badge">{r.status}</span> {r.reason_text}
            </span>
            <span>
              {r.status === "open" && (
                <>
                  <button
                    type="button"
                    className="btn-sm btn-primary"
                    disabled={busyId === r.id}
                    onClick={() => handleCreateTicket(r.id)}
                  >
                    Create ticket
                  </button>
                  <button
                    type="button"
                    className="btn-sm"
                    disabled={busyId === r.id}
                    onClick={() => handleResolve(r.id)}
                  >
                    Mark resolved
                  </button>
                  <button
                    type="button"
                    className="btn-sm btn-ghost"
                    disabled={busyId === r.id}
                    onClick={() => handleDismiss(r.id)}
                  >
                    Dismiss
                  </button>
                </>
              )}
            </span>
          </div>
          <span className="hint">
            {r.estimated_monthly_saving !== null && `Est. saving: $${Number(r.estimated_monthly_saving).toFixed(2)}/mo · `}
            Flagged {new Date(r.created_at).toLocaleString()}
            {r.ticket_id ? (
              <>
                {" · "}
                <Link to={`/tickets/${r.ticket_id}`}>View linked ticket</Link>
              </>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  );
}
