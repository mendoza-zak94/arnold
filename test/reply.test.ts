import { describe, expect, it } from 'vitest';
import { buildReceipt } from '../lib/reply';
import { splitMessage } from '../lib/telegram';
import { slotFromHour, sumItems } from '../lib/record';
import type { ArnoldConfig } from '../lib/config-types';
import type { RecordResult } from '../lib/record';
import type { DayBalance } from '../lib/energy';
import type { TrendState } from '../lib/trend';

const config: ArnoldConfig = {
  language: 'en',
  units: 'metric',
  timezone: 'Europe/Berlin',
  profile: { height: 183, birthYear: 1992, sex: 'male', activityFactor: 1.3 },
  goal: {
    direction: 'lose', targetWeight: 80, targetDate: null,
    weeklyRatePct: { min: 0.5, max: 1.0 }, dailyCalories: 'auto', proteinPerKg: 1.8,
  },
  trackers: {
    meals: true, weight: true, workouts: true, measurements: true, sleep: true,
    habits: [{ id: 'alcohol', label: 'Alcohol', unit: 'drinks', kcalPerUnit: 150, dailyLimit: 2 }],
  },
  coach: { enabled: true, weeklyReportWeekday: 0, minWeighInsPerWeek: 3, minLoggedDaysPerWeek: 4 },
  models: { classify: 'claude-sonnet-5', coach: 'claude-opus-5' },
};

const recorded = (patch: Partial<RecordResult> = {}): RecordResult => ({
  day: '2026-08-23',
  items: [{ kind: 'meal', text: 'chicken with rice (620 kcal)', id: 1 }],
  problems: [],
  loggedWeight: false,
  loggedMeasurement: false,
  loggedSets: false,
  loggedMealIds: [1],
  photoMealId: null,
  unclear: null,
  ...patch,
});

const balance = (patch: Partial<DayBalance> = {}): DayBalance => ({
  intakeKcal: 1840,
  mealKcal: 1840,
  habitKcal: 0,
  proteinG: 120,
  bmr: 1829,
  baseline: 2378,
  workoutGross: 0,
  workoutMinutes: 0,
  workoutCount: 0,
  restShare: 0,
  workoutNet: 0,
  expenditure: 2378,
  balance: -538,
  ...patch,
});

const trend = (patch: Partial<TrendState> = {}): TrendState => ({
  trendKg: 84.2,
  rateKgWeek: -0.62,
  ratePctWeek: -0.74,
  measureDays7: 5,
  measureDays: 20,
  spanDays: 20,
  lastDay: '2026-08-23',
  series: [],
  ...patch,
});

const receipt = (over: Partial<Parameters<typeof buildReceipt>[0]> = {}) => buildReceipt({
  config,
  recorded: recorded(),
  balance: balance(),
  trend: trend(),
  calorieTarget: 2050,
  proteinTarget: 152,
  habitTotals: [],
  ...over,
});

