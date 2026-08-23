# Working on Arnold

Context for coding agents. If you were asked to **set Arnold up** rather than
change it, read [`docs/AGENT_SETUP.md`](docs/AGENT_SETUP.md) instead - this file
is about modifying the code.

## What this is

A Telegram bot that logs food, weight, training and habits by conversation.
Next.js on Vercel, Postgres on Supabase, Claude for understanding messages.
Single user per deployment.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before changing anything
across more than one file.

## Layout

```
arnold.config.ts       the one file users are meant to edit
app/api/telegram/      the webhook - one route, everything arrives here
app/api/health/        machine readable status, used by setup and diagnostics
app/api/cron/report/   weekly report, daily cron with a weekday check
lib/
  handle.ts            orchestration: one update from arrival to answer
  classify.ts          message -> structured entry (one model call)
  schema.ts            the tool schema, GENERATED from the config
  prompt.ts            system prompt and context blocks
  record.ts            structured entry -> database rows
  reply.ts             the receipt (deterministic, no model)
  coach.ts             the decision tree (pure)
  trend.ts             EWMA trend weight and rate (pure)
  energy.ts            BMR, expenditure, net workout calories (pure)
  state.ts             assembles "where things stand" once, for everyone
  advise.ts            the model calls that are allowed to think
  db.ts telegram.ts claude.ts stt.ts env.ts config.ts i18n.ts time.ts
supabase/schema.sql    idempotent; it is also the migration path
scripts/               setup, check, webhook - plain Node, no dependencies
test/                  vitest, no network, no keys
```

## Rules that are not negotiable

**Never invent a number.** Unknown is `null`, and the reply says so. This is the
single most important property of the whole project: an invented figure in an
energy balance is worse than a missing one, because you cannot see that it is
wrong. Do not add a fallback that quietly fills a gap with an average.

**Workouts are never estimated from a description alone.** Food is - a standard
portion is a defensible assumption. A distance is not. See `estimateWorkoutKcal`
in `lib/energy.ts` for exactly how narrow the fallback is, and why the running
formula must not be applied to cycling.

**The receipt never calls a model.** It is deterministic, it is the fast path,
and it is also the failure detector: if it stops arriving, something is broken.
Coaching happens after it is sent, and never blocks it.

**The decision tree stays in code.** `lib/coach.ts` decides; a model phrases.
A rule you move into a prompt is a rule you can no longer test.

**The webhook always answers 200** unless the request should genuinely be
retried. A non-200 makes Telegram resend, which turns one bad photo into a loop.

**The comments explaining WHY stay.** Most rules in `lib/prompt.ts` and the
thresholds in `lib/coach.ts` exist because the obvious behaviour failed in a
specific, repeatable way. Without the reason written down, the next tidy-up
removes exactly the sentence that was doing the work. If you change a rule,
change its comment; do not delete it.

## Conventions

- TypeScript, `strict`. No `any` that a real type could replace.
- Comments say why, not what. `// increment i` is noise; `// corrections first,
  or the receipt shows a total that was already stale` is the reason the code
  is ordered that way.
- Pure logic stays pure: `trend.ts`, `energy.ts`, `coach.ts` take plain arrays
  and return values. They must not learn about Supabase.
- New database columns go into `supabase/schema.sql` with `if not exists`, so
  the file stays runnable against an existing project.
- Corrections need their column in `CORRECTABLE` in `lib/db.ts`. That list is a
  fence, not documentation.
- Everything user-facing that is not written by a model goes through
  `lib/i18n.ts`, with an English fallback.
- Days are `YYYY-MM-DD` in the user's timezone, always via `lib/time.ts`.
  Never `new Date().toISOString().slice(0,10)`.

## Before you say it is done

```bash
npm run typecheck
npm test
npm run build
```

All three must pass. Tests need no network and no API key - if a change makes
that untrue, the change is in the wrong layer.

For anything touching the model path, also test against a real deployment: send
a text entry, a photo, and a correction, and confirm the receipt numbers match
what is in the database.

## Adding a tracker

If it is countable, it needs no code - it is an entry in `trackers.habits` in
`arnold.config.ts`. See [`docs/CUSTOMIZE.md`](docs/CUSTOMIZE.md).

Something structurally different needs four edits, in this order: schema, `db.ts`,
`schema.ts` (the tool), `record.ts`. Guard the tool field with a config flag so
it can be switched off, and add a test to `test/schema.test.ts` proving that it
disappears when it is.

## Things that look like bugs and are not

- **No energy balance without a weight.** Deliberate.
- **Rate is null below four measurement days.** Deliberate.
- **Weights with `fasted = null` do not count.** Deliberate - unknown is not
  fasted.
- **Coaching stays silent most days.** Deliberate. A coach that comments on
  every entry gets muted, and a muted coach has no effect at all.
- **Receipts show `!` lines for partial failures.** Deliberate. Half a message
  logging is normal; hiding the half that did not is what would be wrong.
- **A rejected settings change is a `!` line, not a stored value.** Deliberate.
  Anything a chat message can change goes through the same bounds as the config
  file (`validateSettings`), because a wrong height is invisible afterwards.
