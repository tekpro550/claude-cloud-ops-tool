import { useEffect, useState } from "react";
import { getSetupStatus } from "../lib/apiClient";
import { useTenant } from "../lib/tenant";
import type { SetupStatus } from "../types/ticket";

export default function AdminPage() {
  const { tenantId } = useTenant();
  const [status, setStatus] = useState<SetupStatus | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    getSetupStatus(tenantId).then(setStatus);
  }, [tenantId]);

  if (!tenantId) {
    return <p className="hint">Set a tenant id above to view admin settings.</p>;
  }

  if (!status) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <h2>Admin settings</h2>
      <p className="hint">
        Setup {status.complete ? "complete" : `${status.completedCount} of ${status.totalCount} steps complete`}
      </p>
      <ul className="setup-checklist">
        {status.items.map((item) => (
          <li key={item.key} className={item.complete ? "setup-complete" : "setup-incomplete"}>
            <span className="setup-icon" aria-hidden="true">
              {item.complete ? "✓" : "○"}
            </span>
            {item.label}
            {item.count > 0 && <span className="hint"> ({item.count})</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
