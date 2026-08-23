import { describe, expect, it } from 'vitest';
import {
  bmr, calorieTarget, dayBalance, estimateWorkoutKcal, fatEquivalentGrams, habitKcal,
  netWorkoutKcal, proteinTarget,
} from '../lib/energy';

const profile = { weightKg: 85, heightCm: 183, age: 34, sex: 'male' as const, activityFactor: 1.3 };

describe('bmr', () => {
  it('matches Mifflin-St Jeor for a known case', () => {
    // 10*85 + 6.25*183 - 5*34 + 5 = 850 + 1143.75 - 170 + 5 = 1828.75
    expect(bmr(profile)).toBe(1829);
  });

  it('uses the female constant', () => {
    expect(bmr({ ...profile, sex: 'female' })).toBe(bmr(profile)! - 166);
  });

  it('is null without a weight', () => {
    expect(bmr({ ...profile, weightKg: 0 })).toBeNull();
  });
});

describe('dayBalance', () => {
  const meals = [{ kcal: 600, protein_g: 40 }, { kcal: 800, protein_g: 55 }];
  const workouts = [{ duration_min: 60, kcal: 420, kind: 'strength', description: 'gym' }];

  it('subtracts the resting burn from workout calories', () => {
    // Without this, an hour of training counts the ~76 kcal you would have
    // burned sitting on the sofa a second time.
    const b = dayBalance(profile, meals, workouts);
    expect(b.workoutGross).toBe(420);
    expect(b.restShare).toBe(Math.round((1829 / 1440) * 60));
    expect(b.workoutNet).toBe(420 - b.restShare!);
    expect(b.workoutNet).toBeLessThan(b.workoutGross);
  });

  it('adds habit calories to intake', () => {
    const b = dayBalance(profile, meals, [], [{ habit_id: 'alcohol', amount: 2, kcal: 300 }]);
    expect(b.mealKcal).toBe(1400);
    expect(b.habitKcal).toBe(300);
    expect(b.intakeKcal).toBe(1700);
  });

  it('returns nulls for everything derived when there is no weight', () => {
    const b = dayBalance(null, meals, workouts);
    expect(b.intakeKcal).toBe(1400);
    expect(b.expenditure).toBeNull();
    expect(b.balance).toBeNull();
    expect(b.bmr).toBeNull();
  });

  it('never reports a negative net for a workout', () => {
    const b = dayBalance(profile, [], [{ duration_min: 600, kcal: 10, kind: 'daily', description: 'walk' }]);
    expect(b.workoutNet).toBe(0);
  });

  it('treats a deficit as a negative balance', () => {
    const b = dayBalance(profile, [{ kcal: 1500, protein_g: 100 }], []);
    expect(b.balance).toBeLessThan(0);
  });
});

describe('calorieTarget', () => {
  const base = {
    expenditure: 2600,
    weightKg: 85,
    weeklyRatePct: { min: 0.5, max: 1.0 },
    configured: 'auto' as const,
  };

  it('passes a configured number straight through', () => {
    expect(calorieTarget({ ...base, direction: 'lose', configured: 2200 })).toBe(2200);
  });

  it('derives a deficit from the middle of the rate band', () => {
    // Middle of 0.5-1.0 % is 0.75 %/week. Of 85 kg that is 0.6375 kg/week,
    // 4,462.5 kcal per week, 637.5 per day.
    const t = calorieTarget({ ...base, direction: 'lose' });
    expect(t).toBe(Math.round(2600 - 637.5));
  });

  it('moves the target with your weight instead of freezing it', () => {
    const heavy = calorieTarget({ ...base, weightKg: 100, direction: 'lose' })!;
    const light = calorieTarget({ ...base, weightKg: 70, direction: 'lose' })!;
    expect(heavy).toBeLessThan(light);
  });

  it('adds instead of subtracting when gaining', () => {
    expect(calorieTarget({ ...base, direction: 'gain' })!).toBeGreaterThan(2600);
  });

  it('equals expenditure when maintaining', () => {
    expect(calorieTarget({ ...base, direction: 'maintain' })).toBe(2600);
  });

  it('never suggests starving', () => {
    const t = calorieTarget({ ...base, expenditure: 1400, weightKg: 150, direction: 'lose' });
    expect(t).toBe(1200);
  });

  it('is null without an expenditure', () => {
    expect(calorieTarget({ ...base, expenditure: null, direction: 'lose' })).toBeNull();
  });
});

describe('estimateWorkoutKcal', () => {
  it('uses 1 kcal per kg per km for running', () => {
    const k = estimateWorkoutKcal({ duration_min: null, kcal: null, description: 'evening run', distance_km: 5 }, 85);
    expect(k).toBe(425);
  });

  it('does NOT apply the running formula to cycling', () => {
    // 30 km on a bike would come out at 2,600 kcal instead of roughly 900.
    const k = estimateWorkoutKcal({ duration_min: 60, kcal: null, description: 'bike ride', distance_km: 30 }, 85);
    expect(k).toBe(420);
  });

  it('falls back to minutes when there is no distance', () => {
    expect(estimateWorkoutKcal({ duration_min: 30, kcal: null, kind: 'strength', description: 'gym' }, 85)).toBe(210);
    expect(estimateWorkoutKcal({ duration_min: 30, kcal: null, kind: 'daily', description: 'walk' }, 85)).toBe(120);
  });

  it('returns null rather than inventing a number', () => {
    expect(estimateWorkoutKcal({ duration_min: null, kcal: null, description: 'went for a run' }, 85)).toBeNull();
  });
});

describe('smaller helpers', () => {
  it('netWorkoutKcal needs all three inputs', () => {
    expect(netWorkoutKcal(400, 60, 1800)).toBe(325);
    expect(netWorkoutKcal(400, null, 1800)).toBeNull();
    expect(netWorkoutKcal(400, 60, null)).toBeNull();
  });

  it('fatEquivalentGrams uses 7000 kcal per kg', () => {
    expect(fatEquivalentGrams(-700)).toBe(100);
    expect(fatEquivalentGrams(null)).toBeNull();
  });

  it('habitKcal only counts habits configured with calories', () => {
    expect(habitKcal({ id: 'alcohol', label: 'Alcohol', unit: 'drinks', kcalPerUnit: 150 }, 2)).toBe(300);
    expect(habitKcal({ id: 'cigarettes', label: 'Cigarettes', unit: 'cigarettes' }, 5)).toBeNull();
    expect(habitKcal(undefined, 2)).toBeNull();
  });

  it('proteinTarget scales with body weight', () => {
    expect(proteinTarget(85, 1.8)).toBe(153);
    expect(proteinTarget(85, null)).toBeNull();
    expect(proteinTarget(null, 1.8)).toBeNull();
  });
});
