/**
 * /api/health - can this deployment actually work?
 *
 * Written for two readers: a human who wants to know why the bot is silent, and
 * an LLM walking someone through the setup, which needs a machine readable
 * answer to "what is still missing". Hence one JSON object with a check per
 * moving part and a `next` field naming the single next thing to fix.
 *
 * It never returns a secret. Only whether one is present, and whether it works.
 */

import { allowedChatIds, envReport, need, opt } from '../../../lib/env';
import { baseConfig } from '../../../lib/config';
import { db } from '../../../lib/db';
import { getMe, getWebhookInfo } from '../../../lib/telegram';
import { sttProvider, sttAvailable } from '../../../lib/stt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export async function GET(): Promise<Response> {
  const checks: Check[] = [];

  const env = envReport();
  checks.push({
    name: 'environment',
    ok: env.ok,
    detail: env.ok
      ? `${env.present.length} required variables set`
      : `missing: ${env.missing.map((m) => m.key).join(', ')}`,
  });

  // Config file
  let language = 'en';
  try {
    const c = baseConfig();
    language = c.language;
    // Deliberately no habit names here: this endpoint is public, and what
    // somebody tracks is their business. The count is enough to verify the
    // config loaded.
    checks.push({
      name: 'config',
      ok: true,
      detail: `language ${c.language}, units ${c.units}, timezone ${c.timezone}, `
        + `${c.trackers.habits.length} habit tracker(s) configured`,
    });
  } catch (err) {
    checks.push({ name: 'config', ok: false, detail: message(err) });
  }

  // Database plus schema
  try {
    const res = await db().from('meals').select('id').limit(1);
    if (res.error) throw new Error(res.error.message);
    checks.push({ name: 'database', ok: true, detail: 'connected, schema present' });
  } catch (err) {
    const m = message(err);
    checks.push({
      name: 'database',
      ok: false,
      detail: /relation .* does not exist|schema cache/i.test(m)
        ? 'connected, but the schema is missing - run supabase/schema.sql in the SQL editor'
        : m,
    });
  }

  // Storage bucket
  try {
    const res = await db().storage.getBucket('arnold-photos');
    checks.push({
      name: 'storage',
      ok: !res.error,
      detail: res.error ? `bucket arnold-photos missing (${res.error.message})` : 'bucket arnold-photos ready',
    });
  } catch (err) {
    checks.push({ name: 'storage', ok: false, detail: message(err) });
  }

  // Telegram bot and webhook
  try {
    const me = await getMe(need('TELEGRAM_BOT_TOKEN'));
    const hook = await getWebhookInfo(need('TELEGRAM_BOT_TOKEN'));
    checks.push({ name: 'telegram-bot', ok: true, detail: `@${me.username ?? me.first_name}` });
    checks.push({
      name: 'telegram-webhook',
      ok: Boolean(hook.url),
      detail: hook.url
        ? `${hook.url}${hook.last_error_message ? ` (last error: ${hook.last_error_message})` : ''}`
        : 'not set - run: npm run webhook -- <your-deployment-url>',
    });
  } catch (err) {
    checks.push({ name: 'telegram-bot', ok: false, detail: message(err) });
  }

  // OpenAI key: presence only, so a health check costs nothing.
checks.push({
  name: 'openai',
  ok: Boolean(opt('OPENAI_API_KEY')),
  detail: opt('OPENAI_API_KEY') ? 'key present' : 'OPENAI_API_KEY missing',
});

  const ids = allowedChatIds();
  checks.push({
    name: 'allow-list',
    ok: ids.length > 0,
    detail: ids.length
      ? `${ids.length} chat id(s) allowed`
      : 'empty - nobody can log anything yet. Message the bot, it will tell you your chat ID.',
  });

  checks.push({
    name: 'voice',
    ok: true,
    detail: sttProvider() === 'none'
      ? 'off (text and photos work; set STT_PROVIDER to enable voice notes)'
      : sttAvailable() ? `${sttProvider()} configured` : `${sttProvider()} selected but its API key is missing`,
  });

  const failing = checks.filter((c) => !c.ok);
  return Response.json({
    ok: failing.length === 0,
    language,
    next: failing[0]?.detail ?? null,
    checks,
  }, { status: failing.length ? 503 : 200 });
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
