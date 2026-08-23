/**
 * stt.ts - voice messages to text.
 *
 * Optional by design. Speech to text is the one part of Arnold that needs a
 * second vendor, so it is switched off unless you set STT_PROVIDER. Without it,
 * a voice note gets an honest "I cannot hear voice messages yet, here is how to
 * switch that on" instead of silence.
 *
 * Both supported providers speak the same OpenAI-shaped endpoint, so this is one
 * function with a different base URL and key.
 */

import { opt } from './env';

export type SttProvider = 'openai' | 'groq' | 'none';

interface ProviderSpec {
  url: string;
  keyEnv: string;
  defaultModel: string;
  label: string;
}

const PROVIDERS: Record<Exclude<SttProvider, 'none'>, ProviderSpec> = {
  openai: {
    url: 'https://api.openai.com/v1/audio/transcriptions',
    keyEnv: 'OPENAI_API_KEY',
    defaultModel: 'whisper-1',
    label: 'OpenAI',
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/audio/transcriptions',
    keyEnv: 'GROQ_API_KEY',
    defaultModel: 'whisper-large-v3-turbo',
    label: 'Groq',
  },
};

export function sttProvider(): SttProvider {
  const p = opt('STT_PROVIDER').toLowerCase();
  if (p === 'openai' || p === 'groq') return p;
  return 'none';
}

export function sttAvailable(): boolean {
  const p = sttProvider();
  return p !== 'none' && Boolean(opt(PROVIDERS[p].keyEnv));
}

export class SttUnavailableError extends Error {
  constructor(public readonly reason: 'disabled' | 'missing-key', message: string) {
    super(message);
    this.name = 'SttUnavailableError';
  }
}

/**
 * Transcribe an audio buffer.
 * @param language a hint like "en" or "de" - improves accuracy noticeably on
 *        short clips, where there is little signal to detect the language from.
 */
export async function transcribe(bytes: Uint8Array, mimeType: string, language?: string): Promise<string> {
  const provider = sttProvider();
  if (provider === 'none') {
    throw new SttUnavailableError('disabled', 'STT_PROVIDER is not set');
  }
  const spec = PROVIDERS[provider];
  const key = opt(spec.keyEnv);
  if (!key) {
    throw new SttUnavailableError('missing-key', `${spec.keyEnv} is not set`);
  }

  const form = new FormData();
  const ext = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a' : 'ogg';
  form.append('file', new Blob([bytes as unknown as BlobPart], { type: mimeType || 'audio/ogg' }), `voice.${ext}`);
  form.append('model', opt('STT_MODEL') || spec.defaultModel);
  form.append('response_format', 'text');
  if (language) form.append('language', language);

  const res = await fetch(spec.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body: form,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${spec.label} transcription failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
  return body.trim();
}

/**
 * A two letter hint from the configured language, for the transcriber. Falls
 * back to undefined, which means "detect it yourself".
 */
export function languageHint(language: string): string | undefined {
  const map: Record<string, string> = {
    en: 'en', english: 'en',
    de: 'de', deutsch: 'de', german: 'de',
    fr: 'fr', francais: 'fr', french: 'fr',
    es: 'es', espanol: 'es', spanish: 'es',
    it: 'it', italiano: 'it', italian: 'it',
    pt: 'pt', portugues: 'pt', portuguese: 'pt',
    nl: 'nl', dutch: 'nl', pl: 'pl', polish: 'pl',
    tr: 'tr', turkish: 'tr', ru: 'ru', russian: 'ru',
  };
  return map[language.toLowerCase().trim()];
}
