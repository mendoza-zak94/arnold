# How Arnold works

Short version: one webhook, two model calls at most, and a decision tree written
in TypeScript rather than in a prompt.

---

## The path of a message

```
Telegram
   |
   |  POST /api/telegram, with a secret header
   v
app/api/telegram/route.ts     verifies the secret, hands over, always answers 200
   |
   v
lib/handle.ts
   |
   |-- 1. allow list          lib/env.ts          strangers get their chat ID, not access
   |-- 2. duplicate check     lib/db.ts           Telegram retries; a primary key stops the double
   |-- 3. resolve content     lib/telegram.ts     text, photo, or voice -> lib/stt.ts
   |-- 4. store the photo     lib/db.ts           BEFORE it is classified or judged
   |-- 5. gather context      lib/db.ts           logged today + yesterday, templates,
   |                                              assumptions, recent turns, open question
   |-- 6. classify            lib/classify.ts     one call, forced tool use
   |-- 7. record              lib/record.ts       corrections first, then new rows
   |-- 8. receipt             lib/reply.ts        deterministic, no model, sent immediately
   |-- 9. coaching            lib/coach.ts        only if a rule fired, after the receipt
   v
Supabase
```

Every step from 4 onwards can fail without taking the others down. The photo is
stored before anything is decided about it; a bad workout does not lose the meal
in the same message; a failed coaching call is logged and never shown.

---

## Why the work happens before the response

Serverless functions stop executing when they return. "Reply 200 instantly and
finish in the background" means "reply instantly and never finish" - so the
whole turn runs inside the request, which takes a few seconds and is well inside
Telegram's patience.

The route answers **200 in every case that is not "please retry"**. Telegram
treats anything else as a failed delivery and resends, so a 500 on an unreadable
photo would mean that photo arriving again every few seconds. Real failures are
written to the `errors` table and reported to the user in the chat.

---

## Two models, two jobs

| | Logging | Coaching |
|---|---|---|
| Model | fast (Sonnet by default) | slower (Opus by default) |
| Call shape | forced tool use, schema generated from your config | free text |
| Runs | on every entry | only when a rule fired |
| Sees | your message, plus context | pre-computed numbers, never raw rows |

Logging has to finish in seconds or the habit does not survive the first week.
Coaching is allowed to think, and is off the critical path entirely: the receipt
is already sent when it starts.

### Forced tool use, not "reply with JSON"

The classifier is required to call one tool
([`lib/schema.ts`](../lib/schema.ts)). It therefore cannot put a friendly
sentence in front of the payload and break the parser, and each field carries its
description exactly where the model reads it.

### The schema is generated

`buildTool(config)` builds the input schema from `arnold.config.ts`. A tracker
you switched off is not in the schema, so the model cannot book it. A habit you
added is in the `habit_id` enum, so it can. This is what makes "adjustable"
mean something more than a comment saying "edit this if you like".

---

## The context the classifier gets

This is where most of the correctness lives. Every block exists because its
absence produced a specific bug:

| Block | Without it |
|---|---|
| Already logged today, with ids | a recap message ("so today I had...") books breakfast a second time |
| The same ids | corrections cannot address anything, so "delete that" creates a new row |
| Yesterday's entries | corrections arriving the morning after cannot find their target |
| Named templates | "my usual breakfast" gets re-estimated to a different number every day |
| Standing assumptions | you re-explain your mayonnaise every week |
| Recent conversation | "and two more eggs with that" lands on nothing |
| The open question | the answer to "how much rice?" is treated as a new meal |

---

## The decision tree is code

[`lib/coach.ts`](../lib/coach.ts), `decide()`. In order:

1. **thin data** - fewer weigh-ins or logged days than configured -> no
   adjustment at all. When logging is patchy, what changed is the data, not the
   body. Every rule below is skipped.
2. **too fast** - above the band -> eat more. Above roughly 1 %/week, lean mass
   goes with the fat.
3. **strength falling** - a majority of tracked lifts down -> eat more. Strength
   drops before the scale reflects it.
4. **inside the band** -> say so, change nothing. Most weeks end here.
5. **stalled three weeks** -> move more, do not cut further. One flat week is
   indistinguishable from water retention; three is a signal.
6. **otherwise** -> keep watching.

Order matters and is tested. Rules 2 and 3 can both be true at once - losing too
fast is the cause, falling strength the symptom - and the test asserts that the
cause wins.

The model receives the resulting code and phrases it. It never decides.

---

## Why the numbers are the way they are

### Trend weight, never a single reading

