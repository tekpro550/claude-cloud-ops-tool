import { useEffect, useState } from "react";
import {
  getCostAllocation,
  listCostTagKeys,
  type CostAllocation as CostAllocationData,
} from "../lib/costApiClient";

function formatMoney(value: number): string {
  return `$${Number(value).toFixed(2)}`;
}

/**
 * Tag-based cost allocation (CloudSpend showback): pick a cost-allocation tag
 * key and see this month's spend broken down by that tag's values, with
 * untagged spend called out explicitly so the parts reconcile to the whole.
 */
export default function CostAllocation({ tenantId }: { tenantId: string }) {
  const [tagKeys, setTagKeys] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [data, setData] = useState<CostAllocationData | null>(null);

  useEffect(() => {
    listCostTagKeys(tenantId)
      .then((keys) => {
        setTagKeys(keys);
        setSelectedKey((prev) => prev || keys[0] || "");
      })
      .catch(() => {});
  }, [tenantId]);

  useEffect(() => {
    if (!selectedKey) {
      setData(null);
      return;
    }
    getCostAllocation(tenantId, selectedKey)
      .then(setData)
      .catch(() => setData(null));
  }, [tenantId, selectedKey]);

  // No tags in use yet -- keep the dashboard uncluttered rather than showing
  // an empty control.
  if (tagKeys.length === 0) return null;

  const maxAmount = data && data.rows.length > 0 ? data.rows[0].amount : 0;

  return (
    <>
      <div className="cost-allocation-header">
        <h3>Cost allocation</h3>
        <label className="cost-allocation-picker">
          Group by tag
          <select value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)}>
            {tagKeys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      </div>
      {data && data.rows.length > 0 ? (
        <ul className="cost-allocation-list">
          {data.rows.map((row) => {
            const pct = data.total > 0 ? (row.amount / data.total) * 100 : 0;
            const barPct = maxAmount > 0 ? (row.amount / maxAmount) * 100 : 0;
            const untagged = row.tagValue === "(untagged)";
            return (
              <li key={row.tagValue} className="cost-allocation-row">
                <span className={`cost-allocation-value${untagged ? " is-untagged" : ""}`}>
                  {row.tagValue}
                </span>
                <span className="cost-allocation-bar-track">
                  <span
                    className="cost-allocation-bar"
                    style={{ width: `${barPct}%` }}
                  />
                </span>
                <span className="cost-allocation-amount">{formatMoney(row.amount)}</span>
                <span className="hint cost-allocation-pct">{pct.toFixed(0)}%</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="hint">No spend recorded for this tag yet.</p>
      )}
    </>
  );
}
