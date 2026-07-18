import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../lib/apiClient";
import {
  createCommitment,
  deleteCommitment,
  dismissCommitmentRecommendation,
  getAccountsSummary,
  getCommitmentCoverage,
  listCommitmentRecommendations,
  listCommitments,
} from "../lib/costApiClient";
import { useTenant } from "../lib/tenant";
import type {
  AccountCostSummary,
  Commitment,
  CommitmentCoverageResult,
  CommitmentKind,
  CommitmentPaymentOption,
  CommitmentRecommendation,
} from "../types/cost";

const KIND_LABEL: Record<CommitmentKind, string> = {
  reserved_instance: "Reserved Instance",
  savings_plan: "Savings Plan",
};

function money(n: number | string | null): string {
  if (n === null) return "—";
  return `$${Number(n).toFixed(2)}`;
}

function pct(n: number | null): string {
  if (n === null) return "—";
  return `${n.toFixed(1)}%`;
}

/** RI / Savings Plan recommendations (with coverage/utilization for owned commitments) -- competitive-parity plan task 4. */
export default function CommitmentsPage() {
  const { tenantId } = useTenant();
  const [accounts, setAccounts] = useState<AccountCostSummary[]>([]);
  const [commitments, setCommitments] = useState<Commitment[]>([]);
  const [recommendations, setRecommendations] = useState<CommitmentRecommendation[]>([]);
  const [coverageById, setCoverageById] = useState<Record<string, CommitmentCoverageResult>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [cloudCredentialId, setCloudCredentialId] = useState("");
  const [kind, setKind] = useState<CommitmentKind>("savings_plan");
  const [service, setService] = useState("");
  const [region, setRegion] = useState("");
  const [termMonths, setTermMonths] = useState<12 | 36>(12);
  const [paymentOption, setPaymentOption] = useState<CommitmentPaymentOption>("no_upfront");
  const [hourlyCommitment, setHourlyCommitment] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const load = () => {
    if (!tenantId) return;
    getAccountsSummary(tenantId).then(setAccounts);
    listCommitmentRecommendations(tenantId).then(setRecommendations);
    listCommitments(tenantId).then((rows) => {
      setCommitments(rows);
      rows.forEach((c) => {
        getCommitmentCoverage(tenantId, c.id)
          .then((result) => setCoverageById((prev) => ({ ...prev, [c.id]: result })))
          .catch(() => undefined);
      });
    });
  };

  useEffect(load, [tenantId]);

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to view commitments.</p>;
  }

  const accountLabel = (id: string) => accounts.find((a) => a.cloudCredentialId === id)?.label ?? id;

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    if (!cloudCredentialId || !service.trim() || !hourlyCommitment || !startDate || !endDate) return;
    setError(null);
    createCommitment(tenantId, {
      cloudCredentialId,
      kind,
      service: service.trim(),
      region: region.trim() || undefined,
      termMonths,
      paymentOption,
      hourlyCommitment: Number(hourlyCommitment),
      startDate,
      endDate,
    })
      .then(() => {
        setService("");
        setRegion("");
        setHourlyCommitment("");
        setStartDate("");
        setEndDate("");
        load();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to create commitment"));
  };

  const handleDelete = (id: string) => {
    setBusyId(id);
    deleteCommitment(tenantId, id)
      .then(load)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to delete commitment"))
      .finally(() => setBusyId(null));
  };

  const handleDismissRecommendation = (id: string) => {
    setBusyId(id);
    dismissCommitmentRecommendation(tenantId, id)
      .then(load)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to dismiss recommendation"))
      .finally(() => setBusyId(null));
  };

  return (
    <div>
      <h2>Commitments</h2>
      <p className="hint">
        Reserved Instance / Savings Plan recommendations from trailing on-demand usage, and coverage/utilization for
        commitments you already own.
      </p>
      {error && <p className="error">{error}</p>}

      <section>
        <h3>Recommendations</h3>
        {recommendations.length === 0 && <p className="hint">No recommendations yet — needs at least 14 days of usage history per scope.</p>}
        {recommendations.map((r) => (
          <div key={r.id} className="alert-card">
            <div className="alert-card-header">
              <span>
                <span className="badge">{KIND_LABEL[r.kind]}</span> {accountLabel(r.cloud_credential_id)} ·{" "}
                {r.service}
                {r.region ? ` (${r.region})` : ""}
              </span>
              <span>
                <button
                  type="button"
                  className="btn-sm btn-ghost"
                  disabled={busyId === r.id}
                  onClick={() => handleDismissRecommendation(r.id)}
                >
                  Dismiss
                </button>
              </span>
            </div>
            <span className="hint">
              Commit ~{money(r.recommended_hourly_commitment)}/hr · est. savings {money(r.estimated_monthly_savings)}
              /mo
              {r.break_even_months !== null && ` · breaks even in ~${Number(r.break_even_months).toFixed(1)} months`}
              {" · based on "}
              {r.based_on_days} days
            </span>
          </div>
        ))}
      </section>

      <section>
        <h3>Owned commitments</h3>
        {commitments.length === 0 && <p className="hint">No commitments recorded yet.</p>}
        {commitments.map((c) => {
          const result = coverageById[c.id];
          return (
            <div key={c.id} className="alert-card">
              <div className="alert-card-header">
                <span>
                  <span className="badge">{KIND_LABEL[c.kind]}</span> {accountLabel(c.cloud_credential_id)} ·{" "}
                  {c.service}
                  {c.region ? ` (${c.region})` : ""} · {money(c.hourly_commitment)}/hr
                </span>
                <span>
                  <button
                    type="button"
                    className="btn-sm btn-ghost"
                    disabled={busyId === c.id}
                    onClick={() => handleDelete(c.id)}
                  >
                    Remove
                  </button>
                </span>
              </div>
              <span className="hint">
                {c.start_date} → {c.end_date} ({c.term_months}mo, {c.payment_option.replace("_", " ")})
              </span>
              {result?.coverage && result.utilization && (
                <div className="hint">
                  Coverage {pct(result.coverage.coveragePct)} of spend · Utilization {pct(result.utilization.utilizationPct)}{" "}
                  of commitment
                  {result.utilization.wastedAmount > 0.01 && ` · ${money(result.utilization.wastedAmount)} wasted`}
                </div>
              )}
              {result?.reason && <div className="hint">{result.reason}</div>}
            </div>
          );
        })}
      </section>

      <section>
        <h3>Record a commitment</h3>
        <form className="admin-form" onSubmit={handleCreate}>
          <select value={cloudCredentialId} onChange={(e) => setCloudCredentialId(e.target.value)} required>
            <option value="">Cloud account…</option>
            {accounts.map((a) => (
              <option key={a.cloudCredentialId} value={a.cloudCredentialId}>
                {a.label}
              </option>
            ))}
          </select>
          <select value={kind} onChange={(e) => setKind(e.target.value as CommitmentKind)}>
            <option value="savings_plan">Savings Plan</option>
            <option value="reserved_instance">Reserved Instance</option>
          </select>
          <input placeholder="Service (e.g. EC2)" value={service} onChange={(e) => setService(e.target.value)} required />
          <input placeholder="Region (optional)" value={region} onChange={(e) => setRegion(e.target.value)} />
          <select value={termMonths} onChange={(e) => setTermMonths(Number(e.target.value) as 12 | 36)}>
            <option value={12}>12 months</option>
            <option value={36}>36 months</option>
          </select>
          <select value={paymentOption} onChange={(e) => setPaymentOption(e.target.value as CommitmentPaymentOption)}>
            <option value="no_upfront">No upfront</option>
            <option value="partial_upfront">Partial upfront</option>
            <option value="all_upfront">All upfront</option>
          </select>
          <input
            type="number"
            step="0.01"
            min="0.01"
            placeholder="Hourly commitment ($)"
            value={hourlyCommitment}
            onChange={(e) => setHourlyCommitment(e.target.value)}
            required
          />
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
          <button type="submit">Add commitment</button>
        </form>
      </section>
    </div>
  );
}
