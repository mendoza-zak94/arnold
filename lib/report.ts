/**
 * report.ts - the weekly report.
 *
 * Runs from a cron once a week, and from /week on demand. Everything is computed
 * first; the model gets finished figures and a decided recommendation, and only
 * writes the prose. That is what makes the advice stable across weeks instead of
 * drifting with whatever the model feels like on a given Sunday.
 */

import * as db from './db';
import * as tg from './telegram';
import { effectiveConfig, loadState } from './state';
import { weeklyFacts, weeklyReport } from './advise';
import { project, requiredRate } from './trend';
import { targetWeightKg } from './config';
import { strings } from './i18n';
import { dayIn, daysAgo, weekdayIn } from './time';
import type { ArnoldConfig } from './config-types';

export async function buildWeeklyReport(config: ArnoldConfig): Promise<string> {
  const today = dayIn(config.timezone);
  const since = daysAgo(config.timezone, 7);

  const [state, meals, workouts, habits] = await Promise.all([
    loadState(config, today),
    db.mealsSince(since),
    db.workoutsSince(since),
    db.habitsSince(since),
  ]);

  const facts = weeklyFacts({ state, meals, workouts, habits, today });

  const target = targetWeightKg(config);
  if (target !== null && config.goal.targetDate) {
    facts.projection = project(state.trend, config.goal.targetDate);
    facts.requiredRate = requiredRate(state.trend, target, today, config.goal.targetDate);
  }

  const body = await weeklyReport({ state, facts });
  return `${strings(config.language).weeklyReport}\n\n${body}`;
}

export async function sendWeeklyReport(opts: {
  token: string;
  chatId: number;
  config?: ArnoldConfig;
}): Promise<void> {
  const config = opts.config ?? await effectiveConfig();
  const text = await buildWeeklyReport(config);
  await tg.sendMessage(opts.token, opts.chatId, text);
  await db.addMessage(opts.chatId, 'arnold', text).catch(() => undefined);
}

/**
 * Whether the report is due today.
 *
 * Vercel's free plan runs cron jobs once a day, so the schedule is daily and the
 * weekday check lives here rather than in the cron expression. That also means
 * changing the report day is a config edit, not a redeploy of vercel.json.
 */
export function reportDueToday(config: ArnoldConfig, now = new Date()): boolean {
  if (config.coach.weeklyReportWeekday === null) return false;
  return weekdayIn(config.timezone, now) === config.coach.weeklyReportWeekday;
}