Four weigh-ins within 35 minutes can differ by half a kilo, from a phone in your
hand and different clothes. Handling is the largest error source in body weight
measurement, larger than anything the scale gets wrong.

[`lib/trend.ts`](../lib/trend.ts) therefore keeps an exponentially weighted
moving average over daily fasted averages. Each measurement day pulls the trend
30 % of the way towards itself; outliers fade; a week without weighing does not
move it at all.

The rate comes from a least squares fit over the trend points of the last 14
days, not from the difference between two points - a regression carries calendar
time correctly even when days are missing. Below four measurement days or a span
under six days, the rate is `null` rather than a number.

Only weigh-ins explicitly marked fasted count. A weight added later has an
unknown measurement time, and "unknown" must not silently become "fasted" -
one such entry is enough to drag the average, the rate, and every decision that
hangs off them.

### Energy expenditure, with the double count removed

```
BMR (Mifflin-St Jeor, from the trend weight)
  x activityFactor   everything except training
  + workouts NET     logged calories minus the resting burn of that same time
```

That last subtraction is where these calculations usually go wrong. An hour of
strength training at 420 kcal contains roughly 76 kcal you would have burned
sitting on the sofa. Count the gross figure and every session is counted twice.

### Nothing is invented

Without a weight there is no expenditure, no balance and no target - the receipt
says so instead of showing a plausible number. Workout calories are never guessed
from a description alone: "went for a run" with no distance produces a question,
not a default 5 km. Food is the one exception, because a standard portion is a
defensible assumption and an invented distance is not.

---

## Data model

One table per thing, plus a generic one for habits.

| Table | Holds |
|---|---|
| `meals` | description, itemised breakdown, kcal, macros, confidence, source, photo |
| `weights` | weight, body fat, muscle, water, raw impedance, fasted flag |
| `measurements` | tape measure readings, normalised to cm |
| `workouts` + `workout_sets` | session, and the individual sets that make progression visible |
| `sleep` | bedtime, wake time, hours, quality |
| `habit_entries` | everything from `trackers.habits` - one table, no migration per habit |
| `templates` | named building blocks with their stored values |
| `assumptions` | standing rules |
| `settings` | what you changed from the chat; overrides the config file |
| `messages` | short conversation memory |
| `pending` | the one open follow-up question per chat |
| `processed_updates` | Telegram retry protection - a claim, not a tombstone: `done` is set only after an answer went out, so a turn killed by the platform's time limit gets retried instead of being discarded |
| `coach_events` | one trigger per code per day |
| `corrections_log` | the previous state of everything ever corrected |
| `photos` | what was stored, and which meal it belongs to |
| `errors` | raw input plus the failure, so nothing disappears quietly |

Two deliberate choices:

- **`meals.items` keeps the breakdown.** A wrong total can be recomputed later
  without asking you again what you ate.
- **`weights.impedance_ohm` keeps the raw value.** Body fat percentage is not a
  measurement, it is a formula over impedance, weight, height, age and sex. With
  the raw number, a better formula can be applied to your whole history.

Aggregation happens in TypeScript, not SQL. One person logging food produces a
handful of rows a day, and pure functions over arrays are testable with no
database at all - which is why `lib/trend.ts`, `lib/energy.ts` and `lib/coach.ts`
have no idea Supabase exists.

---

## Security

- **Webhook secret.** Registered with `setWebhook`, echoed by Telegram on every
  call, checked before anything else. Without it the endpoint is a public write
  path into your health record.
- **Allow list.** Only chat IDs in `TELEGRAM_ALLOWED_CHAT_IDS` can write. Empty
  means nobody, and the reply hands the sender their chat ID so you can add it.
- **RLS on every table, no policies.** The service role key bypasses row level
  security; `anon` and `authenticated` get nothing. If you ever build a UI with
  logins, add policies then.
- **Private photo bucket.** Reachable only through time limited signed URLs.
- **Corrections are whitelisted per column** (`CORRECTABLE` in
  [`lib/db.ts`](../lib/db.ts)). A model that can write arbitrary columns can also
  write nonsense into `source` or `id`.

---

## What is deliberately missing

- **No web dashboard.** The data is in your Postgres; query it, or ask Arnold.
- **No user accounts.** One deployment, one person. Multi-tenancy would mean
  auth, RLS policies and a UI - a different project.
- **No food database.** Model estimates, with the itemised breakdown kept so a
  correction is cheap. A barcode scanner would be a genuinely useful addition.
- **No background jobs beyond the weekly report.** Everything else happens in
  the request that caused it.
