/**
 * config-types.ts - the shape of arnold.config.ts.
 *
 * Kept in its own file so the config can import types without pulling in any
 * runtime code, and so scripts/ can read the same contract.
 */

export type Units = 'metric' | 'imperial';
export type Sex = 'male' | 'female';
export type GoalDirection = 'lose' | 'maintain' | 'gain';
export type HabitGoal = 'less' | 'more' | 'track';

export interface HabitConfig {
  /** Stable lowercase key. Stored in the database - renaming it orphans history. */
  id: string;
  /** Display name in replies. */
  label: string;
  /** What a single unit is: "drinks", "cigarettes", "glasses". */
  unit: string;
  /** If set, entries count into the daily calorie balance. */
  kcalPerUnit?: number | null;
  /** Arnold mentions it once per day when you cross this. */
  dailyLimit?: number | null;
  /** Direction for the weekly report. Default 'track'. */
  goal?: HabitGoal;
}

export interface ProfileConfig {
  /** cm when units = metric, inches when units = imperial. */
  height: number;
  birthYear: number;
  sex: Sex;
  activityFactor: number;
}

export interface GoalConfig {
  direction: GoalDirection;
  /** kg when units = metric, lb when units = imperial. */
  targetWeight: number | null;
  targetDate: string | null;
  weeklyRatePct: { min: number; max: number };
  dailyCalories: number | 'auto';
  proteinPerKg: number | null;
}

export interface TrackerConfig {
  meals: boolean;
  weight: boolean;
  workouts: boolean;
  measurements: boolean;
  sleep: boolean;
  habits: HabitConfig[];
}

export interface CoachConfig {
  enabled: boolean;
  weeklyReportWeekday: number | null;
  minWeighInsPerWeek: number;
  minLoggedDaysPerWeek: number;
}

export interface ModelConfig {
  classify: string;
  coach: string;
}

export interface ArnoldConfig {
  language: string;
  units: Units;
  timezone: string;
  profile: ProfileConfig;
  goal: GoalConfig;
  trackers: TrackerConfig;
  coach: CoachConfig;
  models: ModelConfig;
}

/**
 * Settings that can be changed from the chat and are stored in the database.
 * They override the file for the same keys. Everything else stays file-only,
 * because a bot that can rewrite its own tracker list from a chat message is a
 * bot you cannot reason about.
 */
export interface StoredSettings {
  height?: number;
  birthYear?: number;
  sex?: Sex;
  activityFactor?: number;
  targetWeight?: number | null;
  targetDate?: string | null;
  dailyCalories?: number | 'auto';
  language?: string;
  timezone?: string;
}

export const STORED_SETTING_KEYS: (keyof StoredSettings)[] = [
  'height',
  'birthYear',
  'sex',
  'activityFactor',
  'targetWeight',
  'targetDate',
  'dailyCalories',
  'language',
  'timezone',
];
