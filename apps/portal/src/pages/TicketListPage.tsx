import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, listMyTickets } from "../lib/apiClient";
import type { PortalTicket } from "../types/portal";

export default function TicketListPage() {
  const [tickets, setTickets] = useState<PortalTicket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listMyTickets()
      .then(setTickets)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load tickets"));
  }, []);

  return (
    <div>
      <h2>My tickets</h2>
      {error && <p className="error">{error}</p>}
      {tickets === null && !error && <p>Loading…</p>}
      {tickets?.length === 0 && <p className="hint">You haven't submitted any tickets yet.</p>}
      {tickets && tickets.length > 0 && (
        <ul className="ticket-list">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link to={`/tickets/${t.id}`}>
                #{t.ticket_number} — {t.subject}
              </Link>
              <span className={`badge status-${t.status}`}>{t.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
