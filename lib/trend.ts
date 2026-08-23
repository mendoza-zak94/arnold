/**
 * trend.ts - smoothed trend weight instead of comparing two single readings.
 *
 * Four weigh-ins within 35 minutes can differ by half a kilo - not from water
 * or time of day, but from a phone in your hand and different clothes. Handling
 * is the biggest error source in body weight measurement, bigger than anything
 * the scale itself gets wrong. So no single reading ever drives a decision here.
 *
 * The method is the one trend-weight apps converge on: an exponentially weighted
 * moving average over daily fasted averages. Each measurement day pulls the
 * trend only ALPHA of the way towards itself, outliers fade, and gaps (a week
 * of camping) do not move the trend at all.
 *
 * The rate comes from a linear regression over the trend points of the last two
 * weeks rather than the difference between two points, because a regression
 * carries calendar time correctly even when measurement days are missing.
 *
 * Pure functions over plain arrays: no database, no clock, no config. That is
 * what makes this the easiest part of the system to trust.
 */

import { daysBetween } from './time';

/** How much a new measurement day pulls the trend. 0.3 is roughly a week of memory. */
export const ALPHA = 0.3;
/** Calendar span the rate regression looks back over. */
export const RATE_WINDOW_DAYS = 14;
/** Energy in one kilogram of body fat. The classic 7000 kcal figure. */
export const KCAL_PER_KG_FAT = 7000;

export interface WeighIn {
  day: string;
  weight_kg: number;
  /** null means "we do not know when this was measured" and is NOT counted. */
  fasted: boolean | null;
}

export interface TrendPoint {
  day: string;
  /** the day's raw average */
  kg: number;
  /** the smoothed value */
  trend: number;
}

export interface TrendState {
  trendKg: number | null;
  rateKgWeek: number | null;
  ratePctWeek: number | null;
  /** measurement days within the last 7 calendar days */
  measureDays7: number;
  measureDays: number;
  spanDays: number;
  lastDay: string | null;
  series: TrendPoint[];
}

/**
 * Daily averages of fasted weigh-ins, oldest first.
 *
 * Strictly fasted === true. A weight added later ("I was 84 yesterday") has an
 * unknown measurement time, and one such entry is enough to drag the EWMA, the
 * rate and every decision that hangs off them. Unknown is not the same as
 * fasted, so it stays out.
 */
export function dailyAverages(weighIns: WeighIn[]): { day: string; kg: number }[] {
  const byDay = new Map<string, number[]>();
  for (const w of weighIns) {
    if (w.fasted !== true) continue;
    if (!Number.isFinite(w.weight_kg)) continue;
    const list = byDay.get(w.day) ?? [];
    list.push(w.weight_kg);
    byDay.set(w.day, list);
  }
  return [...byDay.entries()]
    .map(([day, vals]) => ({ day, kg: vals.reduce((a, b) => a + b, 0) / vals.length }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** EWMA over the daily averages. */
export function series(weighIns: WeighIn[]): TrendPoint[] {
  let t: number | null = null;
  return dailyAverages(weighIns).map(({ day, kg }) => {
    t = t === null ? kg : t + ALPHA * (kg - t);
    return { day, kg: round(kg, 2), trend: round(t, 3) };
  });
}

/** Slope in kg/day from a least squares fit over {dayIndex, trend}. */
export function slopePerDay(points: TrendPoint[]): number | null {
  if (points.length < 2) return null;
  const x0 = points[0].day;
  const xs = points.map((p) => daysBetween(x0, p.day));
  const ys = points.map((p) => p.trend);
  const n = xs.length;
  const mx = xs.reduce((a, v) => a + v, 0) / n;
  const my = ys.reduce((a, v) => a + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}

/**
 * Current state. The rate stays null below four measurement days or a span
 * under six days - anything less is noise wearing a number's clothes.
 */
export function trendState(weighIns: WeighIn[], today: string): TrendState {
  const s = series(weighIns);
  if (!s.length) {
    return {
      trendKg: null, rateKgWeek: null, ratePctWeek: null,
      measureDays7: 0, measureDays: 0, spanDays: 0, lastDay: null, series: s,
    };
  }
  const last = s[s.length - 1];
  const window = s.filter((p) => daysBetween(p.day, last.day) <= RATE_WINDOW_DAYS);
  const span = window.length ? daysBetween(window[0].day, last.day) : 0;

  let rateKgWeek: number | null = null;
  if (window.length >= 4 && span >= 6) {
    const m = slopePerDay(window);
    rateKgWeek = m === null ? null : round(m * 7, 2);
  }

  return {
    trendKg: round(last.trend, 2),
    rateKgWeek,
    ratePctWeek: rateKgWeek === null ? null : round((rateKgWeek / last.trend) * 100, 2),
    measureDays7: s.filter((p) => daysBetween(p.day, today) < 7 && daysBetween(p.day, today) >= 0).length,
    measureDays: s.length,
    spanDays: s.length >= 2 ? daysBetween(s[0].day, last.day) : 0,
    lastDay: last.day,
    series: s,
  };
}

/**
 * Rates of the last n weeks, most recent first. A single week cannot be told
 * apart from noise, which is why the "nothing is moving" rule needs three of
 * them before it reacts.
 */
export function weeklyRates(weighIns: WeighIn[], today: string, n = 3): (number | null)[] {
  const s = series(weighIns);
  const out: (number | null)[] = [];
  for (let w = 0; w < n; w += 1) {
    const from = daysBetween('1970-01-01', today) - (w + 1) * 7;
    const to = daysBetween('1970-01-01', today) - w * 7;
    const points = s.filter((p) => {
      const idx = daysBetween('1970-01-01', p.day);
      return idx > from && idx <= to;
    });
    const m = points.length >= 3 ? slopePerDay(points) : null;
    out.push(m === null ? null : round(m * 7, 2));
  }
  return out;
}

/** Linear projection of the trend onto a target day. null when it cannot be known. */
export function project(state: TrendState, targetDay: string): number | null {
  if (state.trendKg === null || state.rateKgWeek === null || !state.lastDay) return null;
  const weeks = daysBetween(state.lastDay, targetDay) / 7;
  if (weeks < 0) return null;
  return round(state.trendKg + state.rateKgWeek * weeks, 1);
}

/** The weekly rate needed from today to still hit a target. */
export function requiredRate(state: TrendState, targetKg: number, today: string, targetDay: string): number | null {
  if (state.trendKg === null) return null;
  const days = daysBetween(today, targetDay);
  if (days <= 0) return null;
  return round((targetKg - state.trendKg) / (days / 7), 2);
}

export interface Adherence {
  days: number;
  loggedDays: number;
  weighDays: number;
  unclear: number;
}

/**
 * How consistently the last `days` days were logged. This gates advice: no
 * adjustment on top of missing data, because the data, not the body, is what
 * changed.
 */
export function adherence(
  meals: { day: string; status: string }[],
  weighIns: WeighIn[],
  today: string,
  days = 7,
): Adherence {
  const from = daysBetween('1970-01-01', today) - (days - 1);
  const inWindow = (d: string) => daysBetween('1970-01-01', d) >= from && d <= today;
  const loggedDays = new Set(meals.filter((m) => inWindow(m.day)).map((m) => m.day)).size;
  const weighDays = new Set(
    weighIns.filter((w) => w.fasted === true && inWindow(w.day)).map((w) => w.day),
  ).size;
  return {
    days,
    loggedDays,
    weighDays,
    unclear: meals.filter((m) => inWindow(m.day) && m.status === 'unclear').length,
  };
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
