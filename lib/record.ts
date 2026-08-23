/**
 * record.ts - turn what the model extracted into rows.
 *
 * The order matters and is not alphabetical: corrections run FIRST, before any
 * new row is created. "delete the duplicate and add the salad" has to remove the
 * duplicate before the day totals are read, or the receipt shows a number that
 * was already wrong when it was printed.
 *
 * Nothing in here throws on a single bad entry. One unusable workout must not
 * take the meal down with it - each block records what it can and reports what
 * it could not, and the caller tells the user honestly.
 */

import * as db from './db';
import type { ArnoldConfig, HabitConfig, StoredSettings } from './config-types';
import type { ClassifyResult, UseTemplateInput } from './schema';
import { estimateWorkoutKcal, habitKcal } from './energy';
import { dayIn, hourIn, isDay } from './time';
import { toCm, validateSettings } from './config';

/** Weigh-ins after this hour are not treated as fasted. */
const FASTED_UNTIL_HOUR = 10;

export interface RecordedItem {
  kind: 'meal' | 'weight' | 'measurement' | 'workout' | 'sleep' | 'habit' | 'correction' | 'assumption' | 'template' | 'settings';
  text: string;
  id?: number;
}

export interface RecordResult {
  day: string;
  items: RecordedItem[];
  problems: string[];
  loggedWeight: boolean;
  loggedMeasurement: boolean;
  loggedSets: boolean;
  loggedMealIds: number[];
  /** The meal a photo should be attached to, if any. */
  photoMealId: number | null;
  /** Set when an entry was saved with an open question against it. */
  unclear: { table: string; id: number; subject: string } | null;
}

