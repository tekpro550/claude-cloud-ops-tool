/**
 * Normalizes a provider line item's cost-allocation tags into a flat
 * string->string map suitable for the cost_line_items.tags jsonb column.
 *
 * Providers expose tags in different shapes:
 *  - an explicit `tags` map on the line item (our normalized form)
 *  - AWS Cost Explorer TAG group keys arrive as `resourceTags`/`tags`
 *  - Azure exports carry them under `tags` in the raw row
 * We accept a loose record and keep only string keys with scalar values,
 * coercing numbers/booleans to strings and dropping anything empty so the
 * stored map is always clean to GROUP BY.
 */
export function normalizeAllocationTags(
  source: Record<string, unknown> | undefined | null,
): Record<string, string> {
  if (!source || typeof source !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const key = rawKey.trim();
    if (!key) continue;
    if (rawValue === null || rawValue === undefined) continue;
    if (
      typeof rawValue === 'string' ||
      typeof rawValue === 'number' ||
      typeof rawValue === 'boolean'
    ) {
      const value = String(rawValue).trim();
      if (value) out[key] = value;
    }
  }
  return out;
}
