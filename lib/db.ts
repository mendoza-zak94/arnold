/**
 * db.ts - everything that touches Postgres.
 *
 * Deliberately thin: no ORM, no query builder on top of the query builder. Each
 * function is one statement with a name that says what it is for, so the call
 * sites read like sentences and the SQL stays visible.
 *
 * Aggregation happens in TypeScript, not in SQL. A single person logging their
 * food produces a handful of rows per day, and pure functions over plain arrays
 * are testable without a database - which is why lib/trend.ts and lib/energy.ts
 * have no idea Supabase exists.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { need } from './env';
import type { StoredSettings } from './config-types';
import { STORED_SETTING_KEYS } from './config-types';

let cached: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!cached) {
    cached = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}

export const PHOTO_BUCKET = 'arnold-photos';

/** Tables a correction is allowed to touch, and which columns within them.
 *  A model that can write arbitrary columns can also write nonsense into
 *  `source` or `id`; this list is the fence. */
export const CORRECTABLE = {
  meals: ['description', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'slot', 'day', 'status'],
  workouts: ['description', 'kind', 'duration_min', 'kcal', 'distance_km', 'pace', 'effort', 'day'],
  weights: ['weight_kg', 'body_fat_pct', 'muscle_kg', 'water_pct', 'fasted', 'day'],
  measurements: ['kind', 'value', 'unit', 'day'],
  sleep: ['bedtime', 'wake_at', 'hours', 'quality', 'note', 'day'],
  habit_entries: ['amount', 'unit', 'kcal', 'note', 'day'],
} as const;

export type CorrectableTable = keyof typeof CORRECTABLE;

export const isCorrectableTable = (t: string): t is CorrectableTable => t in CORRECTABLE;

// --- row types --------------------------------------------------------------

export interface MealRow {
  id: number; ts: string; day: string; slot: string | null; description: string;
  items: unknown; kcal: number | null; protein_g: number | null; carbs_g: number | null;
  fat_g: number | null; confidence: string | null; status: string; source: string;
  photo_path: string | null; raw: string | null;
}
export interface WeightRow {
  id: number; ts: string; day: string; weight_kg: number; body_fat_pct: number | null;
  muscle_kg: number | null; water_pct: number | null; impedance_ohm: number | null;
  fasted: boolean | null; source: string; raw: string | null;
}
export interface MeasurementRow {
  id: number; ts: string; day: string; kind: string; value: number; unit: string; source: string;
}
export interface WorkoutRow {
  id: number; ts: string; day: string; description: string; kind: string | null;
  duration_min: number | null; kcal: number | null; distance_km: number | null;
  pace: string | null; effort: string | null; template: string | null; source: string;
}
export interface SetRow {
  id: number; workout_id: number | null; day: string; exercise: string;
  set_no: number; reps: number | null; weight_kg: number | null; note: string | null;
}
export interface SleepRow {
  id: number; ts: string; day: string; bedtime: string | null; wake_at: string | null;
  hours: number | null; quality: string | null; note: string | null; source: string;
}
export interface HabitRow {
  id: number; ts: string; day: string; habit_id: string; amount: number;
  unit: string | null; kcal: number | null; note: string | null; source: string;
}
export interface TemplateRow {
  id: number; name: string; kind: string; description: string; duration_min: number | null;
  kcal: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null;
  data: unknown;
}
export interface AssumptionRow { id: number; keyword: string; meaning: string }
export interface MessageRow { id: number; ts: string; chat_id: number; role: string; text: string }
export interface PendingRow {
  chat_id: number; question: string; subject: string | null;
  ref_table: string | null; ref_id: number | null; expires_at: string;
}

/** Everything logged on one day. One round trip per table, six in parallel. */
export interface DayData {
  day: string;
  meals: MealRow[];
  weights: WeightRow[];
  measurements: MeasurementRow[];
  workouts: WorkoutRow[];
  sleep: SleepRow[];
  habits: HabitRow[];
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return (res.data ?? []) as T;
}

