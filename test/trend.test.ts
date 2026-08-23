import { describe, expect, it } from 'vitest';
import {
  ALPHA, adherence, dailyAverages, project, requiredRate, series, slopePerDay, trendState,
  weeklyRates, type WeighIn,
} from '../lib/trend';

/** A weigh-in helper. fasted defaults to true because that is the normal case. */
const w = (day: string, weight_kg: number, fasted: boolean | null = true): WeighIn => ({ day, weight_kg, fasted });

/** n consecutive days losing `perDay` kg, starting at `start`. */
function ramp(from: string, days: number, start: number, perDay: number): WeighIn[] {
  const out: WeighIn[] = [];
  const [y, m, d] = from.split('-').map(Number);
  for (let i = 0; i < days; i += 1) {
    const day = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    out.push(w(day, start + perDay * i));
  }
  return out;
}

describe('dailyAverages', () => {
  it('averages several weigh-ins on the same day', () => {
    const avg = dailyAverages([w('2026-01-01', 80), w('2026-01-01', 81)]);
    expect(avg).toEqual([{ day: '2026-01-01', kg: 80.5 }]);
  });

  it('ignores weigh-ins that are not explicitly fasted', () => {
    // This is the rule that protects the whole trend: a weight added later has
    // an unknown measurement time, and one such entry drags everything.
    const avg = dailyAverages([w('2026-01-01', 80, null), w('2026-01-02', 95, false), w('2026-01-03', 81, true)]);
    expect(avg).toEqual([{ day: '2026-01-03', kg: 81 }]);
  });

  it('sorts by day regardless of input order', () => {
    const avg = dailyAverages([w('2026-01-03', 80), w('2026-01-01', 82)]);
    expect(avg.map((a) => a.day)).toEqual(['2026-01-01', '2026-01-03']);
  });
});

describe('series', () => {
  it('starts at the first reading and then moves by ALPHA', () => {
    const s = series([w('2026-01-01', 80), w('2026-01-02', 90)]);
    expect(s[0].trend).toBe(80);
    expect(s[1].trend).toBeCloseTo(80 + ALPHA * 10, 5);
  });

  it('damps a single outlier', () => {
    // A day with a phone in your hand and shoes on: five kilos of nonsense that
    // must not become five kilos of trend.
    const clean = series(ramp('2026-01-01', 10, 85, -0.1));
    const spiked = series([...ramp('2026-01-01', 10, 85, -0.1), w('2026-01-11', 90)]);
    const jump = spiked[spiked.length - 1].trend - clean[clean.length - 1].trend;
    expect(Math.abs(jump)).toBeLessThan(2);
  });
});

describe('slopePerDay', () => {
  it('recovers a known slope', () => {
    const points = ramp('2026-01-01', 15, 85, -0.1).map((x) => ({ day: x.day, kg: x.weight_kg, trend: x.weight_kg }));
    expect(slopePerDay(points)).toBeCloseTo(-0.1, 6);
  });

  it('returns null with fewer than two points', () => {
    expect(slopePerDay([{ day: '2026-01-01', kg: 80, trend: 80 }])).toBeNull();
  });
});

describe('trendState', () => {
  it('has no rate below four measurement days', () => {
    const s = trendState([w('2026-01-01', 85), w('2026-01-03', 84.8), w('2026-01-05', 84.6)], '2026-01-05');
    expect(s.trendKg).not.toBeNull();
    expect(s.rateKgWeek).toBeNull();
  });

  it('has no rate when the span is under six days', () => {
    const s = trendState(ramp('2026-01-01', 5, 85, -0.1), '2026-01-05');
    expect(s.spanDays).toBe(4);
    expect(s.rateKgWeek).toBeNull();
  });

  it('computes a weekly rate and percentage once there is enough data', () => {
    const s = trendState(ramp('2026-01-01', 14, 85, -0.1), '2026-01-14');
    expect(s.rateKgWeek).toBeLessThan(0);
    expect(s.rateKgWeek).toBeGreaterThan(-1.0);
    expect(s.ratePctWeek).toBeCloseTo((s.rateKgWeek! / s.trendKg!) * 100, 1);
  });

  it('counts measurement days in the last seven', () => {
    const s = trendState(ramp('2026-01-01', 14, 85, -0.1), '2026-01-14');
    expect(s.measureDays7).toBe(7);
    expect(s.measureDays).toBe(14);
  });

  it('returns all nulls with no data at all', () => {
    const s = trendState([], '2026-01-14');
    expect(s).toMatchObject({ trendKg: null, rateKgWeek: null, ratePctWeek: null, measureDays: 0 });
  });
});

describe('weeklyRates', () => {
  it('returns one entry per requested week, most recent first', () => {
    const rates = weeklyRates(ramp('2026-01-01', 28, 90, -0.1), '2026-01-28', 3);
    expect(rates).toHaveLength(3);
    for (const r of rates) expect(r).toBeLessThan(0);
  });

  it('returns null for a week with too few points', () => {
    const sparse = [w('2026-01-20', 85), w('2026-01-27', 84.5)];
    expect(weeklyRates(sparse, '2026-01-28', 2)).toEqual([null, null]);
  });
});

describe('project and requiredRate', () => {
  const state = trendState(ramp('2026-01-01', 14, 85, -0.1), '2026-01-14');

  it('projects forward along the current rate', () => {
    const p = project(state, '2026-02-14');
    expect(p).not.toBeNull();
    expect(p!).toBeLessThan(state.trendKg!);
  });

  it('refuses to project into the past', () => {
    expect(project(state, '2025-12-01')).toBeNull();
  });

  it('computes the rate needed to hit a target', () => {
    const r = requiredRate(state, state.trendKg! - 2, '2026-01-14', '2026-02-11');
    expect(r).toBeCloseTo(-0.5, 1);
  });
});

describe('adherence', () => {
  const meals = [
    { day: '2026-01-10', status: 'ok' },
    { day: '2026-01-10', status: 'unclear' },
    { day: '2026-01-11', status: 'ok' },
    { day: '2026-01-01', status: 'ok' }, // outside the window
  ];

  it('counts distinct days, not entries', () => {
    const a = adherence(meals, [], '2026-01-14');
    expect(a.loggedDays).toBe(2);
  });

  it('counts open questions inside the window', () => {
    expect(adherence(meals, [], '2026-01-14').unclear).toBe(1);
  });

  it('counts only fasted weigh-ins', () => {
    const a = adherence([], [w('2026-01-12', 85), w('2026-01-13', 85, false)], '2026-01-14');
    expect(a.weighDays).toBe(1);
  });
});
