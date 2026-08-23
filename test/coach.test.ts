import { describe, expect, it } from 'vitest';
import { commentTrigger, decide, strengthDirection, type SetLike } from '../lib/coach';
import type { ArnoldConfig } from '../lib/config-types';
import type { Adherence, TrendState } from '../lib/trend';

const config: ArnoldConfig = {
  language: 'en',
  units: 'metric',
  timezone: 'Europe/Berlin',
  profile: { height: 183, birthYear: 1992, sex: 'male', activityFactor: 1.3 },
  goal: {
    direction: 'lose',
    targetWeight: 80,
    targetDate: null,
    weeklyRatePct: { min: 0.5, max: 1.0 },
    dailyCalories: 'auto',
    proteinPerKg: 1.8,
  },
  trackers: {
    meals: true, weight: true, workouts: true, measurements: true, sleep: true,
    habits: [{ id: 'alcohol', label: 'Alcohol', unit: 'drinks', kcalPerUnit: 150, dailyLimit: 2 }],
  },
  coach: { enabled: true, weeklyReportWeekday: 0, minWeighInsPerWeek: 3, minLoggedDaysPerWeek: 4 },
  models: { classify: 'claude-sonnet-5', coach: 'claude-opus-5' },
};

const goodData: Adherence = { days: 7, loggedDays: 7, weighDays: 6, unclear: 0 };

const state = (ratePctWeek: number | null, trendKg = 85): TrendState => ({
  trendKg,
  rateKgWeek: ratePctWeek === null ? null : (ratePctWeek / 100) * trendKg,
  ratePctWeek,
  measureDays7: 6,
  measureDays: 20,
  spanDays: 20,
  lastDay: '2026-01-20',
  series: [],
});

describe('decide', () => {
  it('refuses to advise on thin data, whatever the rate says', () => {
    const r = decide({
      config,
      state: state(-2.0),
      adherence: { days: 7, loggedDays: 2, weighDays: 1, unclear: 0 },
      weeklyRates: [],
      strength: null,
    });
    expect(r.code).toBe('thin_data');
  });

  it('flags losing faster than the band allows', () => {
    const r = decide({ config, state: state(-1.4), adherence: goodData, weeklyRates: [], strength: null });
    expect(r.code).toBe('too_fast');
    expect(r.text).toMatch(/eat 100 to 200 kcal more/i);
  });

  it('ranks too_fast above a strength warning', () => {
    // Both are true here. Losing too fast is the cause, falling strength the
    // symptom, and the advice for both is "eat more" - so the cause wins.
    const strength = { exercises: [], falling: 3, warning: true };
    const r = decide({ config, state: state(-1.5), adherence: goodData, weeklyRates: [], strength });
    expect(r.code).toBe('too_fast');
  });

  it('warns on falling strength inside the rate band', () => {
    const strength = { exercises: [], falling: 3, warning: true };
    const r = decide({ config, state: state(-0.7), adherence: goodData, weeklyRates: [], strength });
    expect(r.code).toBe('strength_warning');
  });

  it('says stay the course inside the band', () => {
    const r = decide({ config, state: state(-0.7), adherence: goodData, weeklyRates: [], strength: null });
    expect(r.code).toBe('in_band');
  });

  it('waits three weeks before calling a stall', () => {
    const slow = state(-0.1);
    const twoWeeks = decide({ config, state: slow, adherence: goodData, weeklyRates: [-0.05, -0.05], strength: null });
    expect(twoWeeks.code).toBe('watching');

    const threeWeeks = decide({
      config, state: slow, adherence: goodData, weeklyRates: [-0.05, -0.05, -0.05], strength: null,
    });
    expect(threeWeeks.code).toBe('stalled');
    expect(threeWeeks.text).toMatch(/move more/i);
    expect(threeWeeks.text).not.toMatch(/eat less/i);
  });

  it('mirrors the logic when the goal is to gain', () => {
    const gaining = { ...config, goal: { ...config.goal, direction: 'gain' as const } };
    expect(decide({ config: gaining, state: state(1.5), adherence: goodData, weeklyRates: [], strength: null }).code)
      .toBe('too_fast');
    expect(decide({ config: gaining, state: state(0.7), adherence: goodData, weeklyRates: [], strength: null }).code)
      .toBe('in_band');
  });

  it('treats drift as fine when maintaining', () => {
    const maintaining = { ...config, goal: { ...config.goal, direction: 'maintain' as const } };
    expect(decide({ config: maintaining, state: state(0.2), adherence: goodData, weeklyRates: [], strength: null }).code)
      .toBe('in_band');
    expect(decide({ config: maintaining, state: state(-1.2), adherence: goodData, weeklyRates: [], strength: null }).code)
      .toBe('watching');
  });
});

