import { useEffect, useState } from "react";
import { ApiError, applyScenario, listScenarios } from "../lib/apiClient";
import type { Scenario, Ticket } from "../types/ticket";

export default function TicketScenarios({
  tenantId,
  ticketId,
  onApplied,
}: {
  tenantId: string;
  ticketId: string;
  onApplied: (ticket: Ticket) => void;
}) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listScenarios(tenantId).then(setScenarios);
  }, [tenantId]);

  const handleApply = (scenario: Scenario) => {
    setBusyId(scenario.id);
    setError(null);
    applyScenario(tenantId, scenario.id, ticketId)
      .then(onApplied)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to apply scenario"))
      .finally(() => setBusyId(null));
  };

  if (scenarios.length === 0) {
    return <p className="hint">No scenarios set up yet (Admin → Workflows).</p>;
  }

  return (
    <div>
      {error && <p className="error">{error}</p>}
      <div className="scenario-buttons">
        {scenarios.map((s) => (
          <button key={s.id} type="button" disabled={busyId === s.id} onClick={() => handleApply(s)}>
            {s.name}
          </button>
        ))}
      </div>
    </div>
  );
}