// --- settings ---------------------------------------------------------------

export async function loadSettings(): Promise<StoredSettings> {
  const rows = unwrap(await db().from('settings').select('key, value'), 'load settings');
  const out: Record<string, unknown> = {};
  for (const r of rows as { key: string; value: unknown }[]) {
    if ((STORED_SETTING_KEYS as string[]).includes(r.key)) out[r.key] = r.value;
  }
  return out as StoredSettings;
}

export async function saveSettings(patch: StoredSettings): Promise<string[]> {
  const rows = Object.entries(patch)
    .filter(([k]) => (STORED_SETTING_KEYS as string[]).includes(k))
    .map(([key, value]) => ({ key, value: value as never, updated_at: new Date().toISOString() }));
  if (!rows.length) return [];
  const res = await db().from('settings').upsert(rows, { onConflict: 'key' });
  if (res.error) throw new Error(`save settings: ${res.error.message}`);
  return rows.map((r) => r.key);
}

// --- reads ------------------------------------------------------------------

export async function dayData(day: string): Promise<DayData> {
  const d = db();
  const [meals, weights, measurements, workouts, sleep, habits] = await Promise.all([
    d.from('meals').select('*').eq('day', day).order('ts'),
    d.from('weights').select('*').eq('day', day).order('ts'),
    d.from('measurements').select('*').eq('day', day).order('ts'),
    d.from('workouts').select('*').eq('day', day).order('ts'),
    d.from('sleep').select('*').eq('day', day).order('ts'),
    d.from('habit_entries').select('*').eq('day', day).order('ts'),
  ]);
  return {
    day,
    meals: unwrap<MealRow[]>(meals, 'meals'),
    weights: unwrap<WeightRow[]>(weights, 'weights'),
    measurements: unwrap<MeasurementRow[]>(measurements, 'measurements'),
    workouts: unwrap<WorkoutRow[]>(workouts, 'workouts'),
    sleep: unwrap<SleepRow[]>(sleep, 'sleep'),
    habits: unwrap<HabitRow[]>(habits, 'habits'),
  };
}

export async function weightsSince(day: string): Promise<WeightRow[]> {
  return unwrap<WeightRow[]>(
    await db().from('weights').select('*').gte('day', day).order('ts'),
    'weights since',
  );
}

export async function latestWeight(): Promise<WeightRow | null> {
  const fasted = unwrap<WeightRow[]>(
    await db().from('weights').select('*').eq('fasted', true).order('ts', { ascending: false }).limit(1),
    'latest fasted weight',
  );
  if (fasted.length) return fasted[0];
  const any = unwrap<WeightRow[]>(
    await db().from('weights').select('*').order('ts', { ascending: false }).limit(1),
    'latest weight',
  );
  return any[0] ?? null;
}

export async function mealsSince(day: string): Promise<MealRow[]> {
  return unwrap<MealRow[]>(await db().from('meals').select('*').gte('day', day).order('ts'), 'meals since');
}

export async function workoutsSince(day: string): Promise<WorkoutRow[]> {
  return unwrap<WorkoutRow[]>(await db().from('workouts').select('*').gte('day', day).order('ts'), 'workouts since');
}

export async function habitsSince(day: string): Promise<HabitRow[]> {
  return unwrap<HabitRow[]>(await db().from('habit_entries').select('*').gte('day', day).order('ts'), 'habits since');
}

export async function setsSince(day: string): Promise<SetRow[]> {
  return unwrap<SetRow[]>(await db().from('workout_sets').select('*').gte('day', day).order('day'), 'sets since');
}

export async function measurementsSince(day: string): Promise<MeasurementRow[]> {
  return unwrap<MeasurementRow[]>(
    await db().from('measurements').select('*').gte('day', day).order('ts'),
    'measurements since',
  );
}

export async function allAssumptions(): Promise<AssumptionRow[]> {
  return unwrap<AssumptionRow[]>(await db().from('assumptions').select('*').order('keyword'), 'assumptions');
}

