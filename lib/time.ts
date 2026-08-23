/**
 * time.ts - which calendar day does an entry belong to?
 *
 * This is a small file with an outsized effect. Serverless functions run in UTC,
 * the user eats in their own timezone, and "what did I have today" is a question
 * about their calendar, not the server's. Every day bucket in this project goes
 * through here.
 *
 * No date library: Intl is in the runtime and handles DST correctly, which is
 * the only hard part.
 */

/** YYYY-MM-DD for the given instant, in the given IANA timezone. */
export function dayIn(timezone: string, at: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which saves a manual reassembly.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** HH:MM local wall clock time. */
export function timeIn(timezone: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

/** Local hour 0-23. Used to decide fasted weigh-ins and meal slots. */
export function hourIn(timezone: string, at: Date = new Date()): number {
  return Number(timeIn(timezone, at).slice(0, 2));
}

/** 0 = Sunday ... 6 = Saturday, in the user's timezone. */
export function weekdayIn(timezone: string, at: Date = new Date()): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(at);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

/** Full weekday and date, for the prompt: "Sunday, 2026-08-23". */
export function dateLabel(timezone: string, at: Date = new Date()): string {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' }).format(at);
  return `${weekday}, ${dayIn(timezone, at)}`;
}

/** Shift a YYYY-MM-DD by n days. Pure string date arithmetic, DST-proof. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Whole days from a to b. Negative when b is before a. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Today minus n days, in the user's timezone. */
export function daysAgo(timezone: string, n: number, at: Date = new Date()): string {
  return addDays(dayIn(timezone, at), -n);
}

/** True when the string is a plausible YYYY-MM-DD. */
export function isDay(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
