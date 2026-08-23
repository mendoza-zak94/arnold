/**
 * reply.ts - the receipt.
 *
 * Every logged message gets an immediate answer with numbers in it. That is not
 * decoration: it is the feedback half of the loop, and it is also the failure
 * detector. If the receipt does not arrive, something is broken - by design,
 * so that nothing can quietly stop working while you keep talking to it.
 *
 * Deterministic and model-free. The receipt must never wait on a second API
 * call, and it must never say something the database does not contain.
 */

import type { ArnoldConfig } from './config-types';
import type { DayBalance } from './energy';
import type { TrendState } from './trend';
import type { RecordResult } from './record';
import { fmt, strings } from './i18n';
import { showWeight, unitLabels } from './config';

export interface ReceiptInput {
  config: ArnoldConfig;
  recorded: RecordResult;
  balance: DayBalance;
  trend: TrendState;
  calorieTarget: number | null;
  proteinTarget: number | null;
  habitTotals: { id: string; label: string; amount: number; unit: string; limit: number | null; kcal: number }[];
  question?: string | null;
}

export function buildReceipt(input: ReceiptInput): string {
  const { config: c, recorded, balance, trend } = input;
  const s = strings(c.language);
  const lang = c.language;
  const u = unitLabels(c);
  const lines: string[] = [];

  // 1. What was just logged.
  const logged = recorded.items.filter((i) => !['assumption', 'template', 'settings', 'correction'].includes(i.kind));
  const corrections = recorded.items.filter((i) => i.kind === 'correction');
  const meta = recorded.items.filter((i) => ['assumption', 'template', 'settings'].includes(i.kind));

  for (const corr of corrections) lines.push(`${s.updated}: ${corr.text}`);
  if (logged.length) lines.push(`${s.logged}: ${logged.map((i) => i.text).join(', ')}`);
  for (const m of meta) {
    if (m.kind === 'assumption') lines.push(`${s.noted}: ${m.text}`);
    if (m.kind === 'template') lines.push(`${s.templateSaved}: ${m.text}`);
    if (m.kind === 'settings') lines.push(`${s.settingsSaved}: ${m.text}`);
  }
  if (!lines.length) lines.push(s.nothingLogged);

  // 2. The day so far. This is the number people actually come back for.
  const dayLine = energyLine(input, s, lang);
  if (dayLine) lines.push('', dayLine);

  const protein = proteinLine(input, s, lang);
  if (protein) lines.push(protein);

  // 3. Habits with something on them today.
  const habits = input.habitTotals.filter((h) => h.amount > 0);
  if (habits.length) {
    lines.push(habits.map((h) => {
      const over = h.limit !== null && h.amount > h.limit ? ` (${s.habitOverLimit})` : '';
      const kcal = h.kcal > 0 ? `, ${fmt(h.kcal, 0, lang)} kcal` : '';
      return `${h.label} ${fmt(h.amount, h.amount % 1 === 0 ? 0 : 1, lang)} ${h.unit}${kcal}${over}`;
    }).join(' | '));
  }

  // 4. Trend, whenever weight is tracked at all.
  if (c.trackers.weight) {
    const t = trendLine(trend, c, s, lang, u.weight);
    if (t) lines.push(t);
  }

  // 5. Anything that did not work, said plainly.
  if (recorded.problems.length) {
    lines.push('', `! ${recorded.problems.join('; ')}`);
  }

  // 6. The one follow-up question, last, so it is the thing you answer.
  if (input.question) lines.push('', input.question);

  return lines.join('\n').trim();
}

/** Capitalise a label that lands at the start of a sentence. */
const cap = (t: string): string => (t ? t[0].toUpperCase() + t.slice(1) : t);

function energyLine(input: ReceiptInput, s: ReturnType<typeof strings>, lang: string): string | null {
  const { balance: b } = input;
  if (b.intakeKcal === 0 && b.workoutCount === 0) return null;

  if (b.expenditure === null) {
    return `${s.today}: ${fmt(b.intakeKcal, 0, lang)} kcal ${s.intake}. ${s.noWeightYet}`;
  }

  const parts = [
    `${s.today}: ${fmt(b.intakeKcal, 0, lang)} ${s.intake} / ${fmt(b.expenditure, 0, lang)} ${s.burned}`,
  ];

  const balance = b.balance ?? 0;
  parts.push(balance < 0
    ? `${s.deficit} ${fmt(Math.abs(balance), 0, lang)}`
    : `${s.surplus} ${fmt(balance, 0, lang)}`);

  let line = `${parts.join(' - ')} kcal.`;

  if (input.calorieTarget !== null) {
    const left = input.calorieTarget - b.intakeKcal;
    line += left >= 0
      ? ` ${cap(s.target)} ${fmt(input.calorieTarget, 0, lang)}, ${fmt(left, 0, lang)} ${s.remaining}.`
      : ` ${cap(s.target)} ${fmt(input.calorieTarget, 0, lang)}, ${fmt(-left, 0, lang)} ${s.over}.`;
  }

  if (b.workoutCount > 0 && b.workoutNet !== null) {
    line += ` ${cap(s.workout)} ${fmt(b.workoutNet, 0, lang)} kcal ${s.net} (${fmt(b.workoutGross, 0, lang)} ${s.gross}).`;
  }

  return line;
}

function proteinLine(input: ReceiptInput, s: ReturnType<typeof strings>, lang: string): string | null {
  if (input.proteinTarget === null || input.balance.proteinG === 0) return null;
  return `${cap(s.protein)} ${fmt(input.balance.proteinG, 0, lang)} / ${fmt(input.proteinTarget, 0, lang)} g.`;
}

function trendLine(
  t: TrendState,
  c: ArnoldConfig,
  s: ReturnType<typeof strings>,
  lang: string,
  unit: string,
): string | null {
  if (t.trendKg === null) return null;
  if (t.rateKgWeek === null) {
    return `${s.trend}: ${showWeight(t.trendKg, c)} ${unit} (${t.measureDays} x ${s.measured.replace(' on', '')} - ${s.noTrendYet})`;
  }
  const sign = t.rateKgWeek > 0 ? '+' : '';
  const rate = c.units === 'imperial'
    ? `${sign}${fmt(t.rateKgWeek / 0.45359237, 2, lang)} ${unit}`
    : `${sign}${fmt(t.rateKgWeek, 2, lang)} ${unit}`;
  return `${s.trend}: ${showWeight(t.trendKg, c)} ${unit}, ${rate} ${s.perWeek} `
    + `(${sign}${fmt(t.ratePctWeek, 2, lang)} %). ${t.measureDays7} ${s.ofDays}.`;
}
