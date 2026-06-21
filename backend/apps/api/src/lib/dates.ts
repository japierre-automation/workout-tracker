/** Format a Postgres `date`/timestamp (returned as a UTC `Date`) as `YYYY-MM-DD`. */
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse a `YYYY-MM-DD` string into a UTC-midnight `Date` for a Postgres `date` column. */
export function dateOnly(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}
