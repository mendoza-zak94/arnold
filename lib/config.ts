/**
 * config.ts - resolve the effective configuration.
 *
 * Three layers, later wins: the file (arnold.config.ts), the database
 * (settings table, changed from the chat), the environment (model overrides).
 * Validation happens once here so every other module can trust its input -
 * a wrong activityFactor should fail loudly at boot, not silently produce a
 * 400 kcal error in every daily balance.
 */

import fileConfig from '../arnold.config';
import type { ArnoldConfig, HabitConfig, StoredSettings } from './config-types';

export type { ArnoldConfig, HabitConfig, StoredSettings };

export class ConfigError extends Error {}

const CM_PER_INCH = 2.54;
const KG_PER_LB = 0.45359237;
const KM_PER_MILE = 1.609344;

/** Validates the file config. Throws with a fixable message, never guesses. */
export function validate(c: ArnoldConfig): ArnoldConfig {
  const problems: string[] = [];

  if (!c.language || typeof c.language !== 'string') problems.push('language must be a non-empty string');
  if (c.units !== 'metric' && c.units !== 'imperial') problems.push("units must be 'metric' or 'imperial'");
  if (!c.timezone) problems.push('timezone must be an IANA name like "Europe/Berlin"');
  else {
    try {
      new Intl.DateTimeFormat('en', { timeZone: c.timezone });
    } catch {
      problems.push(`timezone "${c.timezone}" is not a valid IANA timezone`);
    }
  }

  const p = c.profile;
  const hCm = c.units === 'imperial' ? toCm(p.height) : p.height;
  if (!(hCm > 50 && hCm < 260)) problems.push('profile.height looks wrong (expected 50-260 cm / 20-102 in)');
  const year = new Date().getUTCFullYear();
  if (!(p.birthYear > year - 120 && p.birthYear < year - 5)) problems.push('profile.birthYear looks wrong');
  if (p.sex !== 'male' && p.sex !== 'female') problems.push("profile.sex must be 'male' or 'female'");
  if (!(p.activityFactor >= 1.0 && p.activityFactor <= 2.5)) problems.push('profile.activityFactor must be between 1.0 and 2.5');

  const g = c.goal;
  if (!['lose', 'maintain', 'gain'].includes(g.direction)) problems.push("goal.direction must be 'lose', 'maintain' or 'gain'");
  if (g.targetWeight !== null && !(g.targetWeight > 20 && g.targetWeight < 900)) {
    problems.push('goal.targetWeight looks wrong');
  }
  if (g.targetDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(g.targetDate)) {
    problems.push('goal.targetDate must be YYYY-MM-DD or null');
  }
  if (!(g.weeklyRatePct.min > 0 && g.weeklyRatePct.max > g.weeklyRatePct.min && g.weeklyRatePct.max <= 2)) {
    problems.push('goal.weeklyRatePct must be 0 < min < max <= 2');
  }
  if (g.dailyCalories !== 'auto' && !(typeof g.dailyCalories === 'number' && g.dailyCalories > 800)) {
    problems.push("goal.dailyCalories must be 'auto' or a number above 800");
  }
  if (g.proteinPerKg !== null && !(g.proteinPerKg > 0 && g.proteinPerKg < 5)) {
    problems.push('goal.proteinPerKg must be null or between 0 and 5');
  }

  const seen = new Set<string>();
  for (const h of c.trackers.habits) {
    if (!/^[a-z0-9_]+$/.test(h.id)) problems.push(`habit id "${h.id}" must be lowercase letters, digits or underscores`);
    if (seen.has(h.id)) problems.push(`habit id "${h.id}" is used twice`);
    seen.add(h.id);
    if (!h.label || !h.unit) problems.push(`habit "${h.id}" needs a label and a unit`);
    if (h.kcalPerUnit != null && !(h.kcalPerUnit >= 0)) problems.push(`habit "${h.id}" has a negative kcalPerUnit`);
  }

  if (c.coach.weeklyReportWeekday !== null
    && !(Number.isInteger(c.coach.weeklyReportWeekday) && c.coach.weeklyReportWeekday >= 0 && c.coach.weeklyReportWeekday <= 6)) {
    problems.push('coach.weeklyReportWeekday must be 0-6 (0 = Sunday) or null');
  }

  if (problems.length) {
    throw new ConfigError(`arnold.config.ts has ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
  }
  return c;
}

/** Merge stored settings over the file config. Unknown keys are ignored. */
export function withSettings(base: ArnoldConfig, stored: StoredSettings | null): ArnoldConfig {
  if (!stored) return base;
  return {
    ...base,
    language: stored.language ?? base.language,
    timezone: stored.timezone ?? base.timezone,
    profile: {
      ...base.profile,
      height: stored.height ?? base.profile.height,
      birthYear: stored.birthYear ?? base.profile.birthYear,
      sex: stored.sex ?? base.profile.sex,
      activityFactor: stored.activityFactor ?? base.profile.activityFactor,
    },
    goal: {
      ...base.goal,
      targetWeight: stored.targetWeight !== undefined ? stored.targetWeight : base.goal.targetWeight,
      targetDate: stored.targetDate !== undefined ? stored.targetDate : base.goal.targetDate,
      dailyCalories: stored.dailyCalories ?? base.goal.dailyCalories,
    },
  };
}

/** The file config, validated. Throws on a broken config file. */
export function baseConfig(): ArnoldConfig {
  const c = validate(fileConfig);
  return {
    ...c,
    models: {
      classify: process.env.ARNOLD_MODEL || c.models.classify,
      coach: process.env.ARNOLD_COACH_MODEL || c.models.coach,
    },
  };
}

/** Age in years, derived so it never goes stale. */
export function age(c: ArnoldConfig, now = new Date()): number {
  return now.getUTCFullYear() - c.profile.birthYear;
}

// --- unit handling ----------------------------------------------------------
// Internally everything is metric. Imperial only exists at the edges: what the
// user says, and what Arnold writes back. One conversion point, not fifty.

export const toKg = (lb: number) => lb * KG_PER_LB;
export const toLb = (kg: number) => kg / KG_PER_LB;
export const toCm = (inch: number) => inch * CM_PER_INCH;
export const toInch = (cm: number) => cm / CM_PER_INCH;
export const toKm = (miles: number) => miles * KM_PER_MILE;
export const toMiles = (km: number) => km / KM_PER_MILE;

export interface UnitLabels {
  weight: string;
  length: string;
  distance: string;
}

export function unitLabels(c: ArnoldConfig): UnitLabels {
  return c.units === 'imperial'
    ? { weight: 'lb', length: 'in', distance: 'mi' }
    : { weight: 'kg', length: 'cm', distance: 'km' };
}

/** Display a stored (metric) weight in the user's units. */
export function showWeight(kg: number | null, c: ArnoldConfig, digits = 1): string {
  if (kg === null || !Number.isFinite(kg)) return '?';
  const v = c.units === 'imperial' ? toLb(kg) : kg;
  return v.toFixed(digits);
}

export function showLength(cm: number | null, c: ArnoldConfig, digits = 1): string {
  if (cm === null || !Number.isFinite(cm)) return '?';
  const v = c.units === 'imperial' ? toInch(cm) : cm;
  return v.toFixed(digits);
}

export function showDistance(km: number | null, c: ArnoldConfig, digits = 2): string {
  if (km === null || !Number.isFinite(km)) return '?';
  const v = c.units === 'imperial' ? toMiles(km) : km;
  return v.toFixed(digits);
}

/** The height the formulas need, in cm, whatever the user typed into the config. */
export function heightCm(c: ArnoldConfig): number {
  return c.units === 'imperial' ? toCm(c.profile.height) : c.profile.height;
}

/** The goal weight in kg, whatever the user typed into the config. */
export function targetWeightKg(c: ArnoldConfig): number | null {
  const t = c.goal.targetWeight;
  if (t === null) return null;
  return c.units === 'imperial' ? toKg(t) : t;
}
