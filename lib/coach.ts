/**
 * coach.ts - the decision tree. Code decides, the model only phrases.
 *
 * The difference between a tracker and a coach is feedback plus goal review,
 * and both have to be computed before a model ever sees them. What follows are
 * explicit thresholds with an explicit order, because a decision tree in a
 * prompt is a decision tree you cannot test:
 *
 *   1. thin data        -> NO adjustment at all. When logging is patchy, what
 *                          changed is the data, not the body.
 *   2. losing too fast  -> eat more. Above ~1 %/week lean mass goes with it.
 *   3. strength falling -> eat more. Strength drops before the scale shows it.
 *   4. inside the band  -> say so and change nothing. Most weeks end here.
 *   5. stalled 3 weeks  -> move more, do NOT cut further. One flat week is
 *                          indistinguishable from water retention.
 *   6. otherwise        -> keep watching.
 *
 * Every branch returns a code. The code is what the tests assert on; the text is
 * what the user reads.
 */

import type { ArnoldConfig } from './config-types';
import type { Adherence, TrendState } from './trend';
import { daysBetween } from './time';

export type CoachCode =
  | 'thin_data'
  | 'too_fast'
  | 'strength_warning'
  | 'in_band'
  | 'stalled'
  | 'watching';

export interface Recommendation {
  code: CoachCode;
  text: string;
}

export interface SetLike {
  exercise: string;
  day: string;
  reps: number | null;
  weight_kg: number | null;
}

export interface StrengthDirection {
  exercises: { exercise: string; direction: 'up' | 'down' | 'flat'; lastDay: string }[];
  falling: number;
  warning: boolean;
}

/** Only exercises trained inside this window count, so a lift you dropped in
 *  spring does not sit on "falling" forever and keep the warning alive. */
export const STRENGTH_WINDOW_DAYS = 21;

/**
 * Direction per exercise, comparing the two most recent training days.
 * Yardstick is tonnage (reps x weight); for bodyweight work, where tonnage is
 * zero, it is total reps.
 */
export function strengthDirection(sets: SetLike[], today: string): StrengthDirection {
  const byExercise = new Map<string, Map<string, { tonnage: number; reps: number }>>();
  for (const s of sets) {
    if (daysBetween(s.day, today) > STRENGTH_WINDOW_DAYS) continue;
    const days = byExercise.get(s.exercise) ?? new Map();
    const acc = days.get(s.day) ?? { tonnage: 0, reps: 0 };
    acc.tonnage += (s.reps ?? 0) * (s.weight_kg ?? 0);
    acc.reps += s.reps ?? 0;
    days.set(s.day, acc);
    byExercise.set(s.exercise, days);
  }

  const exercises: StrengthDirection['exercises'] = [];
  for (const [exercise, days] of byExercise) {
    const sorted = [...days.entries()].sort((a, b) => b[0].localeCompare(a[0]));
    if (sorted.length < 2) continue;
    const [[lastDay, recent], [, previous]] = sorted;
    const delta = (recent.tonnage || previous.tonnage)
      ? recent.tonnage - previous.tonnage
      : recent.reps - previous.reps;
    exercises.push({
      exercise,
      direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
      lastDay,
    });
  }

  const falling = exercises.filter((e) => e.direction === 'down').length;
  return {
    exercises,
    falling,
    // One bad session is a bad session. A majority of tracked lifts going down
    // is a pattern, and only a pattern is worth acting on.
    warning: exercises.length >= 3 && falling > exercises.length / 2,
  };
}

