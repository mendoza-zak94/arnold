import { describe, expect, it } from 'vitest';
import {
  ConfigError, age, heightCm, showDistance, showLength, showWeight, targetWeightKg,
  unitLabels, validate, withSettings,
} from '../lib/config';
import type { ArnoldConfig } from '../lib/config-types';

const valid: ArnoldConfig = {
  language: 'en',
  units: 'metric',
  timezone: 'Europe/Berlin',
  profile: { height: 183, birthYear: 1992, sex: 'male', activityFactor: 1.3 },
  goal: {
    direction: 'lose', targetWeight: 80, targetDate: '2026-12-24',
    weeklyRatePct: { min: 0.5, max: 1.0 }, dailyCalories: 'auto', proteinPerKg: 1.8,
  },
  trackers: {
    meals: true, weight: true, workouts: true, measurements: true, sleep: true,
    habits: [{ id: 'alcohol', label: 'Alcohol', unit: 'drinks', kcalPerUnit: 150 }],
  },
  coach: { enabled: true, weeklyReportWeekday: 0, minWeighInsPerWeek: 3, minLoggedDaysPerWeek: 4 },
  models: { classify: 'claude-sonnet-5', coach: 'claude-opus-5' },
};

const broken = (patch: Partial<ArnoldConfig>) => () => validate({ ...valid, ...patch } as ArnoldConfig);

describe('validate', () => {
  it('accepts a sane configuration', () => {
    expect(validate(valid)).toBe(valid);
  });

  it('rejects an invalid timezone with a fixable message', () => {
    expect(broken({ timezone: 'Berlin' })).toThrow(ConfigError);
    expect(broken({ timezone: 'Berlin' })).toThrow(/not a valid IANA timezone/);
  });

  it('rejects an implausible height', () => {
    expect(broken({ profile: { ...valid.profile, height: 18 } })).toThrow(/height/);
  });

  it('accepts an imperial height that would be nonsense as centimetres', () => {
    const imperial = { ...valid, units: 'imperial' as const, profile: { ...valid.profile, height: 72 } };
    expect(() => validate(imperial)).not.toThrow();
  });

  it('rejects an activity factor that has training baked into it', () => {
    expect(broken({ profile: { ...valid.profile, activityFactor: 3 } })).toThrow(/activityFactor/);
  });

  it('rejects a rate band that is the wrong way round', () => {
    expect(broken({ goal: { ...valid.goal, weeklyRatePct: { min: 1.5, max: 0.5 } } })).toThrow(/weeklyRatePct/);
  });

  it('rejects a badly formatted target date', () => {
    expect(broken({ goal: { ...valid.goal, targetDate: '24.12.2026' } })).toThrow(/targetDate/);
  });

  it('rejects duplicate habit ids', () => {
    expect(broken({
      trackers: {
        ...valid.trackers,
        habits: [
          { id: 'beer', label: 'Beer', unit: 'glasses' },
          { id: 'beer', label: 'Beer again', unit: 'glasses' },
        ],
      },
    })).toThrow(/used twice/);
  });

  it('rejects a habit id that would not survive a database round trip', () => {
    expect(broken({
      trackers: { ...valid.trackers, habits: [{ id: 'Red Wine', label: 'Wine', unit: 'glasses' }] },
    })).toThrow(/lowercase/);
  });

  it('collects several problems into one message', () => {
    let msg = '';
    try {
      validate({ ...valid, timezone: 'nope', profile: { ...valid.profile, activityFactor: 9 } });
    } catch (err) {
      msg = (err as Error).message;
    }
    expect(msg).toMatch(/2 problem/);
  });
});

describe('withSettings', () => {
  it('lets stored settings win over the file', () => {
    const merged = withSettings(valid, { height: 190, targetWeight: 75 });
    expect(merged.profile.height).toBe(190);
    expect(merged.goal.targetWeight).toBe(75);
  });

  it('keeps file values for keys that were not stored', () => {
    const merged = withSettings(valid, { height: 190 });
    expect(merged.goal.targetWeight).toBe(80);
    expect(merged.timezone).toBe('Europe/Berlin');
  });

  it('can store an explicit null to clear a target', () => {
    expect(withSettings(valid, { targetWeight: null }).goal.targetWeight).toBeNull();
  });

  it('returns the base untouched when there is nothing stored', () => {
    expect(withSettings(valid, null)).toBe(valid);
  });
});

describe('units', () => {
  const imperial: ArnoldConfig = { ...valid, units: 'imperial', profile: { ...valid.profile, height: 72 } };

  it('labels metric and imperial correctly', () => {
    expect(unitLabels(valid)).toEqual({ weight: 'kg', length: 'cm', distance: 'km' });
    expect(unitLabels(imperial)).toEqual({ weight: 'lb', length: 'in', distance: 'mi' });
  });

  it('converts height into centimetres for the formulas', () => {
    expect(heightCm(valid)).toBe(183);
    expect(heightCm(imperial)).toBeCloseTo(182.88, 2);
  });

  it('converts the goal weight into kilograms', () => {
    expect(targetWeightKg(valid)).toBe(80);
    expect(targetWeightKg({ ...imperial, goal: { ...valid.goal, targetWeight: 176 } })).toBeCloseTo(79.83, 1);
    expect(targetWeightKg({ ...valid, goal: { ...valid.goal, targetWeight: null } })).toBeNull();
  });

  it('displays stored metric values in the configured units', () => {
    expect(showWeight(80, valid)).toBe('80.0');
    expect(showWeight(80, imperial)).toBe('176.4');
    expect(showLength(92, imperial)).toBe('36.2');
    expect(showDistance(5, imperial)).toBe('3.11');
    expect(showWeight(null, valid)).toBe('?');
  });
});

describe('age', () => {
  it('derives the age from the birth year so it never goes stale', () => {
    expect(age(valid, new Date('2026-06-01T00:00:00Z'))).toBe(34);
  });
});
