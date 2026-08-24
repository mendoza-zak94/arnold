/**
 * advise.ts - the half that is allowed to think.
 *
 * Three jobs, all optional, all off the critical path: answering a question,
 * commenting after something noteworthy was logged, and writing the weekly
 * report. None of them may ever delay a receipt.
 *
 * The rule they share: the numbers are given, not derived. The decision tree in
 * coach.ts has already decided what the recommendation is; the model turns a
 * code and a set of figures into sentences. When it disagrees with the numbers,
 * the numbers win - which is only possible because it never sees the raw rows to
 * recompute them from.
 */

import { write, type ContentBlock, imageBlock } from './model';
import type { State } from './state';
import { stateBrief } from './state';
import { languageInstruction } from './prompt';
import { daysBetween } from './time';
import { targetWeightKg } from './config';

const VOICE = [
  'You are Chad, a personal health coach in a private chat.',
  'How you write:',
  '- Short. Two to five sentences unless a report is asked for.',
  '- Plain and concrete. Name the number, then what it means.',
  '- No moralising, no praise for showing up, no exclamation marks, no emoji.',
  '- Never invent a number. If something is unknown, say it is unknown.',
  '- You are not a doctor. Do not diagnose, and say so plainly if someone asks you to.',
].join('\n');

/** Answer a question. Everything the answer may rest on is in the brief. */
export async function answer(opts: {
  state: State;
  question: string;
  image?: { bytes: Uint8Array; mediaType: string } | null;
  history?: { role: string; text: string }[];
}): Promise<string> {
  const { state } = opts;
  const content: ContentBlock[] = [];
  if (opts.image) content.push(imageBlock(opts.image.bytes, opts.image.mediaType));

  const parts = [
    'CURRENT STATE (already computed - use these numbers, do not recompute them):',
    stateBrief(state),
  ];
  if (opts.history?.length) {
    parts.push('\nRECENT CONVERSATION:\n'
      + opts.history.map((m) => `${m.role === 'arnold' ? 'You' : 'User'}: ${m.text.slice(0, 300)}`).join('\n'));
  }
  parts.push(`\nQUESTION: ${opts.question || '(a photo with no text - say what you see and what it '
    + 'would cost, and ask whether to log it)'}`);
  content.push({ type: 'text', text: parts.join('\n') });

  return write({
    model: state.config.models.coach,
    system: `${VOICE}\n\n${languageInstruction(state.config.language)}`,
    content,
    maxTokens: 700,
  });
}

/**
 * The spontaneous comment after a receipt. Returns null when the model decides
 * there is nothing worth saying - a coach that always has a remark gets muted.
 */
export async function comment(opts: { state: State; brief: string }): Promise<string | null> {
  const text = await write({
    model: opts.state.config.models.coach,
    system: `${VOICE}\n\n${languageInstruction(opts.state.config.language)}\n\n`
      + 'You are adding a short remark after a receipt that has already been sent. Do not repeat the '
      + 'numbers from it. Say the one thing that matters. If, looking at the state, there is genuinely '
      + 'nothing worth saying, reply with exactly: OK',
    content: [{
      type: 'text',
      text: `WHY YOU ARE COMMENTING: ${opts.brief}\n\nCURRENT STATE:\n${stateBrief(opts.state)}`,
    }],
    maxTokens: 400,
  });
  const trimmed = text.trim();
  return trimmed === 'OK' || trimmed === '' ? null : trimmed;
}

export interface WeeklyFacts {
  /** kcal per day, averaged over days that were actually logged */
  avgIntake: number | null;
  avgProtein: number | null;
  loggedDays: number;
  workouts: number;
  workoutMinutes: number;
  habits: { label: string; total: number; unit: string; perDay: number }[];
  projection: number | null;
  requiredRate: number | null;
  daysToTarget: number | null;
}

/**
 * The weekly report. The decision tree has already run - the model is told the
 * code and phrases it. That is what keeps the advice stable week over week
 * instead of drifting with whatever the model feels like today.
 */
export async function weeklyReport(opts: { state: State; facts: WeeklyFacts }): Promise<string> {
  const { state, facts } = opts;
  const c = state.config;
  const target = targetWeightKg(c);

  const lines = [
    stateBrief(state),
    '',
    'LAST 7 DAYS:',
    `Average intake: ${facts.avgIntake === null ? 'unknown' : `${facts.avgIntake} kcal on ${facts.loggedDays} logged days`}`,
    `Average protein: ${facts.avgProtein === null ? 'unknown' : `${facts.avgProtein} g`}`,
    `Training: ${facts.workouts} sessions, ${Math.round(facts.workoutMinutes)} minutes`,
  ];
  if (facts.habits.length) {
    lines.push(`Habits: ${facts.habits.map((h) => `${h.label} ${h.total} ${h.unit} (${h.perDay.toFixed(1)}/day)`).join(', ')}`);
  }
  if (target !== null && facts.daysToTarget !== null) {
    lines.push(
      `Goal: ${target.toFixed(1)} kg in ${facts.daysToTarget} days.`,
      `Needed rate from here: ${facts.requiredRate === null ? 'unknown' : `${facts.requiredRate} kg/week`}`,
      `Projection at the current trend: ${facts.projection === null ? 'unknown' : `${facts.projection} kg`}`,
    );
  }

  return write({
    model: c.models.coach,
    system: `${VOICE}\n\n${languageInstruction(c.language)}\n\n`
      + 'Write the weekly report. Structure: one line on where things stand, one paragraph on what the '
      + 'numbers say, then the recommendation. The recommendation is already decided - it is in the '
      + 'state under "Rule engine says". Phrase it, do not overrule it, do not add a second one. '
      + 'Eight sentences at most. No headline, no bullet list, no closing pep talk.',
    content: [{ type: 'text', text: lines.join('\n') }],
    maxTokens: 900,
  });
}

/** Pull the weekly numbers out of the raw rows. Pure, so it is testable. */
export function weeklyFacts(opts: {
  state: State;
  meals: { day: string; kcal: number | null; protein_g: number | null }[];
  workouts: { day: string; duration_min: number | null }[];
  habits: { habit_id: string; amount: number }[];
  today: string;
}): WeeklyFacts {
  const { state: s } = opts;
  const byDay = new Map<string, { kcal: number; protein: number }>();
  for (const m of opts.meals) {
    const acc = byDay.get(m.day) ?? { kcal: 0, protein: 0 };
    acc.kcal += m.kcal ?? 0;
    acc.protein += m.protein_g ?? 0;
    byDay.set(m.day, acc);
  }
  const days = [...byDay.values()];
  const target = targetWeightKg(s.config);

  return {
    avgIntake: days.length ? Math.round(days.reduce((a, d) => a + d.kcal, 0) / days.length) : null,
    avgProtein: days.length ? Math.round(days.reduce((a, d) => a + d.protein, 0) / days.length) : null,
    loggedDays: days.length,
    workouts: opts.workouts.length,
    workoutMinutes: opts.workouts.reduce((a, w) => a + (w.duration_min ?? 0), 0),
    habits: s.config.trackers.habits.map((h) => {
      const total = opts.habits.filter((x) => x.habit_id === h.id).reduce((a, x) => a + x.amount, 0);
      return { label: h.label, total, unit: h.unit, perDay: total / 7 };
    }).filter((h) => h.total > 0),
    projection: null, // filled in by the caller, which has the trend helpers
    requiredRate: null,
    daysToTarget: target !== null && s.config.goal.targetDate
      ? daysBetween(opts.today, s.config.goal.targetDate)
      : null,
  };
}
