import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, getMyTicket } from "../lib/apiClient";
import type { PortalTicketDetail } from "../types/portal";

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<PortalTicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getMyTicket(id)
      .then(setTicket)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load ticket"));
  }, [id]);

  if (error) return <p className="error">{error}</p>;
  if (!ticket) return <p>Loading…</p>;

  return (
    <div>
      <p>
        <Link to="/tickets">&larr; Back to my tickets</Link>
      </p>
      <h2>
        #{ticket.ticket_number} — {ticket.subject}
      </h2>
      <p className="hint">
        Status: <span className={`badge status-${ticket.status}`}>{ticket.status}</span> · Priority: {ticket.priority}
      </p>

      <ul className="message-thread">
        {ticket.messages.map((m) => (
          <li key={m.id} className="message">
            <div className="message-meta">
              {m.author_type === "contact" ? "You" : "Support"} · {new Date(m.created_at).toLocaleString()}
            </div>
            <div className="message-body">{m.body}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
