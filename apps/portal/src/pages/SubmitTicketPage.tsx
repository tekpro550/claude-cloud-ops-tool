import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, submitTicket } from "../lib/apiClient";
import { useAuth } from "../lib/auth";
import { useTenant } from "../lib/tenant";

const PRIORITIES = ["low", "medium", "high", "urgent"];

export default function SubmitTicketPage() {
  const { tenantId } = useTenant();
  const { contact } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(contact?.name ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState("medium");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    submitTicket(tenantId, { name, email, subject, description, priority })
      .then(() => {
        setSubmitted(true);
        if (contact) {
          navigate("/tickets");
        }
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to submit ticket"))
      .finally(() => setSubmitting(false));
  };

  if (submitted && !contact) {
    return (
      <div className="submit-ticket-page">
        <h2>Ticket submitted</h2>
        <p>
          Thanks — we've received your request. To check its status later, <a href="/register">create an account</a>{" "}
          with the same email address.
        </p>
      </div>
    );
  }

  return (
    <div className="submit-ticket-page">
      <h2>Submit a ticket</h2>
      <p className="hint">No account required. Attachments aren't supported yet.</p>
      <form className="submit-ticket-form" onSubmit={handleSubmit}>
        <label>
          Your name
          <input value={name} onChange={(e) => setName(e.target.value)} required disabled={!!contact} />
        </label>
        <label>
          Your email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={!!contact}
          />
        </label>
        <label>
          Subject
          <input value={subject} onChange={(e) => setSubject(e.target.value)} required />
        </label>
        <label>
          Priority
          <select value={priority} onChange={(e) => setPriority(e.target.value)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          Description
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} required />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Submitting…" : "Submit ticket"}
        </button>
      </form>
    </div>
  );
}
