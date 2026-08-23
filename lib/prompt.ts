/**
 * prompt.ts - the system prompt and the context block around it.
 *
 * Most of the rules below are scar tissue. Each one exists because the obvious
 * behaviour turned out to be wrong in a specific, repeatable way:
 *
 *   - "was out running" without a distance used to become "about 5 km". It was
 *     2.1 km. Guessed workout numbers go straight into the energy balance, so
 *     workouts are never estimated - food is, because a standard portion is a
 *     defensible assumption and an invented distance is not.
 *   - A recap message ("so today I had...") used to book breakfast a second
 *     time. Hence: what is already logged is in the context, and only what is
 *     missing gets added.
 *   - "300 g of salmon instead of 180" used to be stored as a note next to the
 *     unchanged template values, silently losing 250 kcal. Hence: a deviation
 *     forces a recalculation.
 *
 * Keeping the reasons in the file is deliberate. Without them, the next person
 * to tidy up the prompt removes exactly the sentence that was doing the work.
 */

import type { ArnoldConfig } from './config-types';
import type { AssumptionRow, DayData, TemplateRow } from './db';
import { dateLabel, timeIn } from './time';
import { unitLabels } from './config';

export function systemPrompt(c: ArnoldConfig, now = new Date()): string {
  const u = unitLabels(c);
  const habits = c.trackers.habits;

  const rules: string[] = [
    'You are the logging half of a personal health tracker. Your only job is to extract the facts '
    + 'documented in a message (text, voice transcript or photo) and put them into the tool. You do '
    + 'not chat, you do not advise, you do not moralise.',
    '',
    'Rules:',
    '- Set is_entry true only when something is actually documented: eaten, drunk, weighed, measured, '
      + 'trained, smoked, slept. Questions about nutrition, requests and small talk are NOT entries - '
      + 'set false and leave everything else out.',
    '- A photo of food is always an entry. A photo of a body or a mirror is an entry with '
      + 'body_photo=true and no meal. A screenshot of a scale app showing weight or body fat IS an '
      + 'entry - put the values into weight. Any other screenshot is not an entry.',
    '- Estimate calories and macros as well as you can and commit to one number. Never give a range, '
      + 'never say "roughly 400-600". For a standard portion with no amount given, assume a normal '
      + 'portion and set confidence=medium.',
    '- Voice transcripts are unreliable. Pick the most plausible reading of a garbled food name and '
      + 'put the CORRECTED reading into the description, never the garbled one. Only ask when the '
      + 'difference actually matters for the number.',
    '- ANOTHER DAY: when the message says "yesterday", "the day before" or names a date, set day to '
      + 'that calendar day. A message before 11:00 about "dinner", with nothing else said, means '
      + "YESTERDAY's dinner.",
    '- CORRECTIONS: when the message refers to something already logged ("that was wrong", "delete '
      + 'that", "it was only 200 g"), use corrections with the id from the ALREADY LOGGED context - '
      + 'do NOT create a new entry. Recompute calories and macros for changed amounts. When the row '
      + 'meant is not unambiguous, ask ONE question instead of guessing.',
    '- ASSUMPTIONS: the standing assumptions below are applied without asking. When a new standing '
      + 'rule is stated, set remember_assumption.',
    '- Questions cost the user something. At most one, and only when more than roughly 200 kcal hang '
      + 'on the answer. Good: "how much rice, a bowl or a plate?" Bad: "was there dressing on the salad?"',
    '- Amounts in pieces are fine (2 eggs) - convert them to grams yourself.',
    '- NEVER GUESS A WORKOUT. For food a normal portion is a defensible assumption; for training it '
      + 'is not. Distance, duration and calories go straight into the energy balance. If the message '
      + 'says "went for a run" with no distance, LEAVE OUT duration_min and kcal and ask. Never '
      + 'substitute a default distance.',
    '- Running burns roughly 1 kcal per kg of body weight per km. Strength work and calisthenics are '
      + 'far less, around 6 to 8 kcal per minute.',
    '- STRENGTH NUMBERS ARE MANDATORY when they are mentioned. "10, 8, 6 pull ups" is three sets of '
      + 'the same exercise with descending reps. "25 push ups every round" over three rounds is three '
      + 'sets of 25. Gym exercises carry their weight ("3x8 bench press at 70 kg"). Without these '
      + 'numbers there is no progression, and progression cannot be reconstructed afterwards.',
    '- TEMPLATES: when a known building block is named ("my usual breakfast", "route 1"), use '
      + 'use_template - never re-estimate it. When one is defined, use define_template. When a '
      + 'deviation is mentioned, put it in deviation AND fill description with what was actually '
      + 'eaten or done AND recompute the totals. A deviation noted only as prose, with the template '
      + 'numbers booked unchanged, quietly falsifies the balance.',
    '- EITHER use_template OR workouts for the same session, never both, or it lands in the database '
      + 'twice. Name only -> use_template. Name plus concrete numbers -> workouts, with the name in '
      + 'template and the numbers in sets.',
    '- NO DOUBLE BOOKING: what is already logged today is listed below. People like to recap their '
      + 'day ("so today I had..."). Log ONLY what is missing from that list. If the message contains '
      + 'nothing but already logged items, it is not an entry (is_entry=false).',
  ];

  if (habits.length) {
    rules.push(
      `- HABITS: ${habits.map((h) => `${h.label} (id "${h.id}", in ${h.unit})`).join(', ')}. `
      + 'Book the amount actually consumed or done. Intentions and plans are not entries.',
    );
    const withKcal = habits.filter((h) => h.kcalPerUnit != null);
    if (withKcal.length) {
      rules.push(
        `- ${withKcal.map((h) => h.label).join(' and ')} count into the calorie balance automatically - `
        + 'do NOT additionally book them as a meal, or they are counted twice.',
      );
    }
  }

  rules.push(
    '- SETTINGS: when the user states a lasting fact about themselves or their goal ("I am 183 tall", '
      + '"target is 78 by Christmas"), set settings_update. Never infer it from context.',
  );

  const unitNote = c.units === 'imperial'
    ? `- The user speaks imperial (${u.weight}, ${u.length}, ${u.distance}). Convert everything into `
      + 'metric for the tool: weight_kg in kilograms, distance_km in kilometres. Measurements may keep '
      + 'their unit field.'
    : `- The user speaks metric (${u.weight}, ${u.length}, ${u.distance}).`;

  return [
    rules.join('\n'),
    unitNote,
    '',
    `Today is ${dateLabel(c.timezone, now)}, ${timeIn(c.timezone, now)} local time - use the date and `
    + 'time to place the day and the meal slot.',
  ].join('\n');
}

