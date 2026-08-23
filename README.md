# Arnold

A health tracker you talk to. Send a photo of your plate, say "two beers and a
20 minute walk", step on a scale and tell it the number. It answers in seconds
with what it logged and where your day stands.

No app to open, no database of foods to search, no portion picker. Just a
Telegram chat.

```
You    [photo of a plate]
       had this for lunch

Arnold Logged: grilled salmon, potatoes, green beans (640 kcal)

       Today: 1,420 in / 2,510 out - deficit 1,090 kcal. Target 1,870, 450 left.
       Protein 96 / 152 g.
       Trend: 84.2 kg, -0.62 kg per week (-0.74 %). 5 of the last 7 days.

You    forgot to say, two beers last night

Arnold Logged: Alcohol 2 drinks
       Alcohol 2 drinks, 300 kcal
       ...

You    actually that photo was 300 g of salmon not 180

Arnold Updated: grilled salmon, potatoes, green beans (640 kcal) (portion corrected)

       Today: 1,600 in / 2,510 out - deficit 910 kcal. Target 1,870, 270 left.
```

It runs on free tiers: Vercel for the code, Supabase for the database, and your
own Anthropic API key for the intelligence. Setup takes about fifteen minutes,
and there is a walkthrough below that an LLM can run with you step by step.

---

## What it tracks

| | |
|---|---|
| **Food** | text, voice or a photo of the plate. Calories and macros estimated per item |
| **Weight** | typed in, or from a photo of your scale's app |
| **Body measurements** | waist, chest, arms - the tape measure catches what a scale cannot |
| **Training** | duration, distance, pace, and individual sets with reps and weight |
| **Sleep** | "in bed at 23, up at 6" |
| **Anything countable** | alcohol, cigarettes, coffee, water, steps - you define them in one config file |

Alcohol counts into your calorie balance if you want it to. That single detail
is the most common reason a deficit exists on paper and nowhere else.

### It also handles the messy parts

- **Corrections at any time.** "delete the duplicate", "that was yesterday",
  "it was only 200 g". Nothing is silently overwritten - the previous state is
  kept.
- **Standing assumptions.** Say "my mayo is always the light one" once and it
  applies from then on.
- **Named templates.** Define "my usual breakfast" once, then just say the name.
  With a deviation ("without the banana") the numbers are recomputed, not faked.
- **One follow-up question, at most.** And your entry is already saved when it
  asks - the answer corrects it rather than starting over.
- **Questions get answers.** "how much protein is in 200 g of skyr?" is not an
  entry, so it does not become a database row. You get an answer.

---

## Setup

### Option A: let an LLM do it with you

This is the fastest route if you have Claude Code, Cursor, or any coding agent.

```bash
git clone https://github.com/YOUR-USERNAME/arnold.git
cd arnold
```

Then tell your agent:

> Read `docs/AGENT_SETUP.md` and set up Arnold for me. Ask me for anything you
> need and walk me through it step by step.

[`docs/AGENT_SETUP.md`](docs/AGENT_SETUP.md) is written for a machine reader:
numbered steps, exact commands, verification after each one, and what to do when
a step fails. The agent handles the files and the CLI; you handle the browser
tabs and the API keys, because those need your accounts.

### Option B: do it yourself

Fifteen minutes, six steps.

**1. Get the code and install**

```bash
git clone https://github.com/YOUR-USERNAME/arnold.git
cd arnold
npm install
```

**2. Create the Telegram bot**