export function decide(opts: {
  config: ArnoldConfig;
  state: TrendState;
  adherence: Adherence;
  weeklyRates: (number | null)[];
  strength: StrengthDirection | null;
}): Recommendation {
  const { config: c, state, adherence: adh, weeklyRates: rates, strength } = opts;
  const band = c.goal.weeklyRatePct;

  if (adh.weighDays < c.coach.minWeighInsPerWeek || adh.loggedDays < c.coach.minLoggedDaysPerWeek) {
    return {
      code: 'thin_data',
      text: `Too little data to adjust anything (${adh.weighDays} weigh-in days, ${adh.loggedDays} `
        + `logged days out of ${adh.days}). Get back to measuring and logging first, then we judge.`,
    };
  }
  if (state.ratePctWeek === null) {
    return { code: 'thin_data', text: 'Not enough measurement days yet for a rate worth trusting.' };
  }

  // Positive = moving in the intended direction, whatever that direction is.
  const progressPct = c.goal.direction === 'gain' ? state.ratePctWeek : -state.ratePctWeek;

  if (c.goal.direction !== 'maintain' && progressPct > band.max + 0.05) {
    const verb = c.goal.direction === 'gain' ? 'gaining' : 'losing';
    const fix = c.goal.direction === 'gain'
      ? 'Take 100 to 200 kcal back out, or you are mostly adding fat.'
      : 'Eat 100 to 200 kcal more, mostly carbohydrates, and keep lifting.';
    return {
      code: 'too_fast',
      text: `You are ${verb} ${progressPct.toFixed(2)} %/week, above the ${band.max} % mark. ${fix}`,
    };
  }

  if (strength?.warning) {
    return {
      code: 'strength_warning',
      text: `Strength is dropping on ${strength.falling} exercises - that shows up before the scale `
        + 'does. Eat more, do not cut further, and keep the training volume.',
    };
  }

  if (c.goal.direction === 'maintain') {
    const drift = Math.abs(state.ratePctWeek);
    return drift <= band.min
      ? { code: 'in_band', text: `Holding steady (${state.ratePctWeek.toFixed(2)} %/week). Nothing to change.` }
      : {
        code: 'watching',
        text: `Weight is drifting ${state.ratePctWeek.toFixed(2)} %/week while you are maintaining. `
          + 'Worth a look at portions if it keeps up.',
      };
  }

  if (progressPct >= band.min) {
    return {
      code: 'in_band',
      text: `${progressPct.toFixed(2)} %/week is inside the healthy band (${band.min} to ${band.max}). Stay the course.`,
    };
  }

  const weeksBelow = rates.filter((r) => {
    if (r === null || state.trendKg === null) return false;
    const pct = (c.goal.direction === 'gain' ? r : -r) / state.trendKg * 100;
    return pct < band.min;
  }).length;

  if (weeksBelow >= 3) {
    return {
      code: 'stalled',
      text: 'Three weeks below target rate with clean data. Move more - steps and one extra session - '
        + 'rather than eating less. Cutting deeper is the reflex that costs muscle.',
    };
  }

  return {
    code: 'watching',
    text: `${progressPct.toFixed(2)} %/week is below the band, but it has not been three weeks. `
      + 'Nothing to do: weight can sit still that long on water alone. Keep logging.',
  };
}

// --- triggers for a spontaneous comment -------------------------------------

export type TriggerCode = 'measurement' | 'too_fast' | 'strength_down' | 'over_target' | 'habit_limit';

export interface Trigger {
  code: TriggerCode;
  /** What the coach model is told to comment on. Never shown to the user as is. */
  brief: string;
}

/**
 * Whether anything happened that is worth a second message beyond the receipt.
 * Deliberately few triggers: a comment on every entry is noise, and noise gets
 * muted. Each code fires at most once per day (enforced by the caller).
 */
export function commentTrigger(opts: {
  config: ArnoldConfig;
  loggedWeight: boolean;
  loggedMeasurement: boolean;
  loggedSets: boolean;
  state: TrendState;
  strength: StrengthDirection | null;
  balanceVsTarget: number | null;
  habitOverLimit: { label: string; amount: number; limit: number } | null;
}): Trigger | null {
  const { config: c } = opts;
  if (!c.coach.enabled) return null;

  if (opts.loggedMeasurement) {
    return {
      code: 'measurement',
      brief: 'A new tape measurement just came in. Put it in context of the trend and the goal, briefly.',
    };
  }

  if (opts.loggedWeight && opts.state.ratePctWeek !== null) {
    const progressPct = c.goal.direction === 'gain' ? opts.state.ratePctWeek : -opts.state.ratePctWeek;
    if (c.goal.direction !== 'maintain' && progressPct > c.goal.weeklyRatePct.max + 0.05) {
      return {
        code: 'too_fast',
        brief: `New weigh-in, and the trend rate is ${progressPct.toFixed(2)} %/week, above the safe band. `
          + 'Say so plainly and say what to change.',
      };
    }
  }

  if (opts.loggedSets && opts.strength?.warning) {
    return {
      code: 'strength_down',
      brief: 'Strength work logged, and the numbers are falling on most tracked exercises. Raise it - '
        + 'the rule is eat more, not train less.',
    };
  }

  if (opts.habitOverLimit) {
    const h = opts.habitOverLimit;
    return {
      code: 'habit_limit',
      brief: `${h.label} is at ${h.amount}, over the daily limit of ${h.limit}. One sentence, no lecture, `
        + 'no moralising. State it and move on.',
    };
  }

  if (opts.balanceVsTarget !== null && opts.balanceVsTarget > 150) {
    return {
      code: 'over_target',
      brief: `The day is ${Math.round(opts.balanceVsTarget)} kcal over target. Put it in context without `
        + 'moralising: what does it mean for tomorrow and for the weekly average?',
    };
  }

  return null;
}
