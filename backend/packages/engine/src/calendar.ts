import { EngineError } from './errors.js';
import type { Weekday } from './types.js';

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse a `YYYY-MM-DD` calendar date into a UTC-noon epoch. Using noon (rather
 * than midnight) keeps day arithmetic immune to DST edges entirely.
 */
function toUtcNoon(date: string): number {
  if (!DATE_RE.test(date)) throw new EngineError(`invalid date string: ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const ts = Date.UTC(y, m - 1, d, 12, 0, 0, 0);
  if (Number.isNaN(ts)) throw new EngineError(`invalid date string: ${date}`);
  return ts;
}

function format(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** ISO weekday (0 = Monday … 6 = Sunday) of a UTC timestamp. */
function isoWeekday(ts: number): Weekday {
  // JS getUTCDay(): 0 = Sunday … 6 = Saturday. Shift so Monday = 0.
  return (((new Date(ts).getUTCDay() + 6) % 7) as Weekday);
}

/** ISO weekday (0 = Monday … 6 = Sunday) of a `YYYY-MM-DD` calendar date. */
export function weekdayOf(date: string): Weekday {
  return isoWeekday(toUtcNoon(date));
}

/** Add (or subtract) whole days to a `YYYY-MM-DD` date. */
export function addDays(date: string, days: number): string {
  return format(toUtcNoon(date) + days * DAY_MS);
}

/** First calendar date >= `startDate` that falls on `weekday`. */
export function firstOccurrence(startDate: string, weekday: Weekday): string {
  const start = toUtcNoon(startDate);
  const delta = (weekday - isoWeekday(start) + 7) % 7;
  return format(start + delta * DAY_MS);
}

/** Date of occurrence `index` (0-based): firstOccurrence + index * 7 days. */
export function dateForOccurrence(startDate: string, weekday: Weekday, index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new EngineError(`occurrence index must be a non-negative integer: ${index}`);
  }
  const first = toUtcNoon(firstOccurrence(startDate, weekday));
  return format(first + index * 7 * DAY_MS);
}

/**
 * Inverse of `dateForOccurrence`: the occurrence index a date corresponds to, or
 * `null` if the date is before the first occurrence or not on `weekday`.
 */
export function occurrenceIndexFor(startDate: string, weekday: Weekday, date: string): number | null {
  const target = toUtcNoon(date);
  if (isoWeekday(target) !== weekday) return null;
  const first = toUtcNoon(firstOccurrence(startDate, weekday));
  if (target < first) return null;
  return Math.round((target - first) / (7 * DAY_MS));
}

/** Highest occurrence index whose date is <= `today`; -1 if none has elapsed yet. */
export function lastElapsedIndex(startDate: string, weekday: Weekday, today: string): number {
  const t = toUtcNoon(today);
  const first = toUtcNoon(firstOccurrence(startDate, weekday));
  if (t < first) return -1;
  return Math.floor((t - first) / (7 * DAY_MS));
}
