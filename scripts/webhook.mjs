#!/usr/bin/env node
/**
 * npm run webhook -- <url>     point Telegram at your deployment
 * npm run webhook              show what is currently registered
 * npm run webhook -- --delete  unregister (useful when testing locally)
 *
 * The secret from TELEGRAM_WEBHOOK_SECRET is registered together with the URL.
 * Telegram then sends it back as a header on every call, and the webhook route
 * rejects anything without it - which is what stops strangers from posting fake
 * updates into your database.
 */

import { loadEnv, ok, bad, info, telegram } from './lib.mjs';

loadEnv();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  bad('TELEGRAM_BOT_TOKEN is not set (put it in .env.local or export it).');
  process.exit(1);
}

const arg = process.argv[2];

if (!arg) {
  const hook = await telegram(token, 'getWebhookInfo');
  const me = await telegram(token, 'getMe');
  console.log(`bot:      @${me.username}`);
  console.log(`webhook:  ${hook.url || '(none)'}`);
  console.log(`pending:  ${hook.pending_update_count}`);
  if (hook.last_error_message) console.log(`error:    ${hook.last_error_message}`);
  console.log('\nSet one with: npm run webhook -- https://your-deployment.vercel.app');
  process.exit(0);
}

if (arg === '--delete') {
  await telegram(token, 'deleteWebhook', { drop_pending_updates: false });
  ok('webhook removed');
  process.exit(0);
}

const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!secret) {
  bad('TELEGRAM_WEBHOOK_SECRET is not set.');
  info('Generate one: openssl rand -hex 32');
  info('It must be identical here and in your deployment, or every update is rejected.');
  process.exit(1);
}

const base = arg.replace(/\/$/, '');
if (!base.startsWith('https://')) {
  bad('Telegram only accepts https URLs.');
  info('For local testing use a tunnel, e.g. `npx localtunnel --port 3000` or ngrok.');
  process.exit(1);
}

const url = base.endsWith('/api/telegram') ? base : `${base}/api/telegram`;

await telegram(token, 'setWebhook', {
  url,
  secret_token: secret,
  allowed_updates: ['message'],
  drop_pending_updates: true,
});

ok(`webhook set to ${url}`);

const hook = await telegram(token, 'getWebhookInfo');
if (hook.last_error_message) {
  bad(`Telegram reports: ${hook.last_error_message}`);
  info('That error is from a previous attempt; send the bot a message and run npm run check again.');
} else {
  info('Send your bot a message to test it.');
}
