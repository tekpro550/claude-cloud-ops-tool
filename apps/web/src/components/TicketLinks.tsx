import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  createTicketLink,
  deleteTicketLink,
  listTicketLinks,
  type LinkedTicket,
  type TicketLinkType,
} from "../lib/apiClient";

const RELATION_LABEL: Record<LinkedTicket["relation"], string> = {
  related: "Related",
  parent: "Parent",
  child: "Child",
};

/**
 * Linked / parent-child tickets side panel. Lists this ticket's related,
 * parent, and child tickets and lets the agent add or remove links by number.
 */
export default function TicketLinks({ tenantId, ticketId }: { tenantId: string; ticketId: string }) {
  const [links, setLinks] = useState<LinkedTicket[]>([]);
  const [number, setNumber] = useState("");
  const [linkType, setLinkType] = useState<TicketLinkType>("related");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    listTicketLinks(tenantId, ticketId).then(setLinks).catch(() => {});
  };
  useEffect(load, [tenantId, ticketId]);

  const handleAdd = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const n = parseInt(number.trim().replace(/^#/, ""), 10);
    if (!Number.isFinite(n)) {
      setError("Enter a ticket number.");
      return;
    }
    setBusy(true);
    createTicketLink(tenantId, ticketId, n, linkType)
      .then(() => {
        setNumber("");
        setLinkType("related");
        load();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to link ticket"))
      .finally(() => setBusy(false));
  };

  const remove = (linkId: string) => {
    deleteTicketLink(tenantId, ticketId, linkId).then(load).catch(() => {});
  };

  return (
    <div className="ticket-links">
      {links.length === 0 ? (
        <p className="hint">No linked tickets.</p>
      ) : (
        <ul className="ticket-links-list">
          {links.map((l) => (
            <li key={l.linkId} className="ticket-links-item">
              <span className="badge">{RELATION_LABEL[l.relation]}</span>
              <Link to={`/tickets/${l.ticketId}`} className="ticket-links-subject" title={l.subject}>
                #{l.ticketNumber} {l.subject}
              </Link>
              <span className={`badge status-${l.status}`}>{l.status}</span>
              <button type="button" className="btn-ghost btn-sm" onClick={() => remove(l.linkId)}>
                Unlink
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="ticket-links-form" onSubmit={handleAdd}>
        <input type="text" placeholder="Ticket #" value={number} onChange={(e) => setNumber(e.target.value)} />
        <select value={linkType} onChange={(e) => setLinkType(e.target.value as TicketLinkType)}>
          <option value="related">Related</option>
          <option value="parent_of">Parent of</option>
          <option value="child_of">Child of</option>
        </select>
        <button type="submit" className="btn-secondary btn-sm" disabled={busy}>Link</button>
      </form>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
