/**
 * Business-hours-aware SLA math. When an SLA policy is business_hours_only,
 * the clock only advances during the tenant's configured working window, so
 * a Friday-evening ticket with a "2 business hours" first-response target is
 * due Monday morning, not Saturday.
 */
export interface BusinessHours {
  /** Minutes from local midnight the working day starts, e.g. 540 = 09:00. */
  startMinute: number;
  /** Minutes from local midnight the working day ends, e.g. 1020 = 17:00. */
  endMinute: number;
  /** Working weekdays, 0 = Sunday .. 6 = Saturday, e.g. [1,2,3,4,5]. */
  days: number[];
  /** IANA timezone the window is expressed in, e.g. 'Asia/Kolkata'. */
  timezone: string;
}

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  startMinute: 9 * 60,
  endMinute: 17 * 60,
  days: [1, 2, 3, 4, 5],
  timezone: 'UTC',
};

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  weekday: number; // 0=Sun..6=Sat
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Wall-clock components of a UTC instant in the given timezone. */
function zonedParts(instant: Date, timezone: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = dtf.formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  let hour = Number(get('hour'));
  // Intl can emit '24' for midnight with hour12:false; normalize to 0.
  if (hour === 24) hour = 0;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/**
 * The UTC instant for a given wall-clock time in a timezone. Resolves the
 * zone offset at that instant (handling DST) by measuring the delta between
 * the naive-UTC interpretation and what the zone actually shows, applied
 * twice so a value that lands on a DST transition still converges.
 */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  minutesIntoDay: number,
  timezone: string,
): Date {
  const hour = Math.floor(minutesIntoDay / 60);
  const minute = minutesIntoDay % 60;
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let guess = new Date(naiveUtc);
  for (let i = 0; i < 2; i += 1) {
    const zoned = zonedParts(guess, timezone);
    const zonedAsUtc = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      0,
      0,
    );
    const offset = zonedAsUtc - guess.getTime();
    guess = new Date(naiveUtc - offset);
  }
  return guess;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Adds `minutesToAdd` business minutes to `anchor`, counting only minutes
 * inside the working window on working days, in the configured timezone.
 */
export function addBusinessMinutes(
  anchor: Date,
  minutesToAdd: number,
  hours: BusinessHours,
): Date {
  const windowLength = hours.endMinute - hours.startMinute;
  if (windowLength <= 0 || hours.days.length === 0 || minutesToAdd <= 0) {
    // Misconfigured or nothing to add -- fall back to flat 24/7 so a bad
    // config can never produce a due date before the anchor.
    return new Date(anchor.getTime() + Math.max(0, minutesToAdd) * 60_000);
  }

  let remaining = minutesToAdd;
  const isWorkingDay = (weekday: number) => hours.days.includes(weekday);

  // Position the cursor at the first business minute at or after the anchor.
  let cursor = zonedParts(anchor, hours.timezone);
  let cursorMinuteOfDay = cursor.hour * 60 + cursor.minute;

  const advanceToNextWorkingDayStart = () => {
    // Jump to the next calendar day's start-of-window, then skip non-working
    // days. Uses a UTC instant near local noon to step days safely across DST.
    let probe = zonedTimeToUtc(
      cursor.year,
      cursor.month,
      cursor.day,
      12 * 60,
      hours.timezone,
    );
    do {
      probe = new Date(probe.getTime() + DAY_MS);
      cursor = zonedParts(probe, hours.timezone);
    } while (!isWorkingDay(cursor.weekday));
    cursorMinuteOfDay = hours.startMinute;
  };

  if (!isWorkingDay(cursor.weekday) || cursorMinuteOfDay >= hours.endMinute) {
    advanceToNextWorkingDayStart();
  } else if (cursorMinuteOfDay < hours.startMinute) {
    cursorMinuteOfDay = hours.startMinute;
  }

  // Consume business minutes day by day.
  for (;;) {
    const availableToday = hours.endMinute - cursorMinuteOfDay;
    if (remaining <= availableToday) {
      const endMinuteOfDay = cursorMinuteOfDay + remaining;
      return zonedTimeToUtc(
        cursor.year,
        cursor.month,
        cursor.day,
        endMinuteOfDay,
        hours.timezone,
      );
    }
    remaining -= availableToday;
    advanceToNextWorkingDayStart();
  }
}
