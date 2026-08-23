/**
 * telegram.ts - the Bot API surface Arnold actually uses.
 *
 * Plain fetch, no wrapper library: it is six endpoints, and a dependency that
 * needs updating every time Telegram adds a field is a bad trade.
 *
 * Messages go out WITHOUT parse_mode. Markdown in Telegram means escaping every
 * underscore in every food name a model ever writes, and a single unescaped one
 * makes the whole message fail to send. A receipt that does not arrive is worse
 * than one without bold text.
 */

const API = 'https://api.telegram.org';

/** Telegram's hard limit per message. */
const MAX_MESSAGE = 4096;

export interface TgUser { id: number; is_bot: boolean; first_name: string; username?: string }
export interface TgPhotoSize { file_id: string; file_size?: number; width: number; height: number }
export interface TgMessage {
  message_id: number;
  date: number;
  chat: { id: number; type: string; first_name?: string; username?: string };
  from?: TgUser;
  text?: string;
  caption?: string;
  photo?: TgPhotoSize[];
  voice?: { file_id: string; duration: number; mime_type?: string; file_size?: number };
  audio?: { file_id: string; duration: number; mime_type?: string; file_size?: number };
  document?: { file_id: string; mime_type?: string; file_name?: string; file_size?: number };
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  channel_post?: TgMessage;
}

async function call<T>(token: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json() as { ok: boolean; result?: T; description?: string };
  if (!data.ok) throw new Error(`telegram ${method}: ${data.description ?? res.status}`);
  return data.result as T;
}

/** Splits on paragraph and line boundaries so a long report stays readable. */
export function splitMessage(text: string, limit = MAX_MESSAGE): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = limit;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

export async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  for (const part of splitMessage(text)) {
    await call(token, 'sendMessage', { chat_id: chatId, text: part, disable_web_page_preview: true });
  }
}

/** The "typing..." indicator. Free, and it makes a 6 second answer feel alive. */
export async function sendTyping(token: string, chatId: number): Promise<void> {
  try {
    await call(token, 'sendChatAction', { chat_id: chatId, action: 'typing' });
  } catch {
    // Cosmetic only - never let it break the actual work.
  }
}

export async function getMe(token: string): Promise<TgUser> {
  return call<TgUser>(token, 'getMe');
}

export async function downloadFile(token: string, fileId: string): Promise<{ bytes: Uint8Array; path: string }> {
  const file = await call<{ file_path: string }>(token, 'getFile', { file_id: fileId });
  const res = await fetch(`${API}/file/bot${token}/${file.file_path}`);
  if (!res.ok) throw new Error(`telegram download: HTTP ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), path: file.file_path };
}

export async function setWebhook(token: string, url: string, secret: string): Promise<void> {
  await call(token, 'setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message'],
    // Old messages from before the deploy are not worth replaying into the log.
    drop_pending_updates: true,
  });
}

export async function deleteWebhook(token: string): Promise<void> {
  await call(token, 'deleteWebhook', { drop_pending_updates: false });
}

export interface WebhookInfo {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
}

export async function getWebhookInfo(token: string): Promise<WebhookInfo> {
  return call<WebhookInfo>(token, 'getWebhookInfo');
}

/**
 * Picks the photo to analyse: the largest one still comfortably under the API
 * image limit. Telegram sends several sizes; the biggest is not always usable.
 */
export function pickPhoto(sizes: TgPhotoSize[]): TgPhotoSize {
  const LIMIT = 3.5 * 1024 * 1024;
  const usable = [...sizes].reverse().find((p) => !p.file_size || p.file_size < LIMIT);
  return usable ?? sizes[sizes.length - 1];
}
