import type { MonitorCheck } from "../lib/monitoringApiClient";

/**
 * Site24x7-style uptime history strip: one colored block per recent check,
 * oldest to newest left-to-right. This is the single most recognizable
 * piece of a real uptime monitoring UI -- a status badge alone only shows
 * "right now"; this shows the recent pattern (a blip vs. a sustained
 * outage) at a glance, which is what the fleet/resource views were missing.
 */
export default function UptimeHistoryBar({ checks, slots = 30 }: { checks: MonitorCheck[]; slots?: number }) {
  const padded: (MonitorCheck | null)[] = [
    ...Array(Math.max(0, slots - checks.length)).fill(null),
    ...checks.slice(-slots),
  ];

  return (
    <div className="uptime-history-bar" role="img" aria-label={`Last ${checks.length} checks`}>
      {padded.map((check, i) => (
        <span
          key={i}
          className={`uptime-history-block${check ? ` uptime-history-block-${check.status}` : " uptime-history-block-empty"}`}
          title={check ? `${new Date(check.checked_at).toLocaleString()}: ${check.status}` : undefined}
        />
      ))}
    </div>
  );
}
