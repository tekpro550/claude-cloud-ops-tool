import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createTicketTimeLog, deleteTicketTimeLog, listTicketTimeLogs } from "../lib/apiClient";
import type { TicketTimeLog } from "../types/ticket";

export default function TicketTimeLogs({ tenantId, ticketId }: { tenantId: string; ticketId: string }) {
  const [logs, setLogs] = useState<TicketTimeLog[]>([]);
  const [totalMinutes, setTotalMinutes] = useState(0);
  const [minutes, setMinutes] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => {
    listTicketTimeLogs(tenantId, ticketId).then((res) => {
      setLogs(res.items);
      setTotalMinutes(res.totalMinutes);
    });
  };

  useEffect(load, [tenantId, ticketId]);

  const handleAdd = (event: FormEvent) => {
    event.preventDefault();
    const parsed = Number(minutes);
    if (!parsed || parsed <= 0) return;
    setBusy(true);
    createTicketTimeLog(tenantId, ticketId, { minutes: parsed, note: note || undefined })
      .then(() => {
        setMinutes("");
        setNote("");
        load();
      })
      .finally(() => setBusy(false));
  };

  const remove = (logId: string) => {
    deleteTicketTimeLog(tenantId, ticketId, logId).then(load);
  };

  return (
    <div className="time-log-list">
      <p className="hint">Total logged: {totalMinutes} min</p>
      {logs.length === 0 && <p className="hint">No time logged yet.</p>}
      <ul>
        {logs.map((log) => (
          <li key={log.id}>
            <span>
              {log.minutes} min{log.note ? ` — ${log.note}` : ""}
            </span>
            <button type="button" className="link-button" onClick={() => remove(log.id)} aria-label={`Delete ${log.minutes} minute log`}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={handleAdd} className="time-log-form">
        <input type="number" min={1} placeholder="Minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        <input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="submit" disabled={busy}>
          Log time
        </button>
      </form>
    </div>
  );
}
