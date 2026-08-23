import { describe, expect, it } from 'vitest';
import { buildTool } from '../lib/schema';
import type { ArnoldConfig } from '../lib/config-types';
import { hasAction } from '../lib/classify';

const base: ArnoldConfig = {
  language: 'en',
  units: 'metric',
  timezone: 'Europe/Berlin',
  profile: { height: 180, birthYear: 1990, sex: 'male', activityFactor: 1.3 },
  goal: {
    direction: 'lose', targetWeight: 80, targetDate: null,
    weeklyRatePct: { min: 0.5, max: 1.0 }, dailyCalories: 'auto', proteinPerKg: 1.8,
  },
  trackers: {
    meals: true, weight: true, workouts: true, measurements: true, sleep: true,
    habits: [
      { id: 'alcohol', label: 'Alcohol', unit: 'drinks', kcalPerUnit: 150, dailyLimit: 2 },
      { id: 'cigarettes', label: 'Cigarettes', unit: 'cigarettes', dailyLimit: 0 },
    ],
  },
  coach: { enabled: true, weeklyReportWeekday: 0, minWeighInsPerWeek: 3, minLoggedDaysPerWeek: 4 },
  models: { classify: 'claude-sonnet-5', coach: 'claude-opus-5' },
};

const props = (c: ArnoldConfig) => buildTool(c).input_schema.properties as Record<string, Record<string, unknown>>;

describe('buildTool', () => {
  it('includes every enabled tracker', () => {
    const p = props(base);
    for (const key of ['meals', 'weight', 'workouts', 'measurements', 'sleep', 'habits']) {
      expect(p, `${key} should be in the schema`).toHaveProperty(key);
    }
  });

  it('drops a tracker that is switched off', () => {
    // The point of generating the schema: what is off cannot be booked at all,
    // not even by a model that decides to be helpful.
    const c = { ...base, trackers: { ...base.trackers, sleep: false, measurements: false } };
    const p = props(c);
    expect(p).not.toHaveProperty('sleep');
    expect(p).not.toHaveProperty('measurements');
    expect(p).toHaveProperty('meals');
  });

  it('turns configured habits into an enum', () => {
    const habits = props(base).habits as { items: { properties: { habit_id: { enum: string[] } } } };
    expect(habits.items.properties.habit_id.enum).toEqual(['alcohol', 'cigarettes']);
  });

  it('drops the habits field entirely when none are configured', () => {
    const c = { ...base, trackers: { ...base.trackers, habits: [] } };
    expect(props(c)).not.toHaveProperty('habits');
  });

  it('names each habit and its unit in the description', () => {
    const habits = props(base).habits as { description: string };
    expect(habits.description).toContain('Alcohol');
    expect(habits.description).toContain('drinks');
    expect(habits.description).toContain('cigarettes');
  });

  it('limits corrections to tables that exist in this configuration', () => {
    const c = { ...base, trackers: { ...base.trackers, sleep: false, habits: [] } };
    const corrections = props(c).corrections as { items: { properties: { table: { enum: string[] } } } };
    expect(corrections.items.properties.table.enum).not.toContain('sleep');
    expect(corrections.items.properties.table.enum).not.toContain('habit_entries');
    expect(corrections.items.properties.table.enum).toContain('meals');
  });

  it('always requires is_entry and nothing else', () => {
    expect(buildTool(base).input_schema.required).toEqual(['is_entry']);
  });

  it('keeps corrections, assumptions and settings available regardless of trackers', () => {
    const c = {
      ...base,
      trackers: { meals: false, weight: false, workouts: false, measurements: false, sleep: false, habits: [] },
    };
    const p = props(c);
    expect(p).toHaveProperty('corrections');
    expect(p).toHaveProperty('remember_assumption');
    expect(p).toHaveProperty('settings_update');
  });
});

describe('hasAction', () => {
  it('accepts a plain entry', () => {
    expect(hasAction({ is_entry: true })).toBe(true);
  });

  it('treats a correction as an action even when is_entry is false', () => {
    // "delete the duplicate" would otherwise fall through to the conversational
    // branch, which cannot write to the database.
    expect(hasAction({ is_entry: false, corrections: [{ table: 'meals', id: 1, action: 'delete' }] })).toBe(true);
  });

  it('treats a remembered assumption as an action', () => {
    expect(hasAction({ is_entry: false, remember_assumption: { keyword: 'mayo', meaning: 'light' } })).toBe(true);
  });

  it('treats a settings change as an action', () => {
    expect(hasAction({ is_entry: false, settings_update: { height: 183 } })).toBe(true);
  });

  it('rejects an empty settings object', () => {
    expect(hasAction({ is_entry: false, settings_update: {} })).toBe(false);
  });

  it('rejects a plain question', () => {
    expect(hasAction({ is_entry: false })).toBe(false);
    expect(hasAction(null)).toBe(false);
  });
});
