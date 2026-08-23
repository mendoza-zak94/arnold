/**
 * /api/cron/report - the weekly report.
 *
 * Scheduled daily in vercel.json and gated by the weekday check in
 * lib/report.ts, because cron jobs on Vercel's free plan run once a day. That
 * makes "which day do I get my report" a config value rather than a redeploy.
 */

import { effectiveConfig } from '../../../../lib/state';
import { reportDueToday, sendWeeklyReport } from '../../../../lib/report';
import { allowedChatIds, need, opt } from '../../../../lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  // This route sends messages and spends model tokens, so it is not open.
  //
  // With CRON_SECRET set, Vercel signs its own cron calls with it and nothing
  // else gets in. Without it, only Vercel's own cron user agent is accepted -
  // weak on its own, but it means a fresh deployment is never a public button
  // that makes someone else's bot talk and burn their credit.
  const secret = opt('CRON_SECRET');
  if (secret) {
    if (request.headers.get('authorization') !== `Bearer ${secret}`) {
      return new Response('forbidden', { status: 403 });
    }
  } else if (!/vercel-cron/i.test(request.headers.get('user-agent') ?? '')) {
    return Response.json({
      ok: false,
      error: 'CRON_SECRET is not set, so only Vercel cron may call this route. '
        + 'Set CRON_SECRET in your environment variables to trigger it yourself.',
    }, { status: 403 });
  }

  const force = new URL(request.url).searchParams.get('force') === '1';

  try {
    const config = await effectiveConfig();
    if (!force && !reportDueToday(config)) {
      return Response.json({ ok: true, sent: false, reason: 'not the configured report weekday' });
    }

    const chatIds = allowedChatIds();
    if (!chatIds.length) {
      return Response.json({ ok: false, sent: false, reason: 'no chat ids on the allow list' });
    }

    const token = need('TELEGRAM_BOT_TOKEN');
    for (const chatId of chatIds) {
      await sendWeeklyReport({ token, chatId, config });
    }
    return Response.json({ ok: true, sent: true, recipients: chatIds.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