export async function allTemplates(): Promise<TemplateRow[]> {
  return unwrap<TemplateRow[]>(await db().from('templates').select('*').order('name'), 'templates');
}

// --- writes -----------------------------------------------------------------

async function insert<T>(table: string, row: Record<string, unknown>): Promise<T> {
  const res = await db().from(table).insert(row).select().single();
  if (res.error) throw new Error(`insert ${table}: ${res.error.message}`);
  return res.data as T;
}

export const insertMeal = (row: Record<string, unknown>) => insert<MealRow>('meals', row);
export const insertWeight = (row: Record<string, unknown>) => insert<WeightRow>('weights', row);
export const insertMeasurement = (row: Record<string, unknown>) => insert<MeasurementRow>('measurements', row);
export const insertWorkout = (row: Record<string, unknown>) => insert<WorkoutRow>('workouts', row);
export const insertSleep = (row: Record<string, unknown>) => insert<SleepRow>('sleep', row);
export const insertHabit = (row: Record<string, unknown>) => insert<HabitRow>('habit_entries', row);

export async function insertSets(rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  const res = await db().from('workout_sets').insert(rows);
  if (res.error) throw new Error(`insert sets: ${res.error.message}`);
}

export async function upsertAssumption(keyword: string, meaning: string): Promise<void> {
  const res = await db().from('assumptions').upsert({ keyword, meaning }, { onConflict: 'keyword' });
  if (res.error) throw new Error(`upsert assumption: ${res.error.message}`);
}

export async function upsertTemplate(row: Record<string, unknown>): Promise<void> {
  const res = await db().from('templates').upsert(row, { onConflict: 'name' });
  if (res.error) throw new Error(`upsert template: ${res.error.message}`);
}

/** Read one row by id - the "before" state that a correction journals. */
export async function rowById(table: CorrectableTable, id: number): Promise<Record<string, unknown> | null> {
  const res = await db().from(table).select('*').eq('id', id).maybeSingle();
  if (res.error) throw new Error(`read ${table}#${id}: ${res.error.message}`);
  return (res.data as Record<string, unknown>) ?? null;
}

/** Apply a correction. Only whitelisted columns survive; the rest is dropped. */
export async function updateRow(
  table: CorrectableTable,
  id: number,
  changes: Record<string, unknown>,
): Promise<string[]> {
  const allowed = CORRECTABLE[table] as readonly string[];
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(changes)) if (allowed.includes(k)) patch[k] = v;
  if (!Object.keys(patch).length) return [];
  const res = await db().from(table).update(patch).eq('id', id);
  if (res.error) throw new Error(`update ${table}#${id}: ${res.error.message}`);
  return Object.keys(patch);
}

export async function deleteRow(table: CorrectableTable, id: number): Promise<void> {
  const res = await db().from(table).delete().eq('id', id);
  if (res.error) throw new Error(`delete ${table}#${id}: ${res.error.message}`);
}

// --- conversation, pending questions, idempotency ---------------------------

export async function recentMessages(chatId: number, limit = 6): Promise<MessageRow[]> {
  const rows = unwrap<MessageRow[]>(
    await db().from('messages').select('*').eq('chat_id', chatId).order('ts', { ascending: false }).limit(limit),
    'recent messages',
  );
  return rows.reverse();
}

export async function addMessage(chatId: number, role: 'user' | 'arnold', text: string): Promise<void> {
  if (!text) return;
  await db().from('messages').insert({ chat_id: chatId, role, text: text.slice(0, 4000) });
}

export async function getPending(chatId: number): Promise<PendingRow | null> {
  const res = await db().from('pending').select('*').eq('chat_id', chatId).maybeSingle();
  if (res.error) throw new Error(`pending: ${res.error.message}`);
  const row = res.data as PendingRow | null;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await clearPending(chatId);
    return null;
  }
  return row;
}

