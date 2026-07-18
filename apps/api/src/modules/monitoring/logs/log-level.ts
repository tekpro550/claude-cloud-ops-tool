export const LOG_LEVELS = [
  'debug',
  'info',
  'warn',
  'error',
  'critical',
] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  critical: 4,
};

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && value in RANK;
}

export function levelAtLeast(level: LogLevel, min: LogLevel): boolean {
  return RANK[level] >= RANK[min];
}
