export type ReportCadence = 'daily' | 'weekly' | 'monthly';

/** The next run time strictly after `from`, per cadence -- pure so the sweep's advancement logic is directly testable. */
export function nextRunAt(cadence: ReportCadence, from: Date): Date {
  const next = new Date(from);
  switch (cadence) {
    case 'daily':
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case 'weekly':
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case 'monthly':
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
  }
  return next;
}
