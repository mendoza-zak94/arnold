/**
 * handle.ts - one Telegram update, from arrival to answer.
 *
 * The order is chosen so that the things that must not be lost happen before the
 * things that can fail:
 *
 *   1. allow list        - a bot anyone can write to is a stranger writing into
 *                          your health record
 *   2. duplicate check   - Telegram resends anything it thinks failed
 *   3. store the photo   - before it is classified, judged or understood. A
 *                          picture you sent must not be lost because a model
 *                          could not make sense of it.
 *   4. classify          - the only step that can be slow
 *   5. record            - corrections first, then new rows
 *   6. receipt           - deterministic, sent immediately
 *   7. coaching          - optional, after the receipt is already out
 *
 * This function never throws. If something breaks, the raw input goes into the
 * errors table and the user gets an honest message saying so. Silence would be
 * the one failure mode you cannot notice.
 */

import * as db from './db';
import * as tg from './telegram';
import { allowedChatIds, need, opt } from './env';
import { effectiveConfig, habitOverLimit, loadState } from './state';
import { classify, hasAction } from './classify';
import { record } from './record';
import { buildReceipt } from './reply';
import { answer, comment } from './advise';
import { commentTrigger } from './coach';
import { strings } from './i18n';
import { languageHint, sttAvailable, SttUnavailableError, transcribe } from './stt';
import { dayIn, daysAgo } from './time';
import type { ArnoldConfig } from './config-types';

/** How long an open follow-up question stays open. */
const PENDING_TTL_MINUTES = 15;

export interface HandleResult {
  status: 'ok' | 'ignored' | 'rejected' | 'error';
  detail?: string;
}

