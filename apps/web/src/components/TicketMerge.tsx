import { useState } from "react";
import type { FormEvent } from "react";
import {
  ApiError,
  getTicketByNumber,
  mergeTickets,
} from "../lib/apiClient";
import type { Ticket } from "../types/ticket";

interface Props {
  tenantId: string;
  ticket: Ticket;
  onMerged: (updated: Ticket) => void;
}

/**
 * Fold duplicate tickets into this one. The agent enters the duplicate ticket
 * numbers; we resolve each to its id and call the merge endpoint, which carries
 * their conversations over and closes them.
 */
export default function TicketMerge({ tenantId, ticket, onMerged }: Props) {
  const [numbersText, setNumbersText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const handleMerge = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setDone(null);
    const numbers = numbersText
      .split(",")
      .map((n) => parseInt(n.trim().replace(/^#/, ""), 10))
      .filter((n) => Number.isFinite(n));
    if (numbers.length === 0) {
      setError("Enter one or more ticket numbers to merge in.");
      return;
    }
    setBusy(true);
    try {
      const sources = await Promise.all(
        numbers.map((n) => getTicketByNumber(tenantId, n)),
      );
      const updated = await mergeTickets(
        tenantId,
        ticket.id,
        sources.map((s) => s.id),
      );
      setNumbersText("");
      setDone(`Merged ${sources.length} ticket(s) in.`);
      onMerged(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Merge failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="ticket-merge" onSubmit={handleMerge}>
      <p className="hint">Fold duplicate tickets into this one — their replies move here and they're closed.</p>
      <div className="ticket-merge-row">
        <input
          type="text"
          placeholder="Duplicate #s, e.g. 1042, 1050"
          value={numbersText}
          onChange={(e) => setNumbersText(e.target.value)}
        />
        <button type="submit" className="btn-secondary btn-sm" disabled={busy}>
          Merge in
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {done && <p className="hint">{done}</p>}
    </form>
  );
}