export async function setPending(row: Omit<PendingRow, 'expires_at'> & { ttlMinutes: number }): Promise<void> {
  const { ttlMinutes, ...rest } = row;
  const res = await db().from('pending').upsert(
    { ...rest, expires_at: new Date(Date.now() + ttlMinutes * 60_000).toISOString() },
    { onConflict: 'chat_id' },
  );
  if (res.error) throw new Error(`set pending: ${res.error.message}`);
}

export async function clearPending(chatId: number): Promise<void> {
  await db().from('pending').delete().eq('chat_id', chatId);
}

/**
 * How long an unfinished claim blocks a retry. Longer than any real turn
 * (a photo plus a model call plus writes), shorter than Telegram's patience.
 */
const CLAIM_STALE_MS = 90_000;

/**
 * Claim an update for processing. Returns true when it should be SKIPPED.
 *
 * Telegram resends anything it considers failed, so a naive "mark it and move
 * on" books a slow dinner twice. But marking it up front and never revisiting
 * is worse: if the function is killed mid-turn, the retry is thrown away as a
 * duplicate and the entry is gone with no reply, no error row and no trace.
 *
 * So the row is a claim. Fresh claim -> skip, something is running. Finished
 * claim -> skip, it is done. Stale, unfinished claim -> take it over and try
 * again. A duplicate entry can be deleted in one sentence; a lost one cannot be
 * noticed at all.
 */
export async function claimUpdate(updateId: number): Promise<boolean> {
  const res = await db().from('processed_updates').insert({ update_id: updateId, done: false });
  if (!res.error) return false;
  if (res.error.code !== '23505') throw new Error(`processed_updates: ${res.error.message}`);

  const existing = await db().from('processed_updates')
    .select('ts, done').eq('update_id', updateId).maybeSingle();
  if (existing.error || !existing.data) return true; // cannot tell -> do not double book

  const row = existing.data as { ts: string; done: boolean };
  if (row.done) return true;
  if (Date.now() - new Date(row.ts).getTime() < CLAIM_STALE_MS) return true;

  await db().from('processed_updates')
    .update({ ts: new Date().toISOString() }).eq('update_id', updateId);
  return false;
}

/** Close the claim. Only a turn that produced an answer gets marked done. */
export async function completeUpdate(updateId: number): Promise<void> {
  try {
    await db().from('processed_updates').update({ done: true }).eq('update_id', updateId);
  } catch {
    // A claim left open costs one possible duplicate, never a lost entry.
  }
}

export async function coachEventFired(code: string, day: string): Promise<boolean> {
  const res = await db().from('coach_events').insert({ code, day });
  if (!res.error) return false;
  if (res.error.code === '23505') return true;
  return false; // never let bookkeeping break a reply
}

export async function logError(chatId: number | null, input: string, error: string): Promise<void> {
  try {
    await db().from('errors').insert({ chat_id: chatId, input: input.slice(0, 4000), error: error.slice(0, 2000) });
  } catch {
    // Logging the failure must never be the thing that fails the request.
  }
}

// --- photos -----------------------------------------------------------------

/**
 * Store the photo BEFORE anything is judged about it. A picture you sent must
 * not be lost because the model could not classify it.
 */
export async function uploadPhoto(bytes: Uint8Array, day: string, contentType: string): Promise<string> {
  const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
  const path = `${day}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const res = await db().storage.from(PHOTO_BUCKET).upload(path, bytes, { contentType, upsert: false });
  if (res.error) throw new Error(`upload photo: ${res.error.message}`);
  return path;
}

export async function recordPhoto(row: Record<string, unknown>): Promise<void> {
  const res = await db().from('photos').insert(row);
  if (res.error) throw new Error(`record photo: ${res.error.message}`);
}

/** A time limited link, for when Arnold wants to point you at a picture. */
export async function photoLink(path: string, seconds = 3600): Promise<string | null> {
  const res = await db().storage.from(PHOTO_BUCKET).createSignedUrl(path, seconds);
  return res.error ? null : res.data.signedUrl;
}