export async function handleUpdate(update: tg.TgUpdate): Promise<HandleResult> {
  const message = update.message ?? update.edited_message;
  if (!message) return { status: 'ignored', detail: 'no message in update' };

  const token = need('TELEGRAM_BOT_TOKEN');
  const chatId = message.chat.id;

  // 1. Allow list. Empty means nobody is allowed yet - and then the friendliest
  //    thing to do is hand the user the value they need to fix it.
  const allowed = allowedChatIds();
  if (!allowed.includes(chatId)) {
    const config = await safeConfig();
    const s = strings(config?.language ?? 'en');
    await tg.sendMessage(token, chatId,
      `${s.notAllowed}\n\n${s.chatIdIs} ${chatId}\n\n`
      + 'Add it to TELEGRAM_ALLOWED_CHAT_IDS in your environment variables and redeploy.');
    return { status: 'rejected', detail: `chat ${chatId} not allowed` };
  }

  // 2. Telegram retries. The primary key on processed_updates does the work.
  try {
    if (await db.alreadyProcessed(update.update_id)) {
      return { status: 'ignored', detail: 'duplicate update' };
    }
  } catch {
    // If the bookkeeping table is unreachable, carry on: a duplicate entry you
    // can delete beats a lost one you never notice.
  }

  let config: ArnoldConfig;
  try {
    config = await effectiveConfig();
  } catch (err) {
    await tg.sendMessage(token, chatId, `Configuration problem:\n${msg(err)}`);
    return { status: 'error', detail: msg(err) };
  }

  const s = strings(config.language);
  const rawText = (message.text ?? message.caption ?? '').trim();

  // Slash commands, before any model is involved.
  if (rawText.startsWith('/')) {
    const handled = await runCommand(rawText, { token, chatId, config });
    if (handled) return { status: 'ok', detail: 'command' };
  }

  await tg.sendTyping(token, chatId);

  // 3. Resolve the content: text, photo or voice.
  let text = rawText;
  let image: { bytes: Uint8Array; mediaType: string } | null = null;
  let source = 'telegram-text';

  try {
    const photo = message.photo?.length ? tg.pickPhoto(message.photo) : null;
    const imageDoc = message.document && /^image\/(jpeg|png|webp)$/i.test(message.document.mime_type ?? '')
      ? message.document : null;

    if (photo || imageDoc) {
      const file = await tg.downloadFile(token, photo ? photo.file_id : imageDoc!.file_id);
      image = {
        bytes: file.bytes,
        mediaType: imageDoc?.mime_type?.toLowerCase() ?? 'image/jpeg',
      };
      source = 'telegram-photo';
    } else if (message.voice || message.audio) {
      const voice = message.voice ?? message.audio!;
      if (!sttAvailable()) {
        await reply(token, chatId, s.voiceUnavailable);
        return { status: 'ok', detail: 'voice without stt' };
      }
      const file = await tg.downloadFile(token, voice.file_id);
      text = await transcribe(file.bytes, voice.mime_type ?? 'audio/ogg', languageHint(config.language));
      source = 'telegram-voice';
    }
  } catch (err) {
    if (err instanceof SttUnavailableError) {
      await reply(token, chatId, s.voiceUnavailable);
      return { status: 'ok', detail: 'voice unavailable' };
    }
    await db.logError(chatId, rawText, `content: ${msg(err)}`);
    await reply(token, chatId, `${s.errorSaving}\n${msg(err)}`);
    return { status: 'error', detail: msg(err) };
  }

  if (!text && !image) return { status: 'ignored', detail: 'nothing usable in message' };

  const today = dayIn(config.timezone);

  // 4. Store the picture BEFORE anything is decided about it.
  let photoPath: string | null = null;
  if (image) {
    try {
      photoPath = await db.uploadPhoto(image.bytes, today, image.mediaType);
    } catch (err) {
      await db.logError(chatId, rawText, `photo upload: ${msg(err)}`);
    }
  }

  // 5. Everything the classifier needs, in parallel.
  let ctx;
  try {
    const [dayToday, dayYesterday, templates, assumptions, history, pending] = await Promise.all([
      db.dayData(today),
      db.dayData(daysAgo(config.timezone, 1)),
      db.allTemplates(),
      db.allAssumptions(),
      db.recentMessages(chatId, 6),
      db.getPending(chatId),
    ]);
    ctx = { config, today: dayToday, yesterday: dayYesterday, templates, assumptions, history, pending };
  } catch (err) {
    await db.logError(chatId, text, `context: ${msg(err)}`);
    await reply(token, chatId, `${s.errorSaving}\n${msg(err)}`);
    return { status: 'error', detail: msg(err) };
  }

  await db.addMessage(chatId, 'user', text || '(photo)');

  // 6. Classify.
  let result;
  try {
    result = await classify({ text, image, context: ctx });
  } catch (err) {
    await db.logError(chatId, text, `classify: ${msg(err)}`);
    await reply(token, chatId, `${s.errorSaving}\n${msg(err).slice(0, 200)}`);
    return { status: 'error', detail: msg(err) };
  }

  // 7. Not an entry: it is a question. Answer it instead of going quiet.
  if (!hasAction(result)) {
    if (photoPath) {
      await db.recordPhoto({ day: today, path: photoPath, category: 'other', note: text || null })
        .catch(() => undefined);
    }
    try {
      const state = await loadState(config, today);
      const text2 = await answer({ state, question: text, image, history: ctx.history });
      await reply(token, chatId, text2);
      return { status: 'ok', detail: 'answered' };
    } catch (err) {
      await db.logError(chatId, text, `answer: ${msg(err)}`);
      await reply(token, chatId, `${s.errorSaving}\n${msg(err).slice(0, 200)}`);
      return { status: 'error', detail: msg(err) };
    }
  }

  // 8. Record.
  let recorded;
  try {
    recorded = await record(result, { config, source, raw: text, photoPath });
  } catch (err) {
    await db.logError(chatId, text, `record: ${msg(err)}`);
    await reply(token, chatId, `${s.errorSaving}\n${msg(err).slice(0, 200)}`);
    return { status: 'error', detail: msg(err) };
  }

  if (photoPath) {
    await db.recordPhoto({
      day: recorded.day,
      path: photoPath,
      category: result.body_photo ? 'body' : recorded.photoMealId ? 'meal' : 'other',
      note: text || null,
      meal_id: recorded.photoMealId,
    }).catch(() => undefined);
  }

  // An open question keeps the entry it belongs to, so the answer corrects that
  // row instead of creating a second one.
  if (result.question && recorded.unclear) {
    await db.setPending({
      chat_id: chatId,
      question: result.question,
      subject: recorded.unclear.subject,
      ref_table: recorded.unclear.table,
      ref_id: recorded.unclear.id,
      ttlMinutes: PENDING_TTL_MINUTES,
    }).catch(() => undefined);
  } else if (ctx.pending) {
    await db.clearPending(chatId).catch(() => undefined);
  }

  // 9. The receipt. Deterministic, and out the door before any coaching.
  let state;
  try {
    state = await loadState(config, recorded.day);
    const receipt = buildReceipt({
      config,
      recorded,
      balance: state.balance,
      trend: state.trend,
      calorieTarget: state.calorieTarget,
      proteinTarget: state.proteinTarget,
      habitTotals: state.habitTotals,
      question: result.question ?? null,
    });
    await reply(token, chatId, receipt);
  } catch (err) {
    await db.logError(chatId, text, `receipt: ${msg(err)}`);
    await reply(token, chatId, `${s.logged}. (${msg(err).slice(0, 150)})`);
    return { status: 'error', detail: msg(err) };
  }

  // 10. Optional second message. Never blocks the receipt, never repeats it.
  try {
    const trigger = commentTrigger({
      config,
      loggedWeight: recorded.loggedWeight,
      loggedMeasurement: recorded.loggedMeasurement,
      loggedSets: recorded.loggedSets,
      state: state.trend,
      strength: state.strength,
      balanceVsTarget: state.calorieTarget !== null ? state.balance.intakeKcal - state.calorieTarget : null,
      habitOverLimit: habitOverLimit(state.habitTotals),
    });
    if (trigger && !(await db.coachEventFired(trigger.code, state.day))) {
      const remark = await comment({ state, brief: trigger.brief });
      if (remark) await reply(token, chatId, remark);
    }
  } catch (err) {
    // Coaching is the optional part. A failure here is logged, not shown.
    await db.logError(chatId, text, `coach: ${msg(err)}`);
  }

  return { status: 'ok' };
}

