import { useEffect, useState } from "react";
import { getNeedsAttention } from "../lib/apiClient";
import { useTenant } from "../lib/tenant";
import type { NeedsAttentionItem } from "../types/ticket";

/**
 * Persistent, generic "things this tenant should look at" banner (Sprint
 * 4.3). Deliberately dumb about what an item *means* -- it just renders
 * whatever /dashboard/needs-attention returns, so Modules 2 and 3 can add
 * their own item types to that feed later without this component changing.
 */
export default function NeedsAttentionBanner() {
  const { tenantId } = useTenant();
  const [items, setItems] = useState<NeedsAttentionItem[]>([]);

  useEffect(() => {
    if (!tenantId) {
      setItems([]);
      return;
    }
    let cancelled = false;
    getNeedsAttention(tenantId)
      .then((res) => {
        if (!cancelled) setItems(res.items);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  if (items.length === 0) return null;

  return (
    <div className="needs-attention-banner">
      {items.map((item) => (
        <span key={item.id} className={`needs-attention-item severity-${item.severity}`}>
          {item.message}
        </span>
      ))}
    </div>
  );
}