Open Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot` and
follow the prompts. You get a token that looks like `12345678:AAH...`. Keep it.

**3. Create the database**

Sign up at [supabase.com](https://supabase.com) and create a project (the free
tier is plenty - this is a few kilobytes per week). Then:

- open the **SQL Editor**, paste the entire contents of
  [`supabase/schema.sql`](supabase/schema.sql), press Run
- go to **Project Settings -> API** and copy the **Project URL** and the
  **`service_role`** key

The `service_role` key bypasses row level security. It belongs on your server and
nowhere else - never in a browser, never in a repository.

**4. Fill in your settings**

```bash
npm run setup
```

This asks for the five values it needs, generates a webhook secret, and writes
`.env.local`. Then open [`arnold.config.ts`](arnold.config.ts) and set your
height, birth year, timezone, goal, and what you want tracked. Every field is
commented.

**5. Deploy**

```bash
npx vercel        # first run links the project
npx vercel --prod
```

Then add the same environment variables in the Vercel dashboard under
**Settings -> Environment Variables** (or run `npx vercel env pull` /
`npx vercel env add` for each). Redeploy after adding them.

**6. Connect Telegram and verify**

```bash
npm run webhook -- https://your-deployment.vercel.app
npm run check
```

`npm run check` connects to everything for real - Supabase, Telegram, Anthropic -
and tells you exactly which thing is broken if one is. Then message your bot.

**7. Let yourself in**

The first message tells you your chat ID. Put it into
`TELEGRAM_ALLOWED_CHAT_IDS` in Vercel and redeploy. Until you do, nobody can
write to your database - including you. That is deliberate: an open bot is a
stranger with write access to your health record.

---

## Making it yours

Everything lives in [`arnold.config.ts`](arnold.config.ts). Adding a tracker
needs no code and no migration, because the tool schema the model fills in is
generated from this file:

```ts
habits: [
  { id: 'alcohol',    label: 'Alcohol',    unit: 'drinks',     kcalPerUnit: 150, dailyLimit: 2, goal: 'less' },
  { id: 'cigarettes', label: 'Cigarettes', unit: 'cigarettes', dailyLimit: 0,    goal: 'less' },
  { id: 'water',      label: 'Water',      unit: 'glasses',    goal: 'more' },
  // add your own:
  { id: 'caffeine',   label: 'Coffee',     unit: 'cups',       dailyLimit: 4,    goal: 'less' },
  { id: 'meditation', label: 'Meditation', unit: 'minutes',    goal: 'more' },
],
```

Redeploy and you can log it by talking about it.

Other things worth setting:

| Setting | What it does |
|---|---|
| `language` | what Arnold replies in. Any language the model speaks |
| `units` | `metric` or `imperial` - converted at the edges, stored metric |
| `goal.direction` | `lose`, `maintain` or `gain`. The whole decision tree mirrors it |
| `goal.dailyCalories` | `'auto'` derives it from your expenditure and moves with your weight |
| `goal.weeklyRatePct` | the safe band. Arnold pushes back when you leave it, in either direction |
| `trackers.*` | switch anything off and it disappears from the schema entirely |
| `coach.enabled` | whether it comments beyond the receipt |
| `models` | which Claude model does the logging and which does the coaching |

You can also change facts from the chat: "I'm 183 tall", "target is 78 by
Christmas". Those are stored in the database and win over the file - after
passing the same bounds check the file has to pass, so a garbled voice message
gets rejected rather than quietly poisoning every calculation. `/settings` shows
what is currently in effect and which values came from the chat.

More in [`docs/CUSTOMIZE.md`](docs/CUSTOMIZE.md).

---

## What it costs

| | Free tier | What Arnold uses |
|---|---|---|
| **Vercel** | Hobby, free | one function per message, well inside the limit |
| **Supabase** | free project | a few MB a year, plus photos |
| **Anthropic** | pay as you go | roughly 1 to 3 cents per logged message; photos cost more than text |
| **Telegram** | free | - |

A normal week of tracking costs well under a euro in API calls. There is no
subscription and no account to cancel - it is your infrastructure.

---

## How it works

```
Telegram
   |  webhook (POST, secret header)
   v
/api/telegram  ------------------------------------------------+
   |                                                           |
   |  1. allow list        strangers get their chat ID, not write access
   |  2. duplicate check   Telegram retries; the entry must not double
   |  3. store the photo   BEFORE anything is judged about it
   |  4. classify          Claude Sonnet, forced tool use, schema from your config
   |  5. record            corrections first, then new rows
   |  6. receipt           deterministic, no second model call, sent immediately
   |  7. coaching          only when a rule fired, and never blocking the receipt
   +-----------------------------------------------------------+
   |
   v
