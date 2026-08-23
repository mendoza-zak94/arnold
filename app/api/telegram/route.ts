/**
 * The webhook. Everything Telegram sends arrives here.
 *
 * Two things worth knowing about this file:
 *
 * 1. It answers 200 in every case that is not "please retry". Telegram treats a
 *    non-200 as a failed delivery and resends the update, so returning 500 on a
 *    bad food photo would mean that photo coming back every few seconds. Real
 *    failures are stored and reported to the user in the chat instead.
 *
 * 2. The work happens before the response, not after it. Serverless functions
 *    stop executing once they return, so "reply fast and finish later" would
 *    mean "reply fast and never finish". A logging turn takes a few seconds,
 *    which is well inside Telegram's patience.
 */

import { handleUpdate } from '../../../lib/handle';
import { opt } from '../../../lib/env';
import type { TgUpdate } from '../../../lib/telegram';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Photo plus model call plus writes. 60s is the ceiling on Vercel's free plan. */
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  // Telegram echoes the secret we registered with setWebhook. Without this
  // check the endpoint is a public write path into your health data.
  const secret = opt('TELEGRAM_WEBHOOK_SECRET');
  const sent = request.headers.get('x-telegram-bot-api-secret-token');
  if (!secret || sent !== secret) {
    return new Response('forbidden', { status: 403 });
  }

  let update: TgUpdate;
  try {
    update = await request.json() as TgUpdate;
  } catch {
    return Response.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  try {
    const result = await handleUpdate(update);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    // Should be unreachable - handleUpdate catches its own failures. If it is
    // reached, still answer 200: a retry storm helps nobody.
    console.error('unhandled webhook failure', err);
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

export function GET(): Response {
  return Response.json({
    ok: true,
    hint: 'This is the Telegram webhook. It only accepts POSTs from Telegram.',
  });
}
