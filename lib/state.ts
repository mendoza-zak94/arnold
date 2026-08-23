/**
 * state.ts - one place that assembles "where do things stand".
 *
 * The receipt, the coaching comment, the weekly report and any question you ask
 * all need the same picture: what went in today, what the day cost, where the
 * trend is, how consistent the logging has been. Computing that in four places
 * is how four slightly different answers to the same question appear.
 *
 * Everything here is read-only and pre-computed. The model never gets raw
 * database rows to do arithmetic on - it gets finished numbers and only has to
 * put them into sentences.
 */

import * as db from './db';
import type { ArnoldConfig } from './config-types';
import { age, baseConfig, heightCm, targetWeightKg, validate, withSettings } from './config';
import { dayIn, daysAgo } from './time';
import { adherence, trendState, weeklyRates, type Adherence, type TrendState } from './trend';
import { calorieTarget, dayBalance, fatEquivalentGrams, proteinTarget, type DayBalance } from './energy';
import { decide, strengthDirection, type Recommendation, type StrengthDirection } from './coach';

export interface HabitTotal {
  id: string;
  label: string;
  amount: number;
  unit: string;
  limit: number | null;
  kcal: number;
}

export interface State {
  config: ArnoldConfig;
  day: string;
  today: db.DayData;
  balance: DayBalance;
  trend: TrendState;
  adherence: Adherence;
  weeklyRates: (number | null)[];
  strength: StrengthDirection | null;
  recommendation: Recommendation;
  calorieTarget: number | null;
  proteinTarget: number | null;
  habitTotals: HabitTotal[];
  latestWeightKg: number | null;
}

/**
 * The config with the settings you changed from the chat applied.
 *
 * The merged result is validated again. Writes go through validateSettings, so
 * a bad value should never be in the table - but a row edited by hand in the
 * SQL editor would otherwise silently poison every calculation, and the file
 * config is a complete configuration on its own.
 */
export async function effectiveConfig(): Promise<ArnoldConfig> {
  const base = baseConfig();
  try {
    const merged = withSettings(base, await db.loadSettings());
    return validate(merged);
  } catch {
    // Either the settings table is unreachable or it contains something the
    // bounds reject. Both mean: fall back to the file rather than compute on it.
    return base;
  }
}

export async function loadState(c: ArnoldConfig, day?: string): Promise<State> {
  const target = day ?? dayIn(c.timezone);
  const since42 = daysAgo(c.timezone, 42);
  const since21 = daysAgo(c.timezone, 21);

  const [today, weighIns, meals, sets, latest] = await Promise.all([
    db.dayData(target),
    db.weightsSince(since42),
    db.mealsSince(daysAgo(c.timezone, 7)),
    db.setsSince(since21),
    db.latestWeight(),
  ]);

  const trend = trendState(weighIns, target);
  const adh = adherence(meals, weighIns, target);
  const rates = weeklyRates(weighIns, target);
  const strength = c.trackers.workouts ? strengthDirection(sets, target) : null;

  // Rounding to the trend rather than the last reading: a single weigh-in is
  // half a kilo of handling noise, and half a kilo is 50 kcal of BMR.
  const weightKg = trend.trendKg ?? latest?.weight_kg ?? null;

  const profile = weightKg === null ? null : {
    weightKg,
    heightCm: heightCm(c),
    age: age(c),
    sex: c.profile.sex,
    activityFactor: c.profile.activityFactor,
  };

  const habitTotals = habitTotalsFor(c, today.habits);
  const balance = dayBalance(profile, today.meals, today.workouts, today.habits);

  return {
    config: c,
    day: target,
    today,
    balance,
    trend,
    adherence: adh,
    weeklyRates: rates,
    strength,
    recommendation: decide({ config: c, state: trend, adherence: adh, weeklyRates: rates, strength }),
    calorieTarget: calorieTarget({
      expenditure: balance.expenditure,
      weightKg,
      direction: c.goal.direction,
      weeklyRatePct: c.goal.weeklyRatePct,
      configured: c.goal.dailyCalories,
    }),
    proteinTarget: proteinTarget(weightKg, c.goal.proteinPerKg),
    habitTotals,
    latestWeightKg: weightKg,
  };
}