describe('buildReceipt', () => {
  it('leads with what was just logged', () => {
    expect(receipt()).toMatch(/^Logged: chicken with rice \(620 kcal\)/);
  });

  it('shows in, out and the resulting deficit', () => {
    const text = receipt();
    expect(text).toContain('1,840 in / 2,378 out');
    expect(text).toContain('deficit 538');
  });

  it('shows how much of the target is left', () => {
    expect(receipt()).toContain('Target 2,050, 210 left');
  });

  it('says how far over the target the day is', () => {
    const text = receipt({ balance: balance({ intakeKcal: 2300, balance: -78 }) });
    expect(text).toContain('Target 2,050, 250 over');
  });

  it('calls a surplus a surplus', () => {
    const text = receipt({ balance: balance({ intakeKcal: 2800, balance: 422 }) });
    expect(text).toContain('surplus 422');
  });

  it('refuses to invent a balance without a weight', () => {
    const text = receipt({
      balance: balance({ bmr: null, baseline: null, expenditure: null, balance: null, workoutNet: null }),
      trend: trend({ trendKg: null, rateKgWeek: null, ratePctWeek: null }),
      calorieTarget: null,
    });
    expect(text).toContain('No weight on file');
    expect(text).not.toMatch(/deficit|surplus/);
  });

  it('reports a workout net and gross', () => {
    const text = receipt({
      balance: balance({ workoutCount: 1, workoutGross: 420, workoutNet: 344, restShare: 76, expenditure: 2722 }),
    });
    expect(text).toContain('Training 344 kcal net (420 gross)');
  });

  it('lists habits and flags one over its limit', () => {
    const text = receipt({
      habitTotals: [{ id: 'alcohol', label: 'Alcohol', amount: 3, unit: 'drinks', limit: 2, kcal: 450 }],
    });
    expect(text).toContain('Alcohol 3 drinks, 450 kcal (over your daily limit)');
  });

  it('hides habits with nothing on them today', () => {
    const text = receipt({
      habitTotals: [{ id: 'alcohol', label: 'Alcohol', amount: 0, unit: 'drinks', limit: 2, kcal: 0 }],
    });
    expect(text).not.toContain('Alcohol');
  });

  it('shows the trend with its rate', () => {
    expect(receipt()).toContain('Trend: 84.2 kg, -0.62 kg per week (-0.74 %). 5 of the last 7 days.');
  });

  it('says the rate is not ready rather than showing a fake one', () => {
    const text = receipt({ trend: trend({ rateKgWeek: null, ratePctWeek: null, measureDays: 2 }) });
    expect(text).toMatch(/Not enough weigh-ins/);
    expect(text).not.toContain('per week');
  });

  it('states problems instead of hiding them', () => {
    const text = receipt({ recorded: recorded({ problems: ['unknown template "brunch"'] }) });
    expect(text).toContain('! unknown template "brunch"');
  });

  it('puts the follow-up question last, so it is what you answer', () => {
    const text = receipt({ question: 'How much rice, a bowl or a plate?' });
    expect(text.trimEnd().endsWith('How much rice, a bowl or a plate?')).toBe(true);
  });

  it('confirms corrections in their own line', () => {
    const text = receipt({
      recorded: recorded({ items: [{ kind: 'correction', text: 'deleted chicken with rice (620 kcal)' }] }),
    });
    expect(text).toMatch(/^Updated: deleted chicken with rice/);
  });

  it('says plainly when nothing was logged', () => {
    const text = receipt({ recorded: recorded({ items: [], loggedMealIds: [] }) });
    expect(text).toContain('Nothing logged');
  });

  it('writes German when the language says so', () => {
    const text = buildReceipt({
      config: { ...config, language: 'de' },
      recorded: recorded(),
      balance: balance(),
      trend: trend(),
      calorieTarget: 2050,
      proteinTarget: 152,
      habitTotals: [],
    });
    expect(text).toContain('Notiert:');
    expect(text).toContain('Defizit');
    expect(text).toContain('1.840'); // German thousands separator
  });
});

describe('splitMessage', () => {
  it('leaves a short message alone', () => {
    expect(splitMessage('hello')).toEqual(['hello']);
  });

  it('splits on paragraph boundaries', () => {
    const text = `${'a'.repeat(60)}\n\n${'b'.repeat(60)}`;
    const parts = splitMessage(text, 100);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe('a'.repeat(60));
  });

  it('never exceeds the limit even without a boundary', () => {
    for (const part of splitMessage('x'.repeat(9000), 4096)) {
      expect(part.length).toBeLessThanOrEqual(4096);
    }
  });
});

describe('record helpers', () => {
  it('sums items into totals', () => {
    expect(sumItems([
      { kcal: 300, protein_g: 30, carbs_g: 10, fat_g: 5 },
      { kcal: 220, protein_g: 5 },
    ])).toEqual({ kcal: 520, protein_g: 35, carbs_g: 10, fat_g: 5 });
  });

  it('treats missing macros as zero, not NaN', () => {
    expect(sumItems([{ kcal: 100 }]).protein_g).toBe(0);
    expect(sumItems([])).toEqual({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  });

  it('maps the hour to a meal slot', () => {
    expect(slotFromHour(8)).toBe('breakfast');
    expect(slotFromHour(13)).toBe('lunch');
    expect(slotFromHour(16)).toBe('snack');
    expect(slotFromHour(20)).toBe('dinner');
    expect(slotFromHour(23)).toBe('snack');
  });
});
