# Contributing

Arnold is a personal tool that happens to be open source. Pull requests are
welcome; so is forking it and never speaking to anyone.

## Before opening a PR

```bash
npm run typecheck
npm test
npm run build
```

All three green. Tests run without network access and without any API key - if
your change breaks that, the logic probably belongs in a purer layer.

## What gets merged easily

- Bug fixes with a test that fails before and passes after
- A new language in `lib/i18n.ts`
- Better prompt rules, **with the reason written into the comment**
- Documentation that removes a step someone got stuck on

## What needs discussion first

- New dependencies. The list is short on purpose: Next, React, the Anthropic SDK
  and the Supabase client. A dependency here is something every user has to trust.
- Anything that makes a number appear where the data does not support one.
- Multi-user support. It would mean auth, RLS policies and a UI, and that is a
  different project rather than a bigger version of this one.
- Moving a decision out of `lib/coach.ts` and into a prompt.

## House style

Read [`AGENTS.md`](AGENTS.md). The short version:

- Comments say **why**, not what. The rules in `lib/prompt.ts` exist because a
  specific thing went wrong; keep the reason next to the rule.
- Unknown is `null` and gets said out loud. No silent averages, no plausible
  defaults.
- Pure logic stays pure. `trend.ts`, `energy.ts` and `coach.ts` must not learn
  what a database is.

## Reporting a bug

Useful report:

- what you sent (message text, or "photo of X")
- what Arnold replied
- what you expected
- the relevant row from the `errors` table if there is one
- your `arnold.config.ts` **with the personal numbers removed**

Never paste a token, an API key, or a `service_role` key into an issue. If you
do by accident, rotate it immediately - it is public the moment it is posted.
