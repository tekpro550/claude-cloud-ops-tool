import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, getBusinessHours, updateBusinessHours } from "../../lib/apiClient";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A short, common list; the backend accepts any valid IANA zone.
const TIMEZONES = [
  "UTC",
  "Asia/Kolkata",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Singapore",
  "Asia/Dubai",
  "Australia/Sydney",
];

function minuteToTime(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeToMinute(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

export default function BusinessHoursAdmin({
  tenantId,
  onChange,
}: {
  tenantId: string;
  onChange?: () => void;
}) {
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [timezone, setTimezone] = useState("UTC");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = () => {
    getBusinessHours(tenantId)
      .then((bh) => {
        setStart(minuteToTime(bh.startMinute));
        setEnd(minuteToTime(bh.endMinute));
        setDays(bh.days);
        setTimezone(bh.timezone);
      })
      .catch(() => {
        // Non-fatal: the panel just shows its defaults until the tenant is set.
      });
  };

  useEffect(load, [tenantId]);

  const toggleDay = (day: number) => {
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  };

  const handleSave = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    updateBusinessHours(tenantId, {
      startMinute: timeToMinute(start),
      endMinute: timeToMinute(end),
      days,
      timezone,
    })
      .then(() => {
        setSaved(true);
        load();
        onChange?.();
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to save business hours"))
      .finally(() => setSaving(false));
  };

  return (
    <div className="admin-entity">
      <h4>Business hours</h4>
      <p className="hint">
        Working window used by SLA policies marked “business hours only” — the SLA clock only advances during these hours.
      </p>
      {error && <p className="error">{error}</p>}
      <form className="admin-form" onSubmit={handleSave}>
        <div className="admin-form-row">
          <label className="hint">
            From <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="hint">
            to <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <div className="business-hours-days">
          {DAY_LABELS.map((label, day) => (
            <button
              key={day}
              type="button"
              className={`business-hours-day${days.includes(day) ? " business-hours-day-active" : ""}`}
              onClick={() => toggleDay(day)}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="hint">
          Timezone{" "}
          <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {(TIMEZONES.includes(timezone) ? TIMEZONES : [timezone, ...TIMEZONES]).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save business hours"}
        </button>
        {saved && <span className="hint"> Saved.</span>}
      </form>
    </div>
  );
}
