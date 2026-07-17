import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import {
  createNotificationTemplate,
  deleteNotificationTemplate,
  listNotificationTemplates,
} from "../../lib/monitoringApiClient";
import type { NotificationTemplate } from "../../types/monitoring";
import { useConfirm } from "../useConfirm";

const CHANNELS = ["email", "whatsapp", "voice", "in_app"] as const;

/** Renders with $VARIABLE substitution -- see EscalationSweepService.renderBody. Only alert.escalated is wired up as an event_type so far. */
export default function NotificationTemplatesAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [channel, setChannel] = useState<(typeof CHANNELS)[number]>("email");
  const [eventType, setEventType] = useState("alert.escalated");
  const [body, setBody] = useState("$MONITOR_NAME is $SEVERITY: $REASON (step $STEP_NUMBER)");
  const [isDefault, setIsDefault] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  const load = () => {
    listNotificationTemplates(tenantId).then(setTemplates);
  };

  useEffect(load, [tenantId]);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return;
    setError(null);
    createNotificationTemplate(tenantId, { channel, eventType, body, isDefault })
      .then(() => {
        setBody("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create template"));
  };

  const handleDelete = (id: string) => {
    deleteNotificationTemplate(tenantId, id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete template"));
  };

  return (
    <div className="admin-entity">
      <h4>Notification templates</h4>
      {error && <p className="error">{error}</p>}
      {templates.length === 0 && (
        <p className="hint">No custom templates yet — escalations use a built-in default message.</p>
      )}
      {templates.length > 0 && (
        <ul className="admin-list">
          {templates.map((t) => (
            <li key={t.id}>
              <span>
                <strong>
                  {t.channel} / {t.event_type}
                </strong>{" "}
                {t.is_default && <span className="hint">(default)</span>}
                <br />
                <span className="hint">{t.body}</span>
              </span>
              <span>
                <button
                  type="button"
                  className="link-button"
                  onClick={() =>
                    confirm({
                      title: "Delete notification template",
                      message: `Delete the ${t.channel} template for “${t.event_type}”? Escalations will fall back to the built-in default.`,
                      onConfirm: () => handleDelete(t.id),
                    })
                  }
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleCreate}>
        <select value={channel} onChange={(e) => setChannel(e.target.value as (typeof CHANNELS)[number])}>
          {CHANNELS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <input placeholder="Event type" value={eventType} onChange={(e) => setEventType(e.target.value)} required />
        <input
          placeholder="Body, e.g. $MONITOR_NAME is $SEVERITY"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          style={{ minWidth: "20rem" }}
          required
        />
        <label>
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> Default
        </label>
        <button type="submit">Add template</button>
      </form>
      {confirmDialog}
    </div>
  );
}