export async function record(
  result: ClassifyResult,
  ctx: {
    config: ArnoldConfig;
    source: string;
    raw: string;
    photoPath: string | null;
    now?: Date;
  },
): Promise<RecordResult> {
  const now = ctx.now ?? new Date();
  const c = ctx.config;
  const today = dayIn(c.timezone, now);
  const day = isDay(result.day) ? result.day : today;
  const otherDay = day !== today;

  const out: RecordResult = {
    day,
    items: [],
    problems: [],
    loggedWeight: false,
    loggedMeasurement: false,
    loggedSets: false,
    loggedMealIds: [],
    photoMealId: null,
    unclear: null,
  };

  // 1. Corrections first - see the file header.
  for (const corr of result.corrections ?? []) {
    try {
      if (!db.isCorrectableTable(corr.table)) {
        out.problems.push(`unknown table "${corr.table}"`);
        continue;
      }
      const before = await db.rowById(corr.table, corr.id);
      if (!before) {
        out.problems.push(`${corr.table} #${corr.id} does not exist (any more)`);
        continue;
      }
      if (corr.action === 'delete') {
        await db.deleteRow(corr.table, corr.id);
        await journal(corr.table, corr.id, 'delete', before, null, corr.reason);
        out.items.push({ kind: 'correction', text: `deleted ${label(corr.table, before)}` });
      } else {
        const changed = await db.updateRow(corr.table, corr.id, corr.changes ?? {});
        if (!changed.length) {
          out.problems.push(`nothing changeable in ${corr.table} #${corr.id}`);
          continue;
        }
        await journal(corr.table, corr.id, 'update', before, corr.changes ?? {}, corr.reason);
        out.items.push({
          kind: 'correction',
          text: `updated ${label(corr.table, before)}${corr.reason ? ` (${corr.reason})` : ''}`,
        });
      }
    } catch (err) {
      out.problems.push(`correction on ${corr.table} #${corr.id}: ${message(err)}`);
    }
  }

  // 2. Standing rules and templates, before the entries that may rely on them.
  if (result.remember_assumption?.keyword) {
    try {
      const a = result.remember_assumption;
      await db.upsertAssumption(a.keyword.toLowerCase().trim(), a.meaning);
      out.items.push({ kind: 'assumption', text: `${a.keyword}: ${a.meaning}` });
    } catch (err) {
      out.problems.push(`assumption: ${message(err)}`);
    }
  }

  if (result.define_template?.name) {
    try {
      const t = result.define_template;
      await db.upsertTemplate({
        name: t.name.toLowerCase().trim(),
        kind: t.kind ?? 'other',
        description: t.description,
        duration_min: t.duration_min ?? null,
        kcal: t.kcal ?? null,
        protein_g: t.protein_g ?? null,
        carbs_g: t.carbs_g ?? null,
        fat_g: t.fat_g ?? null,
      });
      out.items.push({ kind: 'template', text: t.name });
    } catch (err) {
      out.problems.push(`template: ${message(err)}`);
    }
  }

  // 3. Settings stated in passing ("I'm 183 tall").
  //
  // Checked against the same bounds as the config file before anything is
  // stored. A transcription slip ("one eighty three" -> 1830) would otherwise
  // reach the energy balance, and a wrong height there is invisible: the
  // receipt shows the result, never the input it came from.
  if (result.settings_update && Object.keys(result.settings_update).length) {
    try {
      const patch = result.settings_update as StoredSettings;
      const problem = validateSettings(c, patch);
      if (problem) {
        out.problems.push(`settings rejected - ${problem.replace(/\n/g, ' ')}`);
      } else {
        const saved = await db.saveSettings(patch);
        if (saved.length) out.items.push({ kind: 'settings', text: saved.join(', ') });
      }
    } catch (err) {
      out.problems.push(`settings: ${message(err)}`);
    }
  }

  const templates = (result.use_template?.length) ? await db.allTemplates() : [];
  const latest = await db.latestWeight().catch(() => null);
  const weightKg = latest?.weight_kg ?? null;

  // 4. Meals.
  for (const m of result.meals ?? []) {
    try {
      const totals = sumItems(m.items);
      const row = await db.insertMeal({
        day,
        slot: m.slot ?? slotFromHour(hourIn(c.timezone, now)),
        description: m.description,
        items: m.items,
        kcal: totals.kcal,
        protein_g: totals.protein_g,
        carbs_g: totals.carbs_g,
        fat_g: totals.fat_g,
        confidence: m.confidence,
        status: result.question ? 'unclear' : 'ok',
        source: ctx.source,
        photo_path: ctx.photoPath,
        raw: ctx.raw.slice(0, 4000),
      });
      out.loggedMealIds.push(row.id);
      if (out.photoMealId === null) out.photoMealId = row.id;
      if (result.question && !out.unclear) {
        out.unclear = { table: 'meals', id: row.id, subject: m.description };
      }
      out.items.push({ kind: 'meal', text: `${m.description} (${Math.round(totals.kcal)} kcal)`, id: row.id });
    } catch (err) {
      out.problems.push(`meal "${m.description}": ${message(err)}`);
    }
  }

  // 5. Templates used.
  for (const use of result.use_template ?? []) {
    try {
      const t = templates.find((x) => x.name.toLowerCase() === use.name.toLowerCase().trim());
      if (!t) {
        out.problems.push(`unknown template "${use.name}"`);
        continue;
      }
      if (t.kind === 'meal') {
        const row = await recordTemplateMeal(t, use, { day, source: ctx.source, raw: ctx.raw, photoPath: ctx.photoPath });
        out.loggedMealIds.push(row.id);
        if (out.photoMealId === null) out.photoMealId = row.id;
        out.items.push({ kind: 'meal', text: `${row.description} (${Math.round(row.kcal ?? 0)} kcal)`, id: row.id });
      } else {
        const description = use.description || t.description;
        const duration = use.duration_min ?? t.duration_min ?? null;
        const kcal = use.kcal ?? t.kcal
          ?? estimateWorkoutKcal({ duration_min: duration, kcal: null, kind: t.kind, description, distance_km: use.distance_km ?? null }, weightKg);
        const row = await db.insertWorkout({
          day,
          description,
          kind: t.kind,
          duration_min: duration,
          kcal,
          distance_km: use.distance_km ?? null,
          pace: use.pace ?? null,
          effort: use.effort ?? null,
          template: t.name,
          source: ctx.source,
        });
        out.items.push({ kind: 'workout', text: `${description}${kcal ? ` (${Math.round(kcal)} kcal)` : ''}`, id: row.id });
      }
    } catch (err) {
      out.problems.push(`template "${use.name}": ${message(err)}`);
    }
  }

  // 6. Weight.
  if (result.weight?.weight_kg) {
    try {
      const w = result.weight;
      const fasted = w.fasted !== undefined
        ? w.fasted
        // A weight added for another day carries no measurement time, and
        // "unknown" must not silently become "fasted" - that is exactly the
        // entry that would drag the trend.
        : otherDay ? null : hourIn(c.timezone, now) < FASTED_UNTIL_HOUR;
      const row = await db.insertWeight({
        day,
        weight_kg: w.weight_kg,
        body_fat_pct: w.body_fat_pct ?? null,
        muscle_kg: w.muscle_kg ?? null,
        water_pct: w.water_pct ?? null,
        fasted,
        source: ctx.source,
        raw: ctx.raw.slice(0, 500),
      });
      out.loggedWeight = true;
      out.items.push({ kind: 'weight', text: `${w.weight_kg.toFixed(1)} kg`, id: row.id });
    } catch (err) {
      out.problems.push(`weight: ${message(err)}`);
    }
  }

  // 7. Measurements. Stored in cm whatever was said, so history stays comparable.
  for (const m of result.measurements ?? []) {
    try {
      const value = m.unit === 'in' ? toCm(m.value) : m.value;
      const row = await db.insertMeasurement({
        day, kind: m.kind.toLowerCase().trim(), value, unit: 'cm', source: ctx.source,
      });
      out.loggedMeasurement = true;
      out.items.push({ kind: 'measurement', text: `${m.kind} ${value.toFixed(1)} cm`, id: row.id });
    } catch (err) {
      out.problems.push(`measurement "${m.kind}": ${message(err)}`);
    }
  }

  // 8. Workouts and their sets.
  for (const w of result.workouts ?? []) {
    try {
      const kcal = w.kcal ?? estimateWorkoutKcal(
        { duration_min: w.duration_min ?? null, kcal: null, kind: w.kind, description: w.description, distance_km: w.distance_km ?? null },
        weightKg,
      );
      const row = await db.insertWorkout({
        day,
        description: w.description,
        kind: w.kind ?? null,
        duration_min: w.duration_min ?? null,
        kcal,
        distance_km: w.distance_km ?? null,
        pace: w.pace ?? null,
        effort: w.effort ?? null,
        template: w.template ?? null,
        source: ctx.source,
      });
      if (w.sets?.length) {
        await db.insertSets(w.sets.map((s) => ({
          workout_id: row.id,
          day,
          exercise: s.exercise.toLowerCase().trim(),
          set_no: s.set_no,
          reps: s.reps ?? null,
          weight_kg: s.weight_kg ?? null,
        })));
        out.loggedSets = true;
      }
      out.items.push({ kind: 'workout', text: `${w.description}${kcal ? ` (${Math.round(kcal)} kcal)` : ''}`, id: row.id });
    } catch (err) {
      out.problems.push(`workout "${w.description}": ${message(err)}`);
    }
  }

  // 9. Sleep.
  if (result.sleep && (result.sleep.hours || result.sleep.bedtime)) {
    try {
      const s = result.sleep;
      const row = await db.insertSleep({
        day,
        bedtime: s.bedtime ?? null,
        wake_at: s.wake_at ?? null,
        hours: s.hours ?? null,
        quality: s.quality ?? null,
        note: s.note ?? null,
        source: ctx.source,
      });
      out.items.push({ kind: 'sleep', text: s.hours ? `${s.hours} h` : `${s.bedtime ?? '?'} - ${s.wake_at ?? '?'}`, id: row.id });
    } catch (err) {
      out.problems.push(`sleep: ${message(err)}`);
    }
  }

  // 10. Habits. Unknown ids are dropped, not invented - the enum comes from the
  //     config, so an id that is not in it means the config changed underneath.
  for (const h of result.habits ?? []) {
    try {
      const cfg = c.trackers.habits.find((x) => x.id === h.habit_id);
      if (!cfg) {
        out.problems.push(`unknown habit "${h.habit_id}"`);
        continue;
      }
      const row = await db.insertHabit({
        day,
        habit_id: cfg.id,
        amount: h.amount,
        unit: cfg.unit,
        kcal: habitKcal(cfg, h.amount),
        note: h.note ?? null,
        source: ctx.source,
      });
      out.items.push({ kind: 'habit', text: `${cfg.label} ${formatAmount(h.amount)} ${cfg.unit}`, id: row.id });
    } catch (err) {
      out.problems.push(`habit "${h.habit_id}": ${message(err)}`);
    }
  }

  return out;
}

