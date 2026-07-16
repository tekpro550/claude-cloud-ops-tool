import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, getMyTicket, getMyTicketSatisfaction, rateMyTicket } from "../lib/apiClient";
import type { PortalTicketDetail, TicketSatisfaction, TicketSatisfactionRating } from "../types/portal";

const RATINGS: { value: TicketSatisfactionRating; emoji: string; label: string }[] = [
  { value: "happy", emoji: "😊", label: "Happy" },
  { value: "neutral", emoji: "😐", label: "Neutral" },
  { value: "unhappy", emoji: "😞", label: "Unhappy" },
];

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<PortalTicketDetail | null>(null);
  const [satisfaction, setSatisfaction] = useState<TicketSatisfaction | null>(null);
  const [comment, setComment] = useState("");
  const [rating, setRating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getMyTicket(id)
      .then(setTicket)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load ticket"));
    getMyTicketSatisfaction(id)
      .then(setSatisfaction)
      .catch(() => {
        // The rating widget is supplementary; a lookup failure shouldn't
        // block the rest of the ticket from loading.
      });
  }, [id]);

  const handleRate = (value: TicketSatisfactionRating) => {
    if (!id) return;
    setRating(true);
    setError(null);
    rateMyTicket(id, { rating: value, comment: comment.trim() || undefined })
      .then(setSatisfaction)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to submit rating"))
      .finally(() => setRating(false));
  };

  if (error) return <p className="error">{error}</p>;
  if (!ticket) return <p>Loading…</p>;

  const canRate = ticket.status === "resolved" || ticket.status === "closed";

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

      {canRate && (
        <div className="satisfaction-widget">
          <h3>How was your support experience?</h3>
          {satisfaction ? (
            <p className="hint">
              You rated this {RATINGS.find((r) => r.value === satisfaction.rating)?.label.toLowerCase()}. Thanks for the feedback!
            </p>
          ) : (
            <>
              <div className="satisfaction-widget-ratings">
                {RATINGS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    className="satisfaction-widget-rating-btn"
                    disabled={rating}
                    onClick={() => handleRate(r.value)}
                  >
                    <span aria-hidden="true">{r.emoji}</span>
                    <span>{r.label}</span>
                  </button>
                ))}
              </div>
              <textarea
                placeholder="Anything you'd like to add? (optional)"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
