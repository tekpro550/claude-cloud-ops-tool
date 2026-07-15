import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import { getTenantCostSettings, updateTenantCostSettings } from "../../lib/costApiClient";
import type { CostRateDisplay, TenantCostSettings } from "../../types/cost";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function TenantCostSettingsAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [settings, setSettings] = useState<TenantCostSettings | null>(null);
  const [financialYearStartMonth, setFinancialYearStartMonth] = useState(1);
  const [costRateDisplay, setCostRateDisplay] = useState<CostRateDisplay>("list_price");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    getTenantCostSettings(tenantId).then((s) => {
      setSettings(s);
      setFinancialYearStartMonth(s.financial_year_start_month);
      setCostRateDisplay(s.cost_rate_display);
    });
  };

  useEffect(load, [tenantId]);

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaving(true);
    updateTenantCostSettings(tenantId, { financialYearStartMonth, costRateDisplay })
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to save cost settings"))
      .finally(() => setSaving(false));
  };

  if (!settings) return null;

  return (
    <div className="admin-entity">
      <h4>Tenant cost settings</h4>
      {error && <p className="error">{error}</p>}
      <form className="admin-form" onSubmit={handleSave}>
        <label>
          Financial year start month
          <select
            value={financialYearStartMonth}
            onChange={(e) => setFinancialYearStartMonth(Number(e.target.value))}
          >
            {MONTH_NAMES.map((label, index) => (
              <option key={label} value={index + 1}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rate display
          <select value={costRateDisplay} onChange={(e) => setCostRateDisplay(e.target.value as CostRateDisplay)}>
            <option value="list_price">List price</option>
            <option value="negotiated">Negotiated rate</option>
          </select>
        </label>
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </form>
    </div>
  );
}
