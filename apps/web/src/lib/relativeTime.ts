const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 1000 * 60 * 60 * 24 * 365],
  ["month", 1000 * 60 * 60 * 24 * 30],
  ["week", 1000 * 60 * 60 * 24 * 7],
  ["day", 1000 * 60 * 60 * 24],
  ["hour", 1000 * 60 * 60],
  ["minute", 1000 * 60],
];

// numeric: "always" avoids Intl substituting "yesterday"/"tomorrow", which
// would break the " ago" stripping dueLabel() below does for the overdue case.
const formatter = new Intl.RelativeTimeFormat("en", { numeric: "always" });

/** "in 5 hours", "3 days ago", "just now" -- relative to the current time. */
export function relativeTime(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const absMs = Math.abs(diffMs);

  for (const [unit, unitMs] of UNITS) {
    if (absMs >= unitMs) {
      return formatter.format(Math.round(diffMs / unitMs), unit);
    }
  }
  return "just now";
}

export interface DueLabel {
  text: string;
  overdue: boolean;
}

/** Frames an SLA due date as "due in 5 hours" or "overdue by 2 hours". */
export function dueLabel(iso: string): DueLabel {
  const overdue = new Date(iso).getTime() < Date.now();
  return {
    text: overdue ? `overdue by ${relativeTime(iso).replace(/ ago$/, "")}` : `due ${relativeTime(iso)}`,
    overdue,
  };
}