Supabase (Postgres + photo storage)
```

Two models, two jobs. Logging has to finish in seconds or you stop using it, so
that is a fast model with a narrow schema. Coaching is allowed to think, and only
runs when the rules in [`lib/coach.ts`](lib/coach.ts) say there is a reason.

**The decision tree is code, not a prompt.** The model never decides whether you
should eat more; it phrases a decision that was already made, in this order:

1. thin data - no adjustment at all, because what changed is the data, not you
2. losing too fast - eat more, above ~1 %/week lean mass goes with it
3. strength falling - eat more, strength drops before the scale shows it
4. inside the band - say so and change nothing
5. stalled three weeks - move more, do not cut further
6. otherwise - keep watching

That order is tested. A prompt that produced this reasoning could not be.

More in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Honesty about the numbers

- **Estimated calories are estimates.** A photo gets you within maybe 15 % on a
  good day. That is fine for tracking a trend and useless for a single meal.
- **Body fat percentage from a scale is a formula, not a measurement.** Foot to
  foot bio-impedance sits 3 to 8 percentage points away from a DEXA scan and
  systematically underestimates belly fat, because the current runs through your
  legs. Arnold stores the raw impedance when it has it, so a better formula can
  be applied to your history later.
- **Weight is noisy.** Four weigh-ins within 35 minutes can differ by half a
  kilo - from a phone in your hand and different clothes, not from your body.
  Everything here works on a smoothed trend, never a single reading.
- **Without a weight there is no energy balance.** You get `null` and a note,
  not a plausible looking number. An invented figure in a balance is worse than
  a missing one, because you cannot see that it is wrong.
- **Arnold is not a doctor.** It has no idea about your medication, your thyroid,
  or your history. It tracks what you tell it and applies rules from sports
  science literature. Talk to an actual professional before doing anything
  drastic.

---

## Privacy

Your data lives in **your** Supabase project and nowhere else. There is no
shared backend, no analytics, no third party besides the model provider that
sees your messages.

- The webhook rejects anything without your secret header.
- Only chat IDs on your allow list can write.
- Row level security is on for every table; the service role key never leaves
  the server.
- Photos are in a private bucket, reachable only through time limited links.
- Message text goes to Anthropic to be understood, and to your speech to text
  provider if you enable voice. That is the whole list.

---

## Development

```bash
npm run dev        # local server on :3000
npm test           # 131 tests, no network, no API key needed
npm run typecheck
npm run check      # verify a real deployment end to end
npm run live       # one real API call: does the model understand your schema?
```

`npm run live` is the only thing here that costs money (a fraction of a cent).
It is worth running once after you change `arnold.config.ts`, because it checks
the thing the offline tests cannot: that the model actually fills in the tool
schema your config generated, and that it still refuses to invent a distance for
"went for a run".

The interesting logic is deliberately pure and database-free, which is why it
can be tested without any infrastructure:

- [`lib/trend.ts`](lib/trend.ts) - smoothed trend weight and the rate regression
- [`lib/energy.ts`](lib/energy.ts) - BMR, expenditure, the net workout subtraction
- [`lib/coach.ts`](lib/coach.ts) - the decision tree
- [`lib/schema.ts`](lib/schema.ts) - the tool schema, generated from your config

For local testing you need a public URL for the webhook: run `npm run dev` and
point a tunnel at it (`npx localtunnel --port 3000`), then
`npm run webhook -- https://your-tunnel-url`.

---

## Troubleshooting

| Symptom | Usually |
|---|---|
| Bot says nothing at all | webhook not set, or `TELEGRAM_WEBHOOK_SECRET` differs between your local file and Vercel |
| "your chat is not on the allow list" | expected on first contact - copy the chat ID it gives you into `TELEGRAM_ALLOWED_CHAT_IDS` |
| "the schema is missing" | `supabase/schema.sql` was never run in the SQL editor |
| Every entry lands on the wrong day | `timezone` in `arnold.config.ts` |
| No energy balance | no weight logged yet - by design |
| Voice notes ignored | `STT_PROVIDER` is `none`; set it to `openai` or `groq` with the matching key |

`npm run check` diagnoses all of these. More in
[`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md).

---

## Credits

Arnold is a rewrite of a personal tracker that ran on a Mac Mini with a local
SQLite file and a Bluetooth scale. Most of the rules in the prompt are scar
tissue from that year: every "never guess a workout" and "recompute on deviation"
exists because the obvious behaviour turned out to be wrong in a specific,
repeatable way. Those comments were kept - they are the reason the code looks the
way it does.

The coaching logic follows published work rather than opinion: feedback plus goal
review as the difference between tracking and coaching (Michie 2009), the rate
band and lean mass (Garthe 2011, Helms 2014), no adjustment on thin data and
patience before reacting to a plateau (the MacroFactor approach), and the
finding that a missed daily goal sharply reduces the odds of the next coaching
message being read at all (Hurley 2024) - which is why Arnold stays quiet unless
a rule actually fired.

MIT licensed. Do what you like with it.
