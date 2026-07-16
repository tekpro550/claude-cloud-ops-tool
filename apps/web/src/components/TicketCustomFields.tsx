import { useEffect, useState } from "react";
import { listCustomFields, type CustomFieldDef } from "../lib/apiClient";

interface Props {
  tenantId: string;
  values: Record<string, unknown>;
  disabled?: boolean;
  // Called with a single {key: value} change; the caller PATCHes the ticket.
  onChange: (key: string, value: unknown) => void;
}

/**
 * Renders the tenant's active custom fields as inputs bound to the ticket's
 * stored values. Each edit fires onChange for that one field; the parent
 * persists it via updateTicket({ customFields: { key: value } }) (merge
 * semantics on the server).
 */
export default function TicketCustomFields({ tenantId, values, disabled, onChange }: Props) {
  const [defs, setDefs] = useState<CustomFieldDef[]>([]);

  useEffect(() => {
    listCustomFields(tenantId)
      .then((all) => setDefs(all.filter((d) => d.is_active)))
      .catch(() => {});
  }, [tenantId]);

  if (defs.length === 0) return null;

  return (
    <>
      {defs.map((def) => {
        const value = values?.[def.key];
        const label = (
          <>
            {def.label}
            {def.is_required && <span className="custom-field-required"> *</span>}
          </>
        );
        if (def.field_type === "checkbox") {
          return (
            <label key={def.id} className="custom-field-checkbox">
              <input
                type="checkbox"
                checked={value === true}
                disabled={disabled}
                onChange={(e) => onChange(def.key, e.target.checked)}
              />
              {label}
            </label>
          );
        }
        if (def.field_type === "dropdown") {
          return (
            <label key={def.id}>
              {label}
              <select
                value={value != null ? String(value) : ""}
                disabled={disabled}
                onChange={(e) => onChange(def.key, e.target.value)}
              >
                <option value="">—</option>
                {def.options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
          );
        }
        const inputType = def.field_type === "number" ? "number" : def.field_type === "date" ? "date" : "text";
        return (
          <label key={def.id}>
            {label}
            <input
              type={inputType}
              value={value != null ? String(value) : ""}
              disabled={disabled}
              onBlur={(e) => onChange(def.key, e.target.value)}
              onChange={(e) => onChange(def.key, e.target.value)}
            />
          </label>
        );
      })}
    </>
  );
}