async function recordTemplateMeal(
  t: db.TemplateRow,
  use: UseTemplateInput,
  ctx: { day: string; source: string; raw: string; photoPath: string | null },
): Promise<db.MealRow> {
  // A deviation MUST come with recomputed totals. Booking the template numbers
  // while noting "300 g instead of 180" in prose loses the difference silently -
  // that is how 250 kcal disappear from a day that looked correct.
  const description = use.deviation
    ? (use.description || `${t.description} (${use.deviation})`)
    : t.description;
  return db.insertMeal({
    day: ctx.day,
    slot: null,
    description,
    items: t.data ?? null,
    kcal: use.kcal ?? t.kcal,
    protein_g: use.protein_g ?? t.protein_g,
    carbs_g: use.carbs_g ?? t.carbs_g,
    fat_g: use.fat_g ?? t.fat_g,
    confidence: use.deviation && use.kcal === undefined ? 'low' : 'high',
    status: 'ok',
    source: ctx.source,
    photo_path: ctx.photoPath,
    raw: ctx.raw.slice(0, 4000),
  });
}

export function sumItems(items: { kcal?: number; protein_g?: number; carbs_g?: number; fat_g?: number }[]): {
  kcal: number; protein_g: number; carbs_g: number; fat_g: number;
} {
  const acc = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 };
  for (const i of items ?? []) {
    acc.kcal += num(i.kcal);
    acc.protein_g += num(i.protein_g);
    acc.carbs_g += num(i.carbs_g);
    acc.fat_g += num(i.fat_g);
  }
  return {
    kcal: Math.round(acc.kcal),
    protein_g: Math.round(acc.protein_g),
    carbs_g: Math.round(acc.carbs_g),
    fat_g: Math.round(acc.fat_g),
  };
}

