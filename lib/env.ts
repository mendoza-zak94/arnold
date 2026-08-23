/**
 * env.ts - one place that knows which environment variables exist.
 *
 * Reads are lazy and loud: a missing key throws with the exact variable name and
 * where to get it, instead of a TypeError three call frames deeper. The health
 * endpoint uses `envReport()` to tell a human (or an agent doing the setup) what
 * is still missing without ever printing a value.
 */

export class MissingEnvError extends Error {
  constructor(public readonly key: string, hint: string) {
    super(`Missing environment variable ${key}. ${hint}`);
    this.name = 'MissingEnvError';
  }
}

interface Spec {
  key: string;
  required: boolean;
  hint: string;
}

const SPECS: Spec[] = [
  { key: 'TELEGRAM_BOT_TOKEN', required: true, hint: 'Create a bot with @BotFather in Telegram and copy the token.' },
  { key: 'TELEGRAM_WEBHOOK_SECRET', required: true, hint: 'Any random string; generate one with: openssl rand -hex 32' },
  { key: 'TELEGRAM_ALLOWED_CHAT_IDS', required: false, hint: 'Comma separated chat IDs. Empty means nobody can write yet - Arnold will tell you your ID.' },
  { key: 'ANTHROPIC_API_KEY', required: true, hint: 'Get one at console.anthropic.com.' },
  { key: 'SUPABASE_URL', required: true, hint: 'Supabase dashboard -> Project Settings -> API -> Project URL.' },
  { key: 'SUPABASE_SERVICE_ROLE_KEY', required: true, hint: 'Supabase dashboard -> Project Settings -> API -> service_role key. Server side only.' },
  { key: 'STT_PROVIDER', required: false, hint: "'openai', 'groq' or 'none'. Controls voice messages." },
  { key: 'OPENAI_API_KEY', required: false, hint: 'Only needed when STT_PROVIDER=openai.' },
  { key: 'GROQ_API_KEY', required: false, hint: 'Only needed when STT_PROVIDER=groq.' },
  { key: 'CRON_SECRET', required: false, hint: 'Protects /api/cron/report. Vercel sets it for its own cron calls.' },
];

function raw(key: string): string {
  return (process.env[key] ?? '').trim();
}

/** Required value. Throws a fixable error when it is missing. */
export function need(key: string): string {
  const v = raw(key);
  if (v) return v;
  const spec = SPECS.find((s) => s.key === key);
  throw new MissingEnvError(key, spec?.hint ?? '');
}

/** Optional value, empty string when unset. */
export function opt(key: string): string {
  return raw(key);
}

/** Chat IDs allowed to write. Empty array = nobody, which is the safe default. */
export function allowedChatIds(): number[] {
  return opt('TELEGRAM_ALLOWED_CHAT_IDS')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n !== 0);
}

export interface EnvReport {
  ok: boolean;
  missing: { key: string; hint: string }[];
  present: string[];
  optional: { key: string; set: boolean }[];
}

/** What is set and what is missing. Never contains a value, only names. */
export function envReport(): EnvReport {
  const missing = SPECS.filter((s) => s.required && !raw(s.key)).map((s) => ({ key: s.key, hint: s.hint }));
  return {
    ok: missing.length === 0,
    missing,
    present: SPECS.filter((s) => s.required && raw(s.key)).map((s) => s.key),
    optional: SPECS.filter((s) => !s.required).map((s) => ({ key: s.key, set: Boolean(raw(s.key)) })),
  };
}
