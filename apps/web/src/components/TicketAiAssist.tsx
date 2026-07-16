import { useEffect, useState } from "react";
import {
  getTicketAiStatus,
  summarizeTicket,
  suggestTicketReply,
} from "../lib/apiClient";

interface Props {
  tenantId: string;
  ticketId: string;
  // Called with a drafted reply (plain text) for the composer to pick up.
  onSuggestReply: (text: string) => void;
}

/**
 * AI assist toolbar for a ticket: summarize the thread and draft a suggested
 * reply. Hidden entirely when the backend reports AI assist is not configured
 * (no API key), so it never shows dead buttons.
 */
export default function TicketAiAssist({ tenantId, ticketId, onSuggestReply }: Props) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"summary" | "reply" | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTicketAiStatus(tenantId)
      .then((s) => setEnabled(s.enabled))
      .catch(() => setEnabled(false));
  }, [tenantId]);

  if (enabled !== true) return null;

  const handleSummarize = () => {
    setBusy("summary");
    setError(null);
    summarizeTicket(tenantId, ticketId)
      .then((r) => setSummary(r.result ?? "(no summary returned)"))
      .catch(() => setError("Couldn’t generate a summary."))
      .finally(() => setBusy(null));
  };

  const handleSuggest = () => {
    setBusy("reply");
    setError(null);
    suggestTicketReply(tenantId, ticketId)
      .then((r) => {
        if (r.result) onSuggestReply(r.result);
      })
      .catch(() => setError("Couldn’t draft a reply."))
      .finally(() => setBusy(null));
  };

  return (
    <div className="ai-assist">
      <div className="ai-assist-actions">
        <span className="ai-assist-label">✨ AI assist</span>
        <button type="button" className="btn-ghost btn-sm" onClick={handleSummarize} disabled={busy !== null}>
          {busy === "summary" ? "Summarizing…" : "Summarize"}
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={handleSuggest} disabled={busy !== null}>
          {busy === "reply" ? "Drafting…" : "Suggest reply"}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {summary && (
        <div className="ai-assist-summary">
          <div className="ai-assist-summary-head">
            <strong>Summary</strong>
            <button type="button" className="link-button" onClick={() => setSummary(null)}>
              Dismiss
            </button>
          </div>
          <p>{summary}</p>
        </div>
      )}
    </div>
  );
}
