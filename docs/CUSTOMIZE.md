# Customising Arnold

Everything in this file is a change to `arnold.config.ts` unless it says
otherwise. After editing, run `npm test && npm run typecheck`, then redeploy
(`npx vercel --prod`).

---

## Track something new

The tool schema Claude fills in is generated from your config
([`lib/schema.ts`](../lib/schema.ts)). Add an entry, redeploy, and you can log it
by talking about it. No migration, no prompt editing.

```ts
trackers: {
  habits: [
    { id: 'caffeine', label: 'Coffee', unit: 'cups', dailyLimit: 4, goal: 'less' },
  ],
}
```

| Field | Meaning |
|---|---|
| `id` | lowercase key stored in the database. Renaming it orphans the history |
| `label` | what Arnold calls it in replies |
| `unit` | what one counts: `drinks`, `cigarettes`, `glasses`, `minutes`, `steps` |
| `kcalPerUnit` | optional. If set, entries count into the daily calorie balance |
| `dailyLimit` | optional. Arnold mentions it once a day when you go over |
| `goal` | `less`, `more` or `track` - direction for the weekly report |

Useful reference values for `kcalPerUnit`: a 0.5 l beer is roughly 200, a 0.33 l
beer 140, a glass of wine 125, a shot of spirits 100, a can of soft drink 140.
Set it to what you actually drink, not an average.

Anything with no calories - cigarettes, steps, meditation minutes - simply omits
the field.

### Switch a tracker off

```ts
trackers: { meals: true, weight: true, workouts: true, measurements: false, sleep: false, habits: [] }
```

A tracker that is off is removed from the schema entirely, so the model cannot
book it even if you talk about it. Existing rows stay in the database and are
simply no longer written to.

---

## Change the language

```ts
language: 'de',   // or 'francais', 'espanol', 'portugues', 'nederlands', ...
```

Two layers are involved:

1. **What the model writes** - descriptions, questions, coaching. Any language
   works; the instruction is passed straight through
   ([`lib/prompt.ts`](../lib/prompt.ts), `languageInstruction`).
2. **Fixed strings** - "Logged", "deficit", "Trend". These ship for `en` and
   `de` in [`lib/i18n.ts`](../lib/i18n.ts).

With any other value, the model writes in your language while the fixed labels
stay English. To translate them properly, copy the `en` object in `i18n.ts`,
translate the values, and register it:

```ts
const fr: Strings = { logged: 'Enregistre', today: "Aujourd'hui", /* ... */ };

const TABLES: Record<string, Strings> = {
  en, english: en,
  de, deutsch: de, german: de,
  fr, francais: fr, french: fr,
};
```

Number formatting follows the language too - German gets `1.840`, English
`1,840`.

---

## Metric or imperial

```ts
units: 'imperial',
profile: { height: 71 },      // inches
goal:    { targetWeight: 176 } // pounds
```

Storage is always metric; conversion happens when reading your messages and when
writing replies. That keeps history comparable if you ever switch.

Note that the model is told which system you speak, so "I'm 176" is read as
pounds, not kilograms.

---

## Calorie targets

```ts
goal: {
  dailyCalories: 'auto',   // or a fixed number: 2200
}
```

`'auto'` takes the middle of your rate band, applies it to your current weight,
converts that into a daily deficit or surplus, and subtracts it from what the day
actually costs. It therefore moves as you lose weight, rather than being a number
you wrote down when you were heavier.

The formula is in [`lib/energy.ts`](../lib/energy.ts) (`calorieTarget`) and never
returns below 1,200 kcal.

A fixed number overrides all of it - useful if you are following a plan someone
else wrote.

---

## The safe rate band

```ts
goal: { weeklyRatePct: { min: 0.5, max: 1.0 } },
```

Percent of body weight per week. Above roughly 1 %/week, lean mass goes with the
fat (Garthe 2011). Below 0.5 %/week, the change is hard to distinguish from
water. Arnold pushes back at both ends.

Widen it if you know what you are doing. Do not set the maximum above 1.5 unless
you have a specific reason and a short timeframe.

For `direction: 'gain'` the same numbers apply upwards, and the "too fast"
message flips to "you are mostly adding fat".

---

## How talkative it is

```ts
coach: {
  enabled: true,
  weeklyReportWeekday: 0,        // 0 = Sunday, null = no weekly report
  minWeighInsPerWeek: 3,
  minLoggedDaysPerWeek: 4,
}
```

`enabled: false` leaves you with receipts only - still the full energy balance
and trend, just no opinions.

The two minimums gate advice. Below them Arnold says the data is too thin and
stops there. Raising them makes it more conservative; lowering them makes it
advise on noise.

Comments fire at most once per trigger per day. The triggers are in
[`lib/coach.ts`](../lib/coach.ts) (`commentTrigger`) and are deliberately few:
a new tape measurement, a weigh-in showing too fast a loss, falling strength, a
habit over its limit, a day well over target.

---

## Which models

```ts
models: {
  classify: 'claude-sonnet-5',
  coach: 'claude-opus-5',
}
```

Or per environment, without touching the file: `ARNOLD_MODEL` and
`ARNOLD_COACH_MODEL`.

The classifier needs tool use and vision. The coach only writes text, so a
cheaper model works there if you want - the decision it phrases has already been
made in code.

Using the same fast model for both is a reasonable way to cut costs. The receipts
do not change at all, since they never involve a model.

---

## Voice messages

```
STT_PROVIDER=openai      # or groq
OPENAI_API_KEY=sk-...    # or GROQ_API_KEY
```

Groq is cheaper and faster; OpenAI is more accurate on food names in noisy
audio. Both use the same request shape ([`lib/stt.ts`](../lib/stt.ts)).

Without a provider, a voice note gets a polite explanation rather than silence.

Voice transcripts are unreliable in a specific way that matters here: food names
get mangled. The prompt tells the model to pick the plausible reading and store
the corrected one, never the garbled version.

---

## Adding a whole new kind of entry

Habits cover anything countable. If you need something structurally different -
say, blood pressure with two numbers - it takes four edits:

1. `supabase/schema.sql` - add the table, add it to the RLS loop, run the file
   again (it is idempotent)
2. `lib/db.ts` - a row type, a read, an insert; add it to `CORRECTABLE` if
   corrections should work on it
3. `lib/schema.ts` - the field in `buildTool`, guarded by a config flag, plus
   the input type
4. `lib/record.ts` - a block that writes it

`lib/reply.ts` only needs a change if it should appear on every receipt.

Keep the pattern the rest of the code follows: no invented values, `null` when
something is unknown, and a comment saying why a rule exists rather than what
the line does.

---

## Changing things from the chat

Some values do not need a redeploy. Just tell Arnold:

- "I'm 183 tall"
- "my target is 78 kg by Christmas"
- "call it 2,100 calories a day"

These are stored in the `settings` table and override the file
([`lib/config.ts`](../lib/config.ts), `withSettings`). The full list of keys that
can be set this way is `STORED_SETTING_KEYS` in
[`lib/config-types.ts`](../lib/config-types.ts).

Deliberately not changeable from the chat: which trackers exist, the rate band,
the models. A bot that can rewrite its own tracker list from a message is a bot
whose behaviour you cannot reason about afterwards.
