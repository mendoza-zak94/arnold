# Agent setup guide

**You are reading this because someone asked you to set up Arnold for them.**

This document is the script. Follow it in order. Do not skip verification steps,
do not batch several steps into one message, and do not guess at a value the user
has not given you.

## How to run this

The user has a terminal and a browser. You have the repository.

- **You do:** file edits, shell commands, reading output, diagnosing failures.
- **The user does:** anything involving their accounts - creating the Telegram
  bot, creating the Supabase project, getting API keys, clicking Deploy.

After each step, verify before moving on. When something fails, fix that before
continuing; a later step built on a broken earlier one produces confusing
errors.

Ask for one thing at a time. The user is following along in a browser and cannot
answer four questions at once.

**Never print an API key, token, or service role key back to the user or into a
commit.** Write them into `.env.local` (gitignored) and refer to them by name
afterwards.

---

## Step 0: orient yourself

```bash
node --version    # must be 20 or higher
ls arnold.config.ts supabase/schema.sql
```

If `node --version` is below 20, stop and tell the user to install Node 20+
first ([nodejs.org](https://nodejs.org), or `brew install node` on macOS).

```bash
npm install
```

Expected: installs without errors. If it fails on a network error, retry once
before reporting it.

Then say to the user, in your own words:

> Setting this up needs four things from you: a Telegram bot, a Supabase
> project, an Anthropic API key, and a Vercel account. All have free tiers.
> I will walk you through them one at a time. Roughly fifteen minutes.

---

## Step 1: the Telegram bot

Ask the user to do this:

> 1. Open Telegram and search for **@BotFather**
> 2. Send `/newbot`
> 3. Give it a display name (anything, e.g. "Arnold")
> 4. Give it a username - it must end in `bot`, e.g. `christians_arnold_bot`
> 5. Paste me the token it gives you. It looks like `12345678:AAH-Long-String`

When you have the token, verify it before storing it:

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getMe"
```

Expected: `{"ok":true,"result":{...,"username":"..."}}`.

- `{"ok":false,"error_code":401}` -> the token is wrong. Ask for it again; the
  most common cause is a copy that cut off a character.

Confirm the bot's username back to the user so they know which bot to message
later.

---

## Step 2: the Anthropic API key

Ask the user:

> Go to [console.anthropic.com](https://console.anthropic.com), sign in, open
> **API keys**, create one, and paste it to me. It starts with `sk-ant-`.
> You will also need a few euros of credit on the account - this is what reads
> your food photos.

Do not verify it with a curl yet; `npm run check` in step 6 does that properly.

---

## Step 3: Supabase

Ask the user:

> 1. Go to [supabase.com](https://supabase.com) and create a project. The free
>    tier is enough. Pick a region near you. It takes a minute to provision.
> 2. When it is ready, open the **SQL Editor** from the left sidebar.

Then give them the schema. Read `supabase/schema.sql` and either paste its
contents into the chat, or tell them the file path to copy from:

> Copy everything in `supabase/schema.sql`, paste it into the SQL editor, and
> press **Run**. It should say "Success. No rows returned."

Then:

> Now open **Project Settings -> API**. I need two values:
> - the **Project URL** (looks like `https://abcdefgh.supabase.co`)
> - the **`service_role`** key (the long one, under "Project API keys" - NOT the
>   `anon` key)

If they paste the `anon` key by mistake, you will find out in step 6 - the
database check fails with a permissions error. The `anon` key is usually shorter
and the JWT payload says `"role":"anon"`.

---

## Step 4: write the environment file

Create `.env.local` with the four values you have plus a generated webhook
secret. Either run `npm run setup` and let the user answer the prompts, or write
the file directly:

```bash
cat > .env.local <<'EOF'
TELEGRAM_BOT_TOKEN=<from step 1>
TELEGRAM_WEBHOOK_SECRET=<generate: openssl rand -hex 32>
TELEGRAM_ALLOWED_CHAT_IDS=
ANTHROPIC_API_KEY=<from step 2>
SUPABASE_URL=<from step 3>
SUPABASE_SERVICE_ROLE_KEY=<from step 3>
STT_PROVIDER=none
EOF
chmod 600 .env.local
```

Leave `TELEGRAM_ALLOWED_CHAT_IDS` empty for now. Step 8 fills it in.

Verify (works for either route - `npm run setup` keeps the comments from
`.env.example`, so do not count lines, check the keys):

```bash
for k in TELEGRAM_BOT_TOKEN TELEGRAM_WEBHOOK_SECRET ANTHROPIC_API_KEY \
         SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
  grep -qE "^$k=.+" .env.local && echo "$k ok" || echo "$k MISSING"
done
git check-ignore .env.local     # should print .env.local
```

If `git check-ignore` prints nothing, `.gitignore` is broken - stop and fix it
before anything else. This file must never be committed.

---

## Step 5: the configuration file

Open `arnold.config.ts` and fill it in with the user. Ask for these, one message:

> A few things about you, so the numbers mean something:
> - How tall are you? (cm, or feet/inches if you prefer imperial)
> - What year were you born?
> - Which timezone are you in? (e.g. Europe/Berlin, America/New_York)
> - Is your goal to lose, maintain or gain?
> - Do you have a target weight, and by when?
> - What should I track besides food and weight? Alcohol, cigarettes, coffee,
>   water, steps - anything countable works.
> - Which language should Arnold reply in?

Then edit the file. Rules while editing:

- `height` is in cm when `units: 'metric'`, in inches when `'imperial'`. If they
  answer "5 foot 11", either set `units: 'imperial'` and `height: 71`, or convert
  to 180 and stay metric. Say which you did.
- `birthYear`, not age. The age is derived so it stays right.
- `timezone` must be a valid IANA name. If unsure, run
  `node -e "console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)"`
  and confirm it with the user.
- For each habit they name, add an entry to `trackers.habits` with a lowercase
  `id`, a `label`, and a `unit`. If it carries calories (alcohol does), set
  `kcalPerUnit` - a beer is roughly 150 to 200, a glass of wine 125.
- Switch off any tracker they do not want. `sleep: false` removes it entirely.
- Leave `activityFactor` at 1.3 unless they are clearly on their feet all day.
  Do not add training into it; workouts are counted separately.

Verify:

```bash
npm run typecheck
npm test
```

Expected: no type errors, all tests pass. A type error here is almost always a
typo in the config you just edited.

---

## Step 6: verify everything connects

```bash
npm run check
```

This connects for real. Work through failures in the order they are printed:

| Output | Fix |
|---|---|
| `connected, but the tables are missing` | Step 3's SQL was not run, or ran against a different project |
| `storage bucket arnold-photos missing` | the last statement of `schema.sql` did not run - run just that part again |
| `Telegram rejected the token` | wrong `TELEGRAM_BOT_TOKEN` |
| `HTTP 401` under Anthropic | wrong or revoked `ANTHROPIC_API_KEY` |
| `HTTP 404` under Anthropic | the model name is not available to this key - set `ARNOLD_MODEL` to one that is |
| `cannot reach Supabase` | wrong `SUPABASE_URL` (check for a trailing slash or a missing `https://`) |
| `no webhook registered` | expected at this point - step 7 does it |

Do not continue until everything except the webhook line passes.

---

## Step 7: deploy

Ask which the user prefers:

**Via the CLI** (fewer clicks):

```bash
npx vercel          # answers: link to existing? no. project name: arnold. defaults for the rest.
```

Then push the environment variables up. Do this per variable, reading the value
out of `.env.local`, and never echo it into the transcript:

```bash
npx vercel env add TELEGRAM_BOT_TOKEN production
npx vercel env add TELEGRAM_WEBHOOK_SECRET production
npx vercel env add ANTHROPIC_API_KEY production
npx vercel env add SUPABASE_URL production
npx vercel env add SUPABASE_SERVICE_ROLE_KEY production
npx vercel env add TELEGRAM_ALLOWED_CHAT_IDS production   # empty for now, fill in step 8
```

Then:

```bash
npx vercel --prod
```

**Via GitHub** (better if they want redeploys on push): the user creates a repo,
pushes, imports it at [vercel.com/new](https://vercel.com/new), and pastes the
variables into Settings -> Environment Variables.

Note the production URL. Verify the deployment is alive:

```bash
curl -s https://<their-url>/api/health | head -40
```

Expected: JSON with `"checks"`. The `allow-list` check will be failing - that is
correct at this point. If you get an HTML error page instead, the build failed;
check the Vercel build log.

---

## Step 8: connect Telegram and let the user in

```bash
npm run webhook -- https://<their-url>
```

Expected: `ok    webhook set to https://<their-url>/api/telegram`

Now ask the user:

> Open Telegram, find your bot (@the-username-from-step-1) and send it any
> message, for example "hello".

They will get back: "This bot is private and your chat is not on the allow
list. Your chat ID is 123456789".

That number is the point of the exercise. Add it:

1. to `.env.local` as `TELEGRAM_ALLOWED_CHAT_IDS=123456789`
2. to Vercel: `npx vercel env rm TELEGRAM_ALLOWED_CHAT_IDS production` then
   `npx vercel env add TELEGRAM_ALLOWED_CHAT_IDS production` with the value
3. redeploy: `npx vercel --prod`

If they got no reply at all, see the troubleshooting table below.

---

## Step 9: the real test

Ask the user to send three messages and report what came back:

1. `/today` - should answer with an empty day, no error
2. "two eggs and a slice of toast" - should log it with a calorie number
3. a photo of anything edible - should log it with a description

Then check the data actually landed:

```bash
curl -s https://<their-url>/api/health | grep -o '"ok":[a-z]*' | head -1
```

Expected `"ok":true`.

If message 2 logged but message 3 did not, the storage bucket or the model's
vision access is the problem - check `npm run check` again.

---

## Step 10: hand over

Tell the user what they now have, concretely:

> Done. Your bot is live at `<url>`.
>
> - Just talk to it: what you ate, what you weigh, what you trained.
> - `/today` for the current state, `/week` for the weekly report,
>   `/settings` for the numbers it calculates with.
> - Corrections work in plain language: "delete that", "it was yesterday".
> - It asks at most one question per entry, and your entry is already saved
>   when it does.
> - The weekly report arrives on <weekday from the config>.
>
> To change what it tracks, edit `arnold.config.ts` and redeploy. To change your
> height or target, just tell it in the chat.

Offer, but do not do unasked:

- switching on voice messages (needs an OpenAI or Groq key)
- adding more habits to track
- changing the reply language

---

## Troubleshooting

**The bot never answers anything**

```bash
npm run webhook          # shows the registered URL and the last error
```

- `last_error_message: Wrong response from the webhook: 403 Forbidden` ->
  `TELEGRAM_WEBHOOK_SECRET` in Vercel differs from the one used when the webhook
  was registered. Set them to the same value, redeploy, register again.
- `webhook: (none)` -> step 8 was never run, or a later `vercel` command reset
  the deployment URL.
- URL is set and no error, but still silence -> check the Vercel function logs
  (`npx vercel logs <url>`) for the actual exception.

**It answers, but says "Something went wrong while saving"**

The error is stored. Look at it:

```sql
select ts, error, input from errors order by ts desc limit 5;
```

Run that in the Supabase SQL editor.

**Entries land on the wrong day**

`timezone` in `arnold.config.ts` is wrong, or was changed after entries existed.
Fix the config; past entries keep the day they were written with.

**"the model answered without a tool_use block"**

The configured model does not support tool use, or the name is wrong. Check
`models.classify` in `arnold.config.ts` against the models your key can reach.

**Everything works locally but not deployed**

The environment variables exist in `.env.local` but not in Vercel, or were added
after the last deploy. Adding a variable does not redeploy - run
`npx vercel --prod` again.

---

## What not to do

- Do not commit `.env.local`, or any file containing a key.
- Do not put the Supabase `anon` key in `SUPABASE_SERVICE_ROLE_KEY`. Writes will
  fail in ways that look like schema problems.
- Do not leave `TELEGRAM_ALLOWED_CHAT_IDS` empty and call it done. An empty allow
  list means the bot works for nobody; a wrong one means it works for someone
  else.
- Do not invent values the user did not give you - especially height, birth year
  and timezone. Every number Arnold reports is built on those, and a wrong one is
  invisible for weeks.
- Do not modify files under `lib/` to make setup work. If something needs a code
  change to get running, that is a bug worth reporting, not a local patch.