export function habitTotalsFor(c: ArnoldConfig, rows: db.HabitRow[]): HabitTotal[] {
  return c.trackers.habits.map((h) => {
    const mine = rows.filter((r) => r.habit_id === h.id);
    return {
      id: h.id,
      label: h.label,
      unit: h.unit,
      limit: h.dailyLimit ?? null,
      amount: mine.reduce((a, r) => a + r.amount, 0),
      kcal: Math.round(mine.reduce((a, r) => a + (r.kcal ?? 0), 0)),
    };
  });
}

/** The first habit that went over its daily limit today, if any. */
export function habitOverLimit(totals: HabitTotal[]): { label: string; amount: number; limit: number } | null {
  for (const h of totals) {
    if (h.limit !== null && h.amount > h.limit) {
      return { label: h.label, amount: h.amount, limit: h.limit };
    }
  }
  return null;
}

/**
 * The state as text for a model. Numbers only, already computed, with the units
 * spelled out - a model that has to derive "how am I doing" from raw rows will
 * eventually derive it differently than the receipt did.
 */
export function stateBrief(s: State): string {
  const c = s.config;
  const b = s.balance;
  const t = s.trend;
  const lines: string[] = [
    `Day: ${s.day}`,
    `Eaten: ${b.intakeKcal} kcal (meals ${b.mealKcal}, other ${b.habitKcal}), protein ${b.proteinG} g`,
    b.expenditure === null
      ? 'Expenditure: unknown, no weight on file'
      : `Expenditure: ${b.expenditure} kcal (BMR ${b.bmr}, daily activity to ${b.baseline}, workouts net ${b.workoutNet})`,
    b.balance === null
      ? 'Balance: unknown'
      : `Balance: ${b.balance} kcal (negative = deficit), roughly `
        + `${Math.abs(fatEquivalentGrams(b.balance) ?? 0)} g of body fat at 7000 kcal/kg`,
    s.calorieTarget === null ? 'Target: unknown' : `Calorie target: ${s.calorieTarget} kcal`,
    s.proteinTarget === null ? '' : `Protein target: ${s.proteinTarget} g`,
    t.trendKg === null
      ? 'Trend weight: not enough fasted weigh-ins yet'
      : `Trend weight: ${t.trendKg} kg, rate ${t.rateKgWeek ?? '?'} kg/week (${t.ratePctWeek ?? '?'} %), `
        + `${t.measureDays} measurement days, ${t.measureDays7} in the last 7`,
    `Logging: ${s.adherence.loggedDays}/${s.adherence.days} days with food, `
      + `${s.adherence.weighDays}/${s.adherence.days} days weighed`,
    `Goal: ${c.goal.direction}`
      + (targetWeightKg(c) !== null ? `, target ${targetWeightKg(c)?.toFixed(1)} kg` : '')
      + (c.goal.targetDate ? ` by ${c.goal.targetDate}` : '')
      + `, safe band ${c.goal.weeklyRatePct.min}-${c.goal.weeklyRatePct.max} %/week`,
    `Rule engine says: ${s.recommendation.code} - ${s.recommendation.text}`,
  ];

  if (s.strength?.exercises.length) {
    lines.push(`Strength: ${s.strength.exercises.map((e) => `${e.exercise} ${e.direction}`).join(', ')}`
      + (s.strength.warning ? ' (WARNING: majority falling)' : ''));
  }

  const habits = s.habitTotals.filter((h) => h.amount > 0);
  if (habits.length) {
    lines.push(`Habits today: ${habits.map((h) => `${h.label} ${h.amount} ${h.unit}`
      + (h.limit !== null ? ` (limit ${h.limit})` : '')).join(', ')}`);
  }

  if (s.today.meals.length) {
    lines.push(`Meals today: ${s.today.meals.map((m) => `${m.description} ${Math.round(m.kcal ?? 0)} kcal`).join('; ')}`);
  }
  if (s.today.workouts.length) {
    lines.push(`Training today: ${s.today.workouts.map((w) => w.description).join('; ')}`);
  }

  return lines.filter(Boolean).join('\n');
}