/**
 * Everything already logged, as a prompt block. This is both the deduplication
 * base and the address book for corrections: the ids in square brackets are what
 * `corrections` points at. Yesterday is included because corrections usually
 * arrive the morning after.
 */
export function loggedContext(today: DayData, yesterday: DayData, c: ArnoldConfig): string {
  const u = unitLabels(c);
  const habitLabel = (id: string) => c.trackers.habits.find((h) => h.id === id)?.label ?? id;
  const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n)}...` : s);
  const clock = (ts: string) => timeIn(c.timezone, new Date(ts));

  const lines = (d: DayData): string[] => {
    const out: string[] = [];
    for (const m of d.meals) out.push(`- [meals #${m.id}] ${clock(m.ts)} ${short(m.description)} (${Math.round(m.kcal ?? 0)} kcal)`);
    for (const w of d.workouts) out.push(`- [workouts #${w.id}] ${clock(w.ts)} training: ${short(w.description)}`);
    for (const w of d.weights) out.push(`- [weights #${w.id}] ${clock(w.ts)} ${w.weight_kg.toFixed(2)} kg`);
    for (const m of d.measurements) out.push(`- [measurements #${m.id}] ${m.kind} ${m.value} ${m.unit}`);
    for (const s of d.sleep) out.push(`- [sleep #${s.id}] ${s.hours ?? '?'} h`);
    for (const h of d.habits) out.push(`- [habit_entries #${h.id}] ${habitLabel(h.habit_id)} ${h.amount}`);
    return out;
  };

  const t = lines(today);
  const y = lines(yesterday);
  if (!t.length && !y.length) return '';

  const parts: string[] = [];
  if (t.length) {
    parts.push('\n\nALREADY LOGGED TODAY (never create any of these again; ids are for corrections):');
    parts.push(...t);
  }
  if (y.length) {
    parts.push(`\nYESTERDAY (${yesterday.day}), for corrections only:`);
    parts.push(...y);
  }
  parts.push(`\n(Weights are shown in kg. The user speaks ${u.weight}.)`);
  return parts.join('\n');
}

export function templateContext(templates: TemplateRow[]): string {
  if (!templates.length) return '\n\nNo named templates stored yet.';
  const meals = templates.filter((t) => t.kind === 'meal');
  const training = templates.filter((t) => t.kind !== 'meal');
  const parts: string[] = [];
  if (meals.length) {
    parts.push('\n\nMEAL TEMPLATES (when one is named, ALWAYS use_template, never re-estimate):\n'
      + meals.map((t) => `- ${t.name}: ${t.description} (${Math.round(t.kcal ?? 0)} kcal, `
        + `P ${Math.round(t.protein_g ?? 0)} g)`).join('\n'));
  }
  if (training.length) {
    parts.push('\n\nTRAINING TEMPLATES:\n'
      + training.map((t) => {
        const bits = [t.duration_min ? `${t.duration_min} min` : null, t.kcal ? `${t.kcal} kcal` : null]
          .filter(Boolean).join(', ');
        return `- ${t.name}: ${t.description}${bits ? ` (${bits})` : ''}`;
      }).join('\n'));
  }
  return parts.join('');
}

export function assumptionContext(assumptions: AssumptionRow[]): string {
  if (!assumptions.length) return '';
  return '\n\nSTANDING ASSUMPTIONS (always apply, never ask about them):\n'
    + assumptions.map((a) => `- ${a.keyword}: ${a.meaning}`).join('\n');
}

export function conversationContext(messages: { role: string; text: string }[]): string {
  if (!messages.length) return '';
  return 'RECENT CONVERSATION (for context only, do not re-log any of it):\n'
    + messages.map((m) => `${m.role === 'arnold' ? 'Arnold' : 'User'}: ${m.text.slice(0, 200)}`).join('\n');
}

export function pendingContext(question: string, subject: string | null): string {
  return `A follow-up question is still open from an earlier entry: "${question}"\n`
    + (subject ? `It was about: "${subject}".\n` : '')
    + 'If the next message answers it, correct that entry accordingly (give the complete corrected '
    + 'values). If it is a new topic, handle it on its own.';
}

/**
 * The language instruction. Kept separate from the rules so that switching
 * language never risks losing a rule in translation - the rules stay English,
 * the output does not.
 */
export function languageInstruction(language: string): string {
  return `Write every user facing text (descriptions, questions, notes) in ${language}. `
    + 'Field names, ids, enum values and template names stay exactly as specified in the tool schema.';
}
