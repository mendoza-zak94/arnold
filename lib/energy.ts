/**
 * energy.ts - the other half of the balance: what the day cost.
 *
 * "2,096 kcal eaten" says nothing until you know whether the day cost 2,400 or
 * 3,000. The calculation:
 *
 *   BMR (Mifflin-St Jeor, from the most recent weight)
 *   x activityFactor   everything except training: desk, errands, housework
 *   + workouts NET     logged workout calories minus the resting burn that
 *                      would have happened during that same hour anyway
 *
 * That last subtraction is where these calculations usually go wrong. An hour of
 * strength training at 420 kcal contains roughly 77 kcal you would have burned
 * sitting on the sofa. Count the gross number and every session is counted
 * twice, and the deficit looks bigger than it is.
 *
 * Nothing is invented: without a weight there is no number, there is null. A
 * made-up figure in an energy balance is worse than a missing one, because you
 * cannot see that it is wrong.
 */

import { KCAL_PER_KG_FAT } from './trend';
import type { HabitConfig, Sex } from './config-types';

export { KCAL_PER_KG_FAT };

export interface EnergyProfile {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
  activityFactor: number;
}

export interface WorkoutLike {
  duration_min: number | null;
  kcal: number | null;
  kind?: string | null;
  description?: string | null;
  distance_km?: number | null;
}

export interface MealLike {
  kcal: number | null;
  protein_g: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
}

export interface HabitLike {
  habit_id: string;
  amount: number;
  kcal: number | null;
}

/** Mifflin-St Jeor. The most accurate of the common estimators. */
export function bmr(p: EnergyProfile): number | null {
  if (!Number.isFinite(p.weightKg) || p.weightKg <= 0) return null;
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
  return Math.round(base + (p.sex === 'male' ? 5 : -161));
}

export interface DayBalance {
  /** what went in, including habit calories such as alcohol */
  intakeKcal: number;
  mealKcal: number;
  habitKcal: number;
  proteinG: number;
  /** what went out */
  bmr: number | null;
  baseline: number | null;
  workoutGross: number;
  workoutMinutes: number;
  workoutCount: number;
  restShare: number | null;
  workoutNet: number | null;
  expenditure: number | null;
  /** intake minus expenditure. Negative = deficit. null without a weight. */
  balance: number | null;
}

export function dayBalance(
  profile: EnergyProfile | null,
  meals: MealLike[],
  workouts: WorkoutLike[],
  habits: HabitLike[] = [],
): DayBalance {
  const mealKcal = sum(meals.map((m) => m.kcal));
  const habitKcal = sum(habits.map((h) => h.kcal));
  const proteinG = sum(meals.map((m) => m.protein_g));
  const workoutGross = sum(workouts.map((w) => w.kcal));
  const workoutMinutes = sum(workouts.map((w) => w.duration_min));

  const base = {
    intakeKcal: Math.round(mealKcal + habitKcal),
    mealKcal: Math.round(mealKcal),
    habitKcal: Math.round(habitKcal),
    proteinG: Math.round(proteinG),
    workoutGross: Math.round(workoutGross),
    workoutMinutes,
    workoutCount: workouts.length,
  };

  const b = profile ? bmr(profile) : null;
  if (!profile || b === null) {
    return {
      ...base, bmr: null, baseline: null, restShare: null, workoutNet: null,
      expenditure: null, balance: null,
    };
  }

  const baseline = Math.round(b * profile.activityFactor);
  const restShare = Math.round((b / 1440) * workoutMinutes);
  const workoutNet = Math.max(0, Math.round(base.workoutGross - restShare));
  const expenditure = baseline + workoutNet;

  return {
    ...base,
    bmr: b,
    baseline,
    restShare,
    workoutNet,
    expenditure,
    balance: base.intakeKcal - expenditure,
  };
}

/**
 * The daily calorie target.
 *
 * 'auto' turns the goal into a number: the middle of the safe rate band, applied
 * to the current weight, converted into a daily deficit or surplus, subtracted
 * from what the day actually costs. It therefore moves with your weight instead
 * of being a figure you once wrote down at a heavier bodyweight.
 */
export function calorieTarget(opts: {
  expenditure: number | null;
  weightKg: number | null;
  direction: 'lose' | 'maintain' | 'gain';
  weeklyRatePct: { min: number; max: number };
  configured: number | 'auto';
}): number | null {
  if (opts.configured !== 'auto') return opts.configured;
  if (opts.expenditure === null || opts.weightKg === null) return null;
  if (opts.direction === 'maintain') return opts.expenditure;

  const midPct = (opts.weeklyRatePct.min + opts.weeklyRatePct.max) / 2;
  const kgPerWeek = (opts.weightKg * midPct) / 100;
  const dailyDelta = (kgPerWeek * KCAL_PER_KG_FAT) / 7;
  const target = opts.direction === 'lose'
    ? opts.expenditure - dailyDelta
    : opts.expenditure + dailyDelta;

  // Never suggest starving. Below the basal rate the body is not the thing
  // you are cutting any more.
  return Math.round(Math.max(target, 1200));
}

export function proteinTarget(weightKg: number | null, perKg: number | null): number | null {
  if (weightKg === null || perKg === null) return null;
  return Math.round(weightKg * perKg);
}

/**
 * Fallback calories for a workout the model could not estimate.
 *
 * Deliberately narrow. The distance formula (1 kcal per kg of body weight per
 * km) holds for RUNNING only - applied blindly to "30 km on the bike" it would
 * claim 2,600 instead of roughly 900 kcal. Otherwise per minute: 7 kcal for
 * strength and cardio, 4 for walking and everyday movement. Without a duration
 * and without a running distance it stays null, and Arnold asks.
 */
export function estimateWorkoutKcal(
  w: WorkoutLike,
  weightKg: number | null,
): number | null {
  const runLike = /\b(run|running|jog|jogging|lauf|joggen)\b/i.test(String(w.description ?? ''));
  if (runLike && Number.isFinite(w.distance_km) && (w.distance_km as number) > 0 && weightKg) {
    return Math.round((w.distance_km as number) * weightKg);
  }
  if (Number.isFinite(w.duration_min) && (w.duration_min as number) > 0) {
    return Math.round((w.duration_min as number) * (w.kind === 'daily' ? 4 : 7));
  }
  return null;
}

/** Net calories of a single session: gross minus the resting burn of that time. */
export function netWorkoutKcal(kcal: number | null, minutes: number | null, basal: number | null): number | null {
  if (!Number.isFinite(kcal) || !Number.isFinite(minutes) || (minutes as number) <= 0 || basal === null) return null;
  return Math.max(0, Math.round((kcal as number) - (basal / 1440) * (minutes as number)));
}

/** What a calorie balance is worth in body fat. Roughly 7,000 kcal per kg. */
export function fatEquivalentGrams(balance: number | null): number | null {
  if (balance === null || !Number.isFinite(balance)) return null;
  return Math.round((-balance / KCAL_PER_KG_FAT) * 1000);
}

/** Calories a habit entry contributes, if the habit is configured to carry any. */
export function habitKcal(habit: HabitConfig | undefined, amount: number): number | null {
  if (!habit || habit.kcalPerUnit == null) return null;
  return Math.round(habit.kcalPerUnit * amount);
}

function sum(values: (number | null | undefined)[]): number {
  return values.reduce<number>((a, v) => a + (Number.isFinite(v) ? (v as number) : 0), 0);
}
