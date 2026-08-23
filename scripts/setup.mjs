#!/usr/bin/env node
/**
 * npm run setup - the guided walkthrough.
 *
 * Asks for the five things Arnold needs, writes .env.local with 0600
 * permissions, and hands over to `npm run check`. It never invents a value and
 * never overwrites one you already have without showing you what is there.
 *
 * If you would rather have an LLM do this with you, point it at
 * docs/AGENT_SETUP.md instead - same steps, plus the ability to open the
 * dashboards and fill things in for you.
 */

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { ask, ENV_FILE, loadEnv, writeEnv, ok, info, head, telegram } from './lib.mjs';

const existing = loadEnv();
const values = { ...existing };

console.log('Arnold setup\n');
console.log('Five things are needed. Press Enter to keep a value in brackets.');

head('1/5  Telegram bot');
info('Open Telegram, message @BotFather, send /newbot, follow the prompts.');
values.TELEGRAM_BOT_TOKEN = await ask('Bot token', { fallback: values.TELEGRAM_BOT_TOKEN, secret: true });

let username = null;
try {
  const me = await telegram(values.TELEGRAM_BOT_TOKEN, 'getMe');
  username = me.username;
  ok(`token belongs to @${username}`);
} catch (err) {
  info(`Could not verify the token yet (${err.message}). Continuing anyway.`);
}

head('2/5  Secrets');
if (!values.TELEGRAM_WEBHOOK_SECRET) {
  values.TELEGRAM_WEBHOOK_SECRET = randomBytes(32).toString('hex');
  ok('generated a webhook secret');
} else {
  ok('keeping the existing webhook secret');
}
if (!values.CRON_SECRET) {
  values.CRON_SECRET = randomBytes(32).toString('hex');
  ok('generated a cron secret for the weekly report');
}

head('3/5  Anthropic API key');
info('console.anthropic.com -> API keys. This is what reads your photos and estimates calories.');
values.ANTHROPIC_API_KEY = await ask('API key', { fallback: values.ANTHROPIC_API_KEY, secret: true });

head('4/5  Supabase');
info('supabase.com -> new project (free tier is enough).');
info('Then: Project Settings -> API. You need the Project URL and the service_role key.');
values.SUPABASE_URL = await ask('Project URL', { fallback: values.SUPABASE_URL });
values.SUPABASE_SERVICE_ROLE_KEY = await ask('service_role key', { fallback: values.SUPABASE_SERVICE_ROLE_KEY, secret: true });

head('5/5  Who may use the bot');
info('Leave this empty for now if you do not know your chat ID.');
info('Message the bot once after deploying and it will tell you the number.');
values.TELEGRAM_ALLOWED_CHAT_IDS = await ask('Your Telegram chat ID(s), comma separated', {
  fallback: values.TELEGRAM_ALLOWED_CHAT_IDS ?? '',
});

head('Voice messages (optional)');
info('Leave as none to skip. Text and photos work either way.');
const stt = await ask('Speech to text: none / openai / groq', { fallback: values.STT_PROVIDER || 'none' });
values.STT_PROVIDER = stt;
if (stt === 'openai') values.OPENAI_API_KEY = await ask('OpenAI API key', { fallback: values.OPENAI_API_KEY, secret: true });
if (stt === 'groq') values.GROQ_API_KEY = await ask('Groq API key', { fallback: values.GROQ_API_KEY, secret: true });

writeEnv(values);
ok(`written to ${ENV_FILE} (permissions 0600, and it is gitignored)`);

head('Still to do by hand');
console.log([
  '1. Open the Supabase SQL editor and run the contents of supabase/schema.sql',
  '2. Edit arnold.config.ts: your height, birth year, timezone, goal, what to track',
  '3. Deploy: vercel --prod  (or push to GitHub and import the repo at vercel.com)',
  '4. Put the same variables into the Vercel project settings',
  '5. Point Telegram at it: npm run webhook -- https://your-deployment.vercel.app',
  '6. Verify: npm run check',
].join('\n'));

if (!existsSync('node_modules')) {
  head('Note');
  info('Dependencies are not installed yet. Run npm install before deploying.');
}