describe('strengthDirection', () => {
  const sets = (day: string, exercise: string, reps: number, weight: number | null): SetLike =>
    ({ day, exercise, reps, weight_kg: weight });

  it('compares tonnage between the two most recent sessions', () => {
    const d = strengthDirection([
      sets('2026-01-10', 'bench press', 8, 70),
      sets('2026-01-17', 'bench press', 8, 75),
    ], '2026-01-20');
    expect(d.exercises[0].direction).toBe('up');
  });

  it('falls back to total reps for bodyweight work', () => {
    const d = strengthDirection([
      sets('2026-01-10', 'pull ups', 10, null),
      sets('2026-01-17', 'pull ups', 8, null),
    ], '2026-01-20');
    expect(d.exercises[0].direction).toBe('down');
  });

  it('ignores exercises last trained outside the window', () => {
    const d = strengthDirection([
      sets('2025-06-01', 'squat', 5, 100),
      sets('2025-06-08', 'squat', 5, 90),
    ], '2026-01-20');
    expect(d.exercises).toHaveLength(0);
  });

  it('needs three exercises and a falling majority before warning', () => {
    const two = strengthDirection([
      sets('2026-01-10', 'a', 10, 50), sets('2026-01-17', 'a', 8, 50),
      sets('2026-01-10', 'b', 10, 50), sets('2026-01-17', 'b', 8, 50),
    ], '2026-01-20');
    expect(two.falling).toBe(2);
    expect(two.warning).toBe(false);

    const three = strengthDirection([
      sets('2026-01-10', 'a', 10, 50), sets('2026-01-17', 'a', 8, 50),
      sets('2026-01-10', 'b', 10, 50), sets('2026-01-17', 'b', 8, 50),
      sets('2026-01-10', 'c', 10, 50), sets('2026-01-17', 'c', 8, 50),
    ], '2026-01-20');
    expect(three.warning).toBe(true);
  });

  it('skips exercises with only one session', () => {
    const d = strengthDirection([sets('2026-01-17', 'deadlift', 5, 120)], '2026-01-20');
    expect(d.exercises).toHaveLength(0);
  });
});

describe('commentTrigger', () => {
  const base = {
    config,
    loggedWeight: false,
    loggedMeasurement: false,
    loggedSets: false,
    state: state(-0.7),
    strength: null,
    balanceVsTarget: null,
    habitOverLimit: null,
  };

  it('stays silent when there is no reason', () => {
    expect(commentTrigger(base)).toBeNull();
  });

  it('stays silent when coaching is switched off', () => {
    const off = { ...base, config: { ...config, coach: { ...config.coach, enabled: false } }, loggedMeasurement: true };
    expect(commentTrigger(off)).toBeNull();
  });

  it('fires on a new tape measurement', () => {
    expect(commentTrigger({ ...base, loggedMeasurement: true })?.code).toBe('measurement');
  });

  it('fires when a weigh-in reveals too fast a loss', () => {
    expect(commentTrigger({ ...base, loggedWeight: true, state: state(-1.4) })?.code).toBe('too_fast');
  });

  it('does not fire on a weigh-in inside the band', () => {
    expect(commentTrigger({ ...base, loggedWeight: true })).toBeNull();
  });

  it('fires when a habit goes over its limit', () => {
    const t = commentTrigger({ ...base, habitOverLimit: { label: 'Alcohol', amount: 4, limit: 2 } });
    expect(t?.code).toBe('habit_limit');
    expect(t?.brief).toMatch(/no lecture/i);
  });

  it('fires when the day is well over target', () => {
    expect(commentTrigger({ ...base, balanceVsTarget: 400 })?.code).toBe('over_target');
  });

  it('tolerates being slightly over without saying anything', () => {
    expect(commentTrigger({ ...base, balanceVsTarget: 100 })).toBeNull();
  });
});