// --- commands ---------------------------------------------------------------

async function runCommand(
  text: string,
  ctx: { token: string; chatId: number; config: ArnoldConfig },
): Promise<boolean> {
  const cmd = text.split(/\s+/)[0].toLowerCase().replace(/@.*$/, '');
  const { token, chatId, config } = ctx;

  if (cmd === '/start' || cmd === '/help') {
    await reply(token, chatId, helpText(config));
    return true;
  }

  if (cmd === '/id') {
    await reply(token, chatId, `Chat ID: ${chatId}`);
    return true;
  }

  if (cmd === '/today' || cmd === '/status') {
    const state = await loadState(config);
    await reply(token, chatId, buildReceipt({
      config,
      recorded: {
        day: state.day, items: [], problems: [], loggedWeight: false, loggedMeasurement: false,
        loggedSets: false, loggedMealIds: [], photoMealId: null, unclear: null,
      },
      balance: state.balance,
      trend: state.trend,
      calorieTarget: state.calorieTarget,
      proteinTarget: state.proteinTarget,
      habitTotals: state.habitTotals,
    }));
    return true;
  }

  if (cmd === '/week' || cmd === '/report') {
    const { sendWeeklyReport } = await import('./report');
    await sendWeeklyReport({ token, chatId, config });
    return true;
  }

  return false;
}

function helpText(c: ArnoldConfig): string {
  const habits = c.trackers.habits.map((h) => `${h.label.toLowerCase()} (${h.unit})`).join(', ');
  return [
    'I am Arnold. Just tell me what you did - no keywords, no menus.',
    '',
    'Examples:',
    '  "had 200 g of chicken with rice"',
    '  send a photo of your plate',
    c.trackers.weight ? '  "84.2 kg this morning"' : '',
    c.trackers.measurements ? '  "waist 92"' : '',
    c.trackers.workouts ? '  "ran 5 km in 28 minutes"' : '',
    habits ? `  "two beers" - tracking: ${habits}` : '',
    '  "delete the duplicate" / "that was yesterday" / "it was only 200 g"',
    '  "my mayo is always the light one" - I remember that from then on',
    '',
    'Commands: /today for the current state, /week for the weekly report, /id for your chat ID.',
    '',
    'Ask me anything as well - if it is a question, you get an answer, not a database row.',
  ].filter(Boolean).join('\n');
}

// --- helpers ----------------------------------------------------------------

async function reply(token: string, chatId: number, text: string): Promise<void> {
  await tg.sendMessage(token, chatId, text);
  await db.addMessage(chatId, 'arnold', text).catch(() => undefined);
}

async function safeConfig(): Promise<ArnoldConfig | null> {
  try {
    return await effectiveConfig();
  } catch {
    return null;
  }
}

const msg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export { opt };
