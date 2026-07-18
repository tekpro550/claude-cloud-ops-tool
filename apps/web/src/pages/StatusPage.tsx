import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError } from "../lib/apiClient";
import { getPublicStatus } from "../lib/monitoringApiClient";
import type { PublicStatus } from "../types/monitoring";

const POLL_MS = 60_000;

const STATUS_LABEL: Record<string, string> = {
  up: "Operational",
  down: "Down",
  critical: "Critical",
  trouble: "Degraded",
  unknown: "Unknown",
};

// Public, unauthenticated status page -- rendered standalone (no admin app
// chrome; see App.tsx's isPublicStatusRoute check) so a shared link reads as
// a customer-facing page, not an internal tool.
export default function StatusPage() {
  const { slug } = useParams<{ slug: string }>();
  const [status, setStatus] = useState<PublicStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    let active = true;
    const load = () => {
      getPublicStatus(slug)
        .then((result) => {
          if (active) setStatus(result);
        })
        .catch((err) => {
          if (active) setError(err instanceof ApiError ? err.message : "This status page is unavailable.");
        });
    };
    load();
    const handle = setInterval(load, POLL_MS);
    return () => {
      active = false;
      clearInterval(handle);
    };
  }, [slug]);

  if (error) {
    return (
      <div className="status-page">
        <p className="error">{error}</p>
      </div>
    );
  }

  if (!status) {
    return <div className="status-page" />;
  }

  const allUp = status.components.every((c) => c.status === "up");

  return (
    <div className="status-page">
      <div className="status-page-card">
        <h1>{status.title}</h1>
        {status.description && <p className="hint">{status.description}</p>}
        <div className={`status-page-overall ${allUp ? "status-page-overall-up" : "status-page-overall-down"}`}>
          {allUp ? "All systems operational" : "Some systems are experiencing issues"}
        </div>
        <ul className="status-page-components">
          {status.components.map((component) => (
            <li key={component.name}>
              <span>{component.name}</span>
              <span className={`status-page-badge status-page-badge-${component.status}`}>
                {STATUS_LABEL[component.status] ?? component.status}
              </span>
              {component.uptimePct !== null && (
                <span className="hint status-page-uptime">{component.uptimePct.toFixed(2)}% (90d)</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
