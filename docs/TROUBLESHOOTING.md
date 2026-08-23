# Troubleshooting

Start here:

```bash
npm run check
```

It connects to Supabase, Telegram and Anthropic for real and names the first
thing that is broken. Most of what follows is the longer explanation of one of
its lines.

For a deployed instance, the same picture in JSON:

```bash
curl -s https://your-deployment.vercel.app/api/health
```

---

## The bot says nothing at all

```bash
npm run webhook          # with no argument: shows what is registered
```

**`webhook: (none)`** - it was never set, or a redeploy changed the URL:

```bash
npm run webhook -- https://your-deployment.vercel.app
```

**`last_error_message: Wrong response from the webhook: 403 Forbidden`** - the
`TELEGRAM_WEBHOOK_SECRET` used when registering differs from the one the
deployment has. They must match exactly. Set the same value in both places,
redeploy, register again.

**`last_error_message: ... 404`** - the URL points at something that is not the
deployment, or the deployment failed to build. Open the URL in a browser; you
should see the Arnold status page.

**URL set, no error, still silence** - the function is failing before it can
answer. Look at the logs:

```bash
npx vercel logs https://your-deployment.vercel.app
```

**Two bots, one token** - if you run a local instance with a tunnel and a
deployed one, whichever registered the webhook last owns it. Telegram allows
exactly one.

---

## "This bot is private and your chat is not on the allow list"

Expected on the very first message. The reply contains your chat ID. Put it into
`TELEGRAM_ALLOWED_CHAT_IDS`, in Vercel as well as locally, and redeploy.

Adding an environment variable does **not** redeploy on its own:

```bash
npx vercel --prod
```

Several people: comma separated, no spaces needed -
`TELEGRAM_ALLOWED_CHAT_IDS=123456789,987654321`. Note that they share one
database - this is not multi-user, it is one log that several devices can write
to.

---

## "Something went wrong while saving"

The raw input was stored before the failure, so nothing is lost. Look at what
happened, in the Supabase SQL editor:

```sql
select ts, error, input from errors order by ts desc limit 10;
```

Common contents:

| Error | Cause |
|---|---|
| `relation "meals" does not exist` | `supabase/schema.sql` was never run, or ran in a different project |
| `new row violates row-level security` | you are using the `anon` key instead of `service_role` |
| `Anthropic HTTP 401` | wrong or revoked API key |
| `Anthropic HTTP 429` | rate limited, or out of credit |
| `model answered without a tool_use block` | the configured model does not support tool use |
| `upload photo: ... Bucket not found` | the storage bucket was not created - rerun the last statement of `schema.sql` |

---

## Entries land on the wrong day

`timezone` in `arnold.config.ts`. Serverless functions run in UTC; a dinner
logged at 23:30 in Berlin is already tomorrow in UTC.

```bash
node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"
```

Fix the config and redeploy. Entries written before the fix keep the day they
were written with - correct them in the chat ("that was yesterday") or in SQL.

---

## No energy balance, only intake

By design, and it means exactly one thing: there is no weight in the database at
all. Any weight is enough - fasted or not - because the basal rate falls back to
the most recent reading when there is no trend yet. Log one and the balance
appears.

```sql
select day, weight_kg, fasted from weights order by ts desc limit 10;
```

If that returns rows and you still see the message, the write is failing rather
than the calculation - check the `errors` table.

## No trend line, although weights are logged

Different problem, different cause. The trend counts **only** weigh-ins with
`fasted = true`. That flag is set automatically before 10:00 local time, and
stays `null` for a weight added for another day unless you said when you
measured it ("yesterday morning, fasted"). `null` deliberately does not count:
unknown is not the same as fasted, and one such entry is enough to drag the
trend and every decision that hangs off it.

The daily balance is unaffected by this - it uses the latest weight either way.

---

## The trend shows no rate

Below four measurement days, or a span under six days, the rate stays `null`.
Anything less is noise with a number attached. Keep weighing.

---

## Voice messages are ignored

`STT_PROVIDER` is `none` by default. Set it to `openai` or `groq`, add the
matching key (`OPENAI_API_KEY` or `GROQ_API_KEY`), redeploy.

If it is set and voice still fails, check the error table - a wrong key shows up
as `OpenAI transcription failed (HTTP 401)`.

---

## Photos are not recognised

- The model needs vision. `claude-sonnet-5` has it; a text-only model does not.
- Very large images are skipped in favour of a smaller size Telegram provides -
  if all sizes are over the limit, the photo is stored but not analysed.
- A photo of a scale app **is** recognised as a weight entry. Any other
  screenshot is not an entry; it is stored and answered conversationally.

The picture is always stored before it is classified, so it is in your bucket
either way.

---

## The same meal was logged twice

Two different causes:

**A recap message.** "So today I had eggs, then a salad..." after both were
already logged. The prompt tells the model to book only what is missing from the
"already logged" list. When it slips anyway: "delete the duplicate" works, and
the ids are in the context.

**A Telegram retry.** Prevented by the `processed_updates` table. If duplicates
appear in pairs seconds apart, check that this table exists and has rows:

```sql
select count(*) from processed_updates;
```

---

## The weekly report never arrives

- `coach.weeklyReportWeekday` is `null` -> switched off.
- Today is not that weekday - cron runs daily, the handler checks the day.
- Vercel's free plan runs cron jobs approximately, not to the minute.
- `TELEGRAM_ALLOWED_CHAT_IDS` is empty - there is nobody to send it to.

Force one to test:

```bash
curl -s "https://your-deployment.vercel.app/api/cron/report?force=1" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Or just send `/week` in the chat.

---

## Costs are higher than expected

Photos cost noticeably more than text. Check what has been running:

```sql
select source, count(*) from meals group by source;
```

Options: use the fast model for coaching too (`ARNOLD_COACH_MODEL`), or set
`coach.enabled: false` to keep receipts only. Receipts involve no model at all
and are free.

---

## Local development

The webhook needs a public HTTPS URL, so a tunnel:

```bash
npm run dev
npx localtunnel --port 3000        # or ngrok http 3000
npm run webhook -- https://your-tunnel-url
```

Remember to point the webhook back at production when you are done:

```bash
npm run webhook -- https://your-deployment.vercel.app
```

Tests need no network and no keys:

```bash
npm test
```

---

## Starting over

The data is yours and lives in your Supabase project. To wipe it without
dropping the schema:

```sql
truncate meals, weights, measurements, workouts, workout_sets, sleep,
         habit_entries, photos, messages, pending, processed_updates,
         coach_events, corrections_log, errors restart identity cascade;
```

That deliberately leaves `settings`, `assumptions` and `templates` alone. Add
them to the list if you want a genuinely blank start.
