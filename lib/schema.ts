/**
 * schema.ts - the tool Claude is forced to fill in, GENERATED from your config.
 *
 * This is why adding a tracker to arnold.config.ts is enough: switch `sleep` off
 * and the field disappears from the schema, so the model cannot book sleep even
 * if you talk about it. Add a habit and its id appears in the enum, so the model
 * can book it without a single prompt being touched.
 *
 * Structured output runs through forced tool use rather than "reply with JSON":
 * the model then cannot put a friendly sentence in front of the payload and
 * break the parser, and every field carries its own description right where the
 * model reads it.
 */

import type { ArnoldConfig } from './config-types';

export interface ToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export const TOOL_NAME = 'log_entry';

export function buildTool(c: ArnoldConfig): ToolSpec {
  const t = c.trackers;
  const props: Record<string, unknown> = {};
  const correctableTables: string[] = [];

  props.is_entry = {
    type: 'boolean',
    description:
      'true when the message documents something: eaten, drunk, weighed, measured, trained, '
      + 'smoked, slept. Also true when it corrects an earlier entry or states a standing rule. '
      + 'false for questions, small talk and requests - those get an answer, not a database row.',
  };

  props.day = {
    type: 'string',
    description:
      'YYYY-MM-DD. Set ONLY when the message explicitly refers to another day ("yesterday '
      + 'evening", "on Monday", a date). It then applies to every entry in this message. '
      + 'For today: leave it out. A message before 11:00 about "dinner" almost always means '
      + "yesterday's dinner.",
  };

  if (t.meals) {
    correctableTables.push('meals');
    props.meals = {
      type: 'array',
      description: 'One entry per meal. Several dishes eaten together belong in one entry as items.',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Short summary, e.g. "chicken breast with rice and salad"' },
          slot: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
          items: {
            type: 'array',
            description: 'The individual foods. Keeping them separate means a wrong total can be '
              + 'recomputed later without asking again what was eaten.',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                grams: { type: 'number', description: 'Estimated amount in grams or ml' },
                kcal: { type: 'number' },
                protein_g: { type: 'number' },
                carbs_g: { type: 'number' },
                fat_g: { type: 'number' },
              },
              required: ['name', 'kcal'],
            },
          },
          confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low'],
            description: 'high = amounts stated or unambiguous, medium = standard portion assumed, '
              + 'low = the amount is barely readable from the text or picture',
          },
        },
        required: ['description', 'items', 'confidence'],
      },
    };
  }

  if (t.weight) {
    correctableTables.push('weights');
    props.weight = {
      type: 'object',
      description: 'Only when a scale reading is mentioned.',
      properties: {
        weight_kg: { type: 'number', description: 'In kilograms. Convert pounds if the user speaks in lb.' },
        body_fat_pct: { type: 'number' },
        muscle_kg: { type: 'number' },
        water_pct: { type: 'number' },
        fasted: {
          type: 'boolean',
          description: 'Set ONLY when the message says so: true for "weighed myself first thing", '
            + 'false for an explicitly later measurement. Otherwise leave it out and the time of '
            + 'day decides. A guess here corrupts the trend permanently.',
        },
      },
      required: ['weight_kg'],
    };
  }

  if (t.measurements) {
    correctableTables.push('measurements');
    props.measurements = {
      type: 'array',
      description: 'Tape measure readings.',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', description: 'waist, chest, hip, arm, thigh, neck, ...' },
          value: { type: 'number' },
          unit: { type: 'string', enum: ['cm', 'in'] },
        },
        required: ['kind', 'value'],
      },
    };
  }

  props.daily_metrics = {
  type: 'object',
  description: 'Daily totals explicitly shown on a Google Health or Fitbit dashboard. '
    + 'Do not estimate these values. calories_burned means the dashboard total calories burned '
    + 'for the whole day, not workout calories or food calories.',
  properties: {
    calories_burned: { type: 'number' },
    steps: { type: 'number' },
    resting_heart_rate: { type: 'number' },
    sleep_score: { type: 'number' },
  },
};
  if (t.workouts) {
    correctableTables.push('workouts');
    props.workouts = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          kind: { type: 'string', enum: ['strength', 'cardio', 'daily', 'other'] },
          duration_min: { type: 'number' },
          kcal: { type: 'number', description: 'Estimated burn. Leave out when it cannot be estimated - do not guess.' },
          distance_km: { type: 'number' },
          pace: { type: 'string', description: 'min/km as "6:00"' },
          effort: { type: 'string', enum: ['easy', 'medium', 'hard'] },
          template: { type: 'string', description: 'Name of the known building block, if one was mentioned' },
          sets: {
            type: 'array',
            description: 'Individual sets. ALWAYS record these when numbers are mentioned - they are '
              + 'the progression, and progression cannot be reconstructed later. "10, 8, 6 pull ups" '
              + 'is three sets of the same exercise. "25 push ups each round" over 3 rounds is three sets of 25.',
            items: {
              type: 'object',
              properties: {
                exercise: { type: 'string', description: 'lowercase, e.g. "pull ups", "bench press"' },
                set_no: { type: 'number' },
                reps: { type: 'number' },
                weight_kg: { type: 'number', description: 'Leave out for bodyweight exercises.' },
              },
              required: ['exercise', 'set_no'],
            },
          },
        },
        required: ['description'],
      },
    };
  }

  if (t.sleep) {
    correctableTables.push('sleep');
    props.sleep = {
      type: 'object',
      description: 'Only when the message talks about sleep ("in bed at 23, up at 6").',
      properties: {
        bedtime: { type: 'string', description: 'HH:MM' },
        wake_at: { type: 'string', description: 'HH:MM' },
        hours: { type: 'number', description: 'Derived from the times, correct across midnight.' },
        quality: { type: 'string', enum: ['good', 'ok', 'bad'] },
        note: { type: 'string' },
      },
    };
  }

  if (t.habits.length) {
    correctableTables.push('habit_entries');
    const lines = t.habits
      .map((h) => `"${h.id}" = ${h.label}, counted in ${h.unit}`)
      .join('; ');
    props.habits = {
      type: 'array',
      description:
        `Counted habits. Available: ${lines}. Use the id exactly as listed. `
        + 'Amount is the number of units, not a description - "two beers" is amount 2 for the '
        + 'matching id. Only book what was actually consumed or done, never an intention '
        + '("I should drink less" is not an entry).',
      items: {
        type: 'object',
        properties: {
          habit_id: { type: 'string', enum: t.habits.map((h) => h.id) },
          amount: { type: 'number' },
          note: { type: 'string', description: 'Optional detail, e.g. "2 beers and a glass of wine"' },
        },
        required: ['habit_id', 'amount'],
      },
    };
  }

  props.corrections = {
    type: 'array',
    description:
      'When the message changes or removes an EXISTING entry ("that was yesterday", "delete the '
      + 'duplicate", "it was only 200 g"). The ids are listed under ALREADY LOGGED in the context. '
      + 'Never guess: when no id matches unambiguously, ask a question instead.',
    items: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: correctableTables },
        id: { type: 'number', description: 'id from the ALREADY LOGGED context' },
        action: { type: 'string', enum: ['update', 'delete'] },
        changes: {
          type: 'object',
          description: 'Only for update: the new values. When an amount changes, recompute kcal and '
            + 'macros and give the complete new totals, not the delta.',
        },
        reason: { type: 'string', description: 'Half a sentence on what was corrected.' },
      },
      required: ['table', 'id', 'action'],
    },
  };

  props.remember_assumption = {
    type: 'object',
    description:
      'When a STANDING rule is stated ("my mayo is always the light one", "my usual portion of '
      + 'rice is 80 g dry"). Not for one-offs.',
    properties: {
      keyword: { type: 'string', description: 'lowercase, e.g. "mayo"' },
      meaning: { type: 'string', description: 'the rule including its nutritional consequence' },
    },
    required: ['keyword', 'meaning'],
  };

  props.define_template = {
    type: 'object',
    description:
      'When a named building block is DEFINED ("my usual breakfast is 80 g oats, 200 ml milk, '
      + 'a banana", "route 1 is the 2.1 km loop"). Saying the name later then books these exact '
      + 'values instead of a fresh estimate that differs every time.',
    properties: {
      name: { type: 'string', description: 'lowercase, e.g. "usual breakfast", "route 1"' },
      kind: { type: 'string', enum: ['meal', 'cardio', 'strength', 'daily', 'other'] },
      description: { type: 'string' },
      duration_min: { type: 'number' },
      kcal: { type: 'number' },
      protein_g: { type: 'number' },
      carbs_g: { type: 'number' },
      fat_g: { type: 'number' },
    },
    required: ['name', 'description'],
  };

  props.use_template = {
    type: 'array',
    description:
      'When a known building block is USED ("had my usual breakfast", "ran route 1"). The values '
      + 'come from the stored template, not from a new estimate. The known templates are listed in '
      + 'the context.',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        deviation: { type: 'string', description: 'Only if mentioned, e.g. "without the banana"' },
        description: {
          type: 'string',
          description: 'REQUIRED when there is a deviation: what was actually eaten or done, in the '
            + "user's own words - NOT the template text.",
        },
        kcal: {
          type: 'number',
          description: 'ONLY when the deviation changes the nutrition: the recomputed TOTAL for the '
            + 'entry (template as the base, deviation applied). Booking template values while noting '
            + 'a deviation in prose silently falsifies the balance.',
        },
        protein_g: { type: 'number' },
        carbs_g: { type: 'number' },
        fat_g: { type: 'number' },
        duration_min: { type: 'number' },
        distance_km: { type: 'number' },
        pace: { type: 'string' },
        effort: { type: 'string', enum: ['easy', 'medium', 'hard'] },
      },
      required: ['name'],
    },
  };

  props.settings_update = {
    type: 'object',
    description:
      'When the user states a fact about themselves or their goal that should stick: height, birth '
      + 'year, target weight, target date, daily calorie target. Only from an explicit statement '
      + '("I am 183 tall", "my target is 78 kg by Christmas"), never inferred.',
    properties: {
      height: { type: 'number', description: 'in cm, or inches when the user speaks imperial' },
      birthYear: { type: 'number' },
      sex: { type: 'string', enum: ['male', 'female'] },
      activityFactor: { type: 'number', description: '1.2 to 1.8, everything except logged workouts' },
      targetWeight: { type: 'number' },
      targetDate: { type: 'string', description: 'YYYY-MM-DD' },
      dailyCalories: { type: 'number' },
    },
  };

  props.body_photo = {
    type: 'boolean',
    description: 'true when the picture is a progress or mirror photo rather than food.',
  };

  props.question = {
    type: 'string',
    description:
      'ONE short follow-up question, only when an amount is so unclear that the estimate could be '
      + 'off by more than roughly 200 kcal. Otherwise leave it out. Never ask about details that do '
      + 'not move the number. The entry is saved anyway - the answer corrects it.',
  };

  return {
    name: TOOL_NAME,
    description: 'Records what the message documents about food, body, training and habits.',
    input_schema: {
      type: 'object',
      properties: props,
      required: ['is_entry'],
    },
  };
}

