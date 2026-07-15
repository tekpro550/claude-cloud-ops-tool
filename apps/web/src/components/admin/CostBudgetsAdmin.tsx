import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../../lib/apiClient";
import { createCostBudget, deleteCostBudget, listCostBudgets } from "../../lib/costApiClient";
import { listCloudCredentials } from "../../lib/monitoringApiClient";
import type { CostBudget, NotifyChannel } from "../../types/cost";
import type { CloudCredential } from "../../types/monitoring";

const NOTIFY_CHANNELS: (NotifyChannel | "")[] = ["", "email", "whatsapp", "voice", "in_app"];

export default function CostBudgetsAdmin({ tenantId, onChange }: { tenantId: string; onChange?: () => void }) {
  const [budgets, setBudgets] = useState<CostBudget[]>([]);
  const [credentials, setCredentials] = useState<CloudCredential[]>([]);
  const [name, setName] = useState("");
  const [cloudCredentialId, setCloudCredentialId] = useState("");
  const [monthlyBudgetAmount, setMonthlyBudgetAmount] = useState("");
  const [notifyChannel, setNotifyChannel] = useState<NotifyChannel | "">("");
  const [notifyRecipient, setNotifyRecipient] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    listCostBudgets(tenantId).then(setBudgets);
    listCloudCredentials(tenantId).then(setCredentials);
  };

  useEffect(load, [tenantId]);

  const credentialLabelById = new Map(credentials.map((c) => [c.id, c.label]));

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setError(null);
    createCostBudget(tenantId, {
      name,
      cloudCredentialId: cloudCredentialId || undefined,
      monthlyBudgetAmount: monthlyBudgetAmount ? Number(monthlyBudgetAmount) : undefined,
      notifyChannel: notifyChannel || undefined,
      notifyRecipient: notifyRecipient || undefined,
    })
      .then(() => {
        setName("");
        setCloudCredentialId("");
        setMonthlyBudgetAmount("");
        setNotifyChannel("");
        setNotifyRecipient("");
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create cost budget"));
  };

  const handleDelete = (id: string) => {
    deleteCostBudget(tenantId, id)
      .then(() => {
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete cost budget"));
  };

  return (
    <div className="admin-entity">
      <h4>Cost budgets</h4>
      {error && <p className="error">{error}</p>}
      {budgets.length === 0 && <p className="hint">No cost budgets yet.</p>}
      {budgets.length > 0 && (
        <ul className="admin-list">
          {budgets.map((b) => (
            <li key={b.id}>
              <span>
                <strong>{b.name}</strong>{" "}
                <span className="hint">
                  ({b.cloud_credential_id ? credentialLabelById.get(b.cloud_credential_id) ?? "unknown account" : "all accounts"})
                  {b.monthly_budget_amount !== null ? ` · $${Number(b.monthly_budget_amount).toFixed(2)}/mo cap` : " · pace-only"}
                  {b.notify_channel ? ` · notifies via ${b.notify_channel}` : ""}
                </span>
              </span>
              <span>
                <button type="button" className="link-button" onClick={() => handleDelete(b.id)}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <form className="admin-form" onSubmit={handleCreate}>
        <input placeholder="Budget name" value={name} onChange={(e) => setName(e.target.value)} required />
        <select value={cloudCredentialId} onChange={(e) => setCloudCredentialId(e.target.value)}>
          <option value="">All accounts</option>
          {credentials.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          placeholder="Monthly cap ($, optional)"
          type="number"
          min="0"
          step="0.01"
          value={monthlyBudgetAmount}
          onChange={(e) => setMonthlyBudgetAmount(e.target.value)}
        />
        <select value={notifyChannel} onChange={(e) => setNotifyChannel(e.target.value as NotifyChannel | "")}>
          {NOTIFY_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {c || "No notifications"}
            </option>
          ))}
        </select>
        {notifyChannel && (
          <input
            placeholder="Notify recipient"
            value={notifyRecipient}
            onChange={(e) => setNotifyRecipient(e.target.value)}
          />
        )}
        <button type="submit">Create budget</button>
      </form>
    </div>
  );
}
