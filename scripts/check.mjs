#!/usr/bin/env node
/**
 * npm run check - does everything this bot needs actually work?
 *
 * Checks the real thing, not just whether a variable is non-empty: it connects
 * to Supabase, asks Telegram who the bot is, and sends one tiny request to
 * Anthropic. A setup that passes this and still does not answer has a problem
 * worth reporting as a bug.
 *
 * Exit code 0 = ready. 1 = something listed above is broken.
 * Nothing here ever prints a key.
 */

import { loadEnv, ok, bad, info, head, mask, telegram } from './lib.mjs';

loadEnv();

let failures = 0;
const fail = (msg, hint) => {
  failures += 1;
  bad(msg);
  if (hint) info(hint);
};

head('Environment');
const REQUIRED = [
  ['TELEGRAM_BOT_TOKEN', 'Create a bot with @BotFather and copy the token.'],
  ['TELEGRAM_WEBHOOK_SECRET', 'Any random string: openssl rand -hex 32'],
  ['OPENAI_API_KEY', 'platform.openai.com -> Chad project -> API keys'],
  ['SUPABASE_URL', 'Supabase -> Project Settings -> API -> Project URL'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'Supabase -> Project Settings -> API -> service_role'],
];
for (const [key, hint] of REQUIRED) {
  if (process.env[key]) ok(`${key} ${mask(process.env[key])}`);
  else fail(`${key} is missing`, hint);
}

const chatIds = (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);
if (chatIds.length) ok(`TELEGRAM_ALLOWED_CHAT_IDS: ${chatIds.join(', ')}`);
else {
  info('TELEGRAM_ALLOWED_CHAT_IDS is empty - nobody can log anything yet.');
  info('Send your bot a message; it replies with your chat ID. Then put it here.');
}

head('Configuration file');
try {
  const raw = await import('node:fs').then((fs) => fs.readFileSync('arnold.config.ts', 'utf8'));
  // Commented out example habits must not be reported as active ones.
  const text = raw.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const language = text.match(/language:\s*'([^']+)'/)?.[1];
  const timezone = text.match(/timezone:\s*'([^']+)'/)?.[1];
  const habits = [...text.matchAll(/id:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);
  ok(`arnold.config.ts: language ${language}, timezone ${timezone}`);
  info(`habits: ${habits.join(', ') || 'none'}`);
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    fail(`timezone "${timezone}" is not a valid IANA name`, 'e.g. Europe/Berlin, America/New_York');
  }
} catch (err) {
  fail(`arnold.config.ts unreadable: ${err.message}`);
}

head('Supabase');
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  const headers = {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
  try {
    const res = await fetch(`${base}/rest/v1/meals?select=id&limit=1`, { headers });
    if (res.ok) {
      ok('connected, schema present');
    } else if (res.status === 404 || (await res.clone().text()).includes('does not exist')) {
      fail('connected, but the tables are missing',
        'Open the Supabase SQL editor and run the contents of supabase/schema.sql');
    } else {
      fail(`REST error HTTP ${res.status}`, (await res.text()).slice(0, 200));
    }
  } catch (err) {
    fail(`cannot reach Supabase: ${err.message}`, 'Check SUPABASE_URL.');
  }

  try {
    const res = await fetch(`${base}/storage/v1/bucket/arnold-photos`, { headers });
    if (res.ok) ok('storage bucket arnold-photos ready');
    else fail('storage bucket arnold-photos missing', 'The last statement in supabase/schema.sql creates it.');
  } catch (err) {
    fail(`storage check failed: ${err.message}`);
  }
}

head('Telegram');
if (process.env.TELEGRAM_BOT_TOKEN) {
  try {
    const me = await telegram(process.env.TELEGRAM_BOT_TOKEN, 'getMe');
    ok(`bot @${me.username}`);
    const hook = await telegram(process.env.TELEGRAM_BOT_TOKEN, 'getWebhookInfo');
    if (hook.url) {
      ok(`webhook ${hook.url}`);
      if (hook.last_error_message) {
        fail(`webhook last error: ${hook.last_error_message}`,
          'Usually a wrong URL, a failed deployment, or a mismatched TELEGRAM_WEBHOOK_SECRET.');
      }
      if (hook.pending_update_count > 0) info(`${hook.pending_update_count} updates waiting`);
    } else {
      fail('no webhook registered', 'Run: npm run webhook -- https://your-deployment.vercel.app');
    }
  } catch (err) {
    fail(`Telegram rejected the token: ${err.message}`);
  }
}

head('OpenAI');
if (process.env.OPENAI_API_KEY) {
  try {
    const model = process.env.CHAD_MODEL || 'gpt-5.6-luna';
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        input: 'Reply with the single word: ready',
        max_output_tokens: 64,
        store: false,
      }),
    });

    if (res.ok) {
      ok(`API key works with ${model}`);
    } else {
      const body = await res.text();
      fail(
        `HTTP ${res.status}: ${body.slice(0, 160)}`,
        res.status === 404
          ? `The model "${model}" is not available to this project.`
          : res.status === 401
            ? 'The key is wrong, revoked or belongs to another project.'
            : 'Check the Chad project credit and usage limits.',
      );
    }
  } catch (err) {
    fail(`cannot reach OpenAI: ${err.message}`);
  }
}

head('Voice (optional)');
const provider = (process.env.STT_PROVIDER ?? 'none').toLowerCase();
if (provider === 'none') info('off - text and photos work. Set STT_PROVIDER to openai or groq for voice notes.');
else if (provider === 'openai' && !process.env.OPENAI_API_KEY) fail('STT_PROVIDER=openai but OPENAI_API_KEY is missing');
else if (provider === 'groq' && !process.env.GROQ_API_KEY) fail('STT_PROVIDER=groq but GROQ_API_KEY is missing');
else ok(`${provider} configured`);

console.log('');
if (failures) {
  console.log(`${failures} problem(s) above. Fix the first one and run npm run check again.`);
  process.exit(1);
}
console.log('Everything checks out. Send your bot a message.');