/** Which meal slot an hour belongs to, when the model did not say. */
export function slotFromHour(hour: number): string {
  if (hour < 11) return 'breakfast';
  if (hour < 15) return 'lunch';
  if (hour < 18) return 'snack';
  if (hour < 23) return 'dinner';
  return 'snack';
}

export function habitById(c: ArnoldConfig, id: string): HabitConfig | undefined {
  return c.trackers.habits.find((h) => h.id === id);
}

async function journal(
  table: string,
  id: number,
  action: 'update' | 'delete',
  before: Record<string, unknown>,
  changes: Record<string, unknown> | null,
  reason?: string,
): Promise<void> {
  try {
    await db.db().from('corrections_log').insert({
      table_name: table, row_id: id, action, before, changes, reason: reason ?? null,
    });
  } catch {
    // The correction itself already happened. Failing to journal it must not
    // roll the user's intent back.
  }
}

function label(table: string, row: Record<string, unknown>): string {
  const short = (v: unknown) => String(v ?? '').slice(0, 60);
  switch (table) {
    case 'meals': return `${short(row.description)} (${Math.round(Number(row.kcal) || 0)} kcal)`;
    case 'workouts': return `training: ${short(row.description)}`;
    case 'weights': return `${Number(row.weight_kg).toFixed(1)} kg`;
    case 'measurements': return `${short(row.kind)} ${row.value}`;
    case 'habit_entries': return `${short(row.habit_id)} ${row.amount}`;
    case 'sleep': return `sleep ${row.hours ?? '?'} h`;
    default: return `${table} #${row.id}`;
  }
}

/** "2" rather than "2.0", but "1.5" stays "1.5". */
function formatAmount(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(1);
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