// --- the shape that comes back ---------------------------------------------

export interface MealInput {
  description: string;
  slot?: string;
  items: { name: string; grams?: number; kcal: number; protein_g?: number; carbs_g?: number; fat_g?: number }[];
  confidence: 'high' | 'medium' | 'low';
}
export interface WeightInput {
  weight_kg: number; body_fat_pct?: number; muscle_kg?: number; water_pct?: number; fasted?: boolean;
}
export interface MeasurementInput { kind: string; value: number; unit?: 'cm' | 'in' }
export interface DailyMetricInput {
  calories_burned?: number;
  steps?: number;
  resting_heart_rate?: number;
  sleep_score?: number;
}
export interface SetInput { exercise: string; set_no: number; reps?: number; weight_kg?: number }
export interface WorkoutInput {
  description: string; kind?: string; duration_min?: number; kcal?: number; distance_km?: number;
  pace?: string; effort?: string; template?: string; sets?: SetInput[];
}
export interface SleepInput { bedtime?: string; wake_at?: string; hours?: number; quality?: string; note?: string }
export interface HabitInput { habit_id: string; amount: number; note?: string }
export interface CorrectionInput {
  table: string; id: number; action: 'update' | 'delete'; changes?: Record<string, unknown>; reason?: string;
}
export interface TemplateInput {
  name: string; kind?: string; description: string; duration_min?: number;
  kcal?: number; protein_g?: number; carbs_g?: number; fat_g?: number;
}
export interface UseTemplateInput {
  name: string; deviation?: string; description?: string; kcal?: number; protein_g?: number;
  carbs_g?: number; fat_g?: number; duration_min?: number; distance_km?: number; pace?: string; effort?: string;
}

export interface ClassifyResult {
  daily_metrics?: DailyMetricInput;
  is_entry: boolean;
  day?: string;
  meals?: MealInput[];
  weight?: WeightInput;
  measurements?: MeasurementInput[];
  workouts?: WorkoutInput[];
  sleep?: SleepInput;
  habits?: HabitInput[];
  corrections?: CorrectionInput[];
  remember_assumption?: { keyword: string; meaning: string };
  define_template?: TemplateInput;
  use_template?: UseTemplateInput[];
  settings_update?: Record<string, unknown>;
  body_photo?: boolean;
  question?: string;
}
