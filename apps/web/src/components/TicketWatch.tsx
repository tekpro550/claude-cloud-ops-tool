import { useEffect, useState } from "react";
import {
  listTicketWatchers,
  unwatchTicket,
  watchTicket,
  type Watcher,
} from "../lib/apiClient";
import { useAuth } from "../lib/auth";

/**
 * Watch/unwatch toggle + watcher list. Watchers get notified of every reply on
 * the ticket. Requires a signed-in agent; hidden for header-only sessions.
 */
export default function TicketWatch({ tenantId, ticketId }: { tenantId: string; ticketId: string }) {
  const { user } = useAuth();
  const [watchers, setWatchers] = useState<Watcher[]>([]);
  const [busy, setBusy] = useState(false);

  const load = () => {
    listTicketWatchers(tenantId, ticketId).then(setWatchers).catch(() => {});
  };
  useEffect(load, [tenantId, ticketId]);

  if (!user) return null;

  const watching = watchers.some((w) => w.email === user.email);

  const toggle = () => {
    setBusy(true);
    const op = watching ? unwatchTicket : watchTicket;
    op(tenantId, ticketId)
      .then(setWatchers)
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  return (
    <div className="ticket-watch">
      <button
        type="button"
        className={watching ? "btn-secondary btn-sm" : "btn-ghost btn-sm"}
        onClick={toggle}
        disabled={busy}
      >
        {watching ? "★ Watching" : "☆ Watch"}
      </button>
      {watchers.length > 0 && (
        <span className="hint ticket-watch-count">
          {watchers.length} watcher{watchers.length === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}
