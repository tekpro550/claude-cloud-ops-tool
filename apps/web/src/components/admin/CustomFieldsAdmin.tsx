import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  ApiError,
  createCustomField,
  deleteCustomField,
  listCustomFields,
  updateCustomField,
  type CustomFieldDef,
  type CustomFieldType,
} from "../../lib/apiClient";
import { useConfirm } from "../useConfirm";

const FIELD_TYPES: CustomFieldType[] = ["text", "number", "dropdown", "checkbox", "date"];

/**
 * Admin CRUD for ticket custom fields (Freshdesk parity). Definitions here
 * drive the dynamic inputs rendered in the ticket properties panel.
 */
export default function CustomFieldsAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [fields, setFields] = useState<CustomFieldDef[]>([]);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldType>("text");
  const [optionsText, setOptionsText] = useState("");
  const [isRequired, setIsRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  const load = () => {
    listCustomFields(tenantId).then(setFields).catch(() => {});
  };
  useEffect(load, [tenantId]);

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const options = fieldType === "dropdown"
      ? optionsText.split(",").map((o) => o.trim()).filter(Boolean)
      : undefined;
    createCustomField(tenantId, { key, label, fieldType, options, isRequired })
      .then(() => {
        setKey("");
        setLabel("");
        setOptionsText("");
        setIsRequired(false);
        setFieldType("text");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create custom field"))
      .finally(() => setBusy(false));
  };

  const toggleActive = (f: CustomFieldDef) => {
    updateCustomField(tenantId, f.id, { isActive: !f.is_active }).then(load).catch(() => {});
  };

  const remove = (f: CustomFieldDef) => {
    deleteCustomField(tenantId, f.id).then(load).catch(() => {});
  };

  return (
    <div className="admin-entity">
      <h4>Custom fields</h4>
      <p className="hint">Extra ticket properties agents fill in — rendered on every ticket.</p>
      {error && <p className="error">{error}</p>}
      <ul className="custom-field-list">
        {fields.map((f) => (
          <li key={f.id} className="custom-field-item">
            <span className="custom-field-label">{f.label}</span>
            <code className="custom-field-key">{f.key}</code>
            <span className="badge">{f.field_type}</span>
            {f.is_required && <span className="badge status-breached">required</span>}
            {!f.is_active && <span className="hint">inactive</span>}
            <button type="button" className="btn-ghost btn-sm" onClick={() => toggleActive(f)}>
              {f.is_active ? "Deactivate" : "Activate"}
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() =>
                confirm({
                  title: "Delete custom field",
                  message: `Delete the custom field “${f.label}”? Values stored on tickets for it will no longer be shown.`,
                  onConfirm: () => remove(f),
                })
              }
            >
              Delete
            </button>
          </li>
        ))}
        {fields.length === 0 && <li className="hint">No custom fields yet.</li>}
      </ul>
      <form className="custom-field-form" onSubmit={handleCreate}>
        <input placeholder="key (e.g. cost_center)" value={key} onChange={(e) => setKey(e.target.value)} required />
        <input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} required />
        <select value={fieldType} onChange={(e) => setFieldType(e.target.value as CustomFieldType)}>
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        {fieldType === "dropdown" && (
          <input placeholder="Options (comma-separated)" value={optionsText} onChange={(e) => setOptionsText(e.target.value)} />
        )}
        <label className="inline-check">
          <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} /> Required
        </label>
        <button type="submit" className="btn-primary btn-sm" disabled={busy}>Add field</button>
      </form>
      {confirmDialog}
    </div>
  );
}
