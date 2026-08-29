-- ---------------------------------------------------------------------------
-- Arnold - database schema
--
-- Paste this whole file into the Supabase SQL editor and press Run. It is
-- idempotent: running it twice changes nothing, so it is also the upgrade path.
--
-- Access model: Arnold talks to Postgres with the service_role key from the
-- server only. Row Level Security is therefore enabled on every table WITHOUT
-- policies - service_role bypasses RLS, and anon/authenticated get nothing.
-- If you ever build a UI with user logins, add policies then; leaving RLS off
-- would mean anyone with your public anon key could read your health data.
-- ---------------------------------------------------------------------------

-- Settings you change from the chat ("I'm 183 tall"). Overrides arnold.config.ts.
create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Food. items holds the itemised breakdown the model produced, so a wrong total
-- can be recomputed later without asking you again what you ate.
create table if not exists meals (
  id          bigint generated always as identity primary key,
  ts          timestamptz not null default now(),
  day         date not null,
  slot        text,                       -- breakfast | lunch | dinner | snack
  description text not null,
  items       jsonb,                      -- [{name, grams, kcal, protein_g, carbs_g, fat_g}]
  kcal        real,
  protein_g   real,
  carbs_g     real,
  fat_g       real,
  confidence  text,                       -- high | medium | low
  status      text not null default 'ok', -- ok | unclear (a question is open)
  source      text not null,              -- telegram-text | telegram-photo | telegram-voice
  photo_path  text,
  raw         text                        -- what you actually said, for later recalculation
);
create index if not exists meals_day_idx on meals (day);

-- Weight. impedance_ohm is stored raw on purpose: body fat percent is not a
-- measurement, it is a formula over impedance, weight, height, age and sex.
-- Keep the raw value and a better formula can be applied to your history later.
create table if not exists weights (
  id            bigint generated always as identity primary key,
  ts            timestamptz not null default now(),
  day           date not null,
  weight_kg     real not null,
  body_fat_pct  real,
  muscle_kg     real,
  water_pct     real,
  impedance_ohm real,
  fasted        boolean,                  -- null = unknown, and then it does NOT feed the trend
  source        text not null,            -- telegram | scale | manual
  raw           text
);
create index if not exists weights_day_idx on weights (day);

-- Tape measure. The second, independent signal: bio-impedance scales
-- systematically underestimate belly fat because the current runs through your
-- legs, so waist circumference covers exactly their blind spot.
create table if not exists measurements (
  id     bigint generated always as identity primary key,
  ts     timestamptz not null default now(),
  day    date not null,
  kind   text not null,                   -- waist | chest | hip | arm | thigh | ...
  value  real not null,
  unit   text not null default 'cm',
  source text not null
);
create index if not exists measurements_day_idx on measurements (day);
-- Daily totals imported from a trusted external health dashboard.
create table if not exists daily_metrics (
  id                    bigint generated always as identity primary key,
  ts                    timestamptz not null default now(),
  day                   date not null,
  calories_burned       real,
  steps                 integer,
  resting_heart_rate    real,
  sleep_score           real,
  source                text not null default 'google_health',
  raw                   text,
  unique (day, source)
);
create index if not exists daily_metrics_day_idx on daily_metrics (day);

create table if not exists workouts (
  id           bigint generated always as identity primary key,
  ts           timestamptz not null default now(),
  day          date not null,
  description  text not null,
  kind         text,                      -- strength | cardio | daily | other
  duration_min real,
  kcal         real,
  distance_km  real,
  pace         text,                      -- "6:00" per km
  effort       text,                      -- easy | medium | hard
  template     text,
  source       text not null
);
create index if not exists workouts_day_idx on workouts (day);

-- Individual sets. Without them there is no progression, and progression is the
-- earliest warning that a deficit is eating muscle - earlier than the scale.
create table if not exists workout_sets (
  id         bigint generated always as identity primary key,
  workout_id bigint references workouts (id) on delete cascade,
  day        date not null,
  exercise   text not null,               -- lowercase, e.g. "pull ups"
  set_no     integer not null,
  reps       integer,
  weight_kg  real,                        -- null = bodyweight
  note       text
);
create index if not exists workout_sets_exercise_idx on workout_sets (exercise, day);

create table if not exists sleep (
  id       bigint generated always as identity primary key,
  ts       timestamptz not null default now(),
  day      date not null,
  bedtime  text,                          -- HH:MM
  wake_at  text,                          -- HH:MM
  hours    real,
  quality  text,                          -- good | ok | bad
  note     text,
  source   text not null
);
create index if not exists sleep_day_idx on sleep (day);

-- Everything defined under trackers.habits in arnold.config.ts: drinks,
-- cigarettes, glasses of water, cups of coffee, steps, minutes of meditation.
-- One generic table, so adding a tracker never needs a migration.
create table if not exists habit_entries (
  id       bigint generated always as identity primary key,
  ts       timestamptz not null default now(),
  day      date not null,
  habit_id text not null,
  amount   real not null,
  unit     text,
  kcal     real,                          -- only when the habit has kcalPerUnit
  note     text,
  source   text not null
);
create index if not exists habit_entries_day_idx on habit_entries (day, habit_id);

-- Standing rules you stated once: "my mayo is always the light one".
create table if not exists assumptions (
  id         bigint generated always as identity primary key,
  keyword    text not null unique,
  meaning    text not null,
  created_at timestamptz not null default now()
);

-- Named building blocks: "my usual breakfast", "route 1", "workout A".
-- You name it once, then say the name and the numbers come from here instead of
-- being re-estimated differently every single time.
create table if not exists templates (
  id           bigint generated always as identity primary key,
  name         text not null unique,      -- lowercase
  kind         text not null,             -- meal | cardio | strength | daily | other
  description  text not null,
  duration_min real,
  kcal         real,
  protein_g    real,
  carbs_g      real,
  fat_g        real,
  data         jsonb,
  created_at   timestamptz not null default now()
);

create table if not exists photos (
  id       bigint generated always as identity primary key,
  ts       timestamptz not null default now(),
  day      date not null,
  path     text not null,                 -- object path inside the storage bucket
  category text,                          -- meal | body | screenshot | other
  note     text,
  meal_id  bigint references meals (id) on delete set null
);

-- Short conversation memory, so "and two more eggs with that" still lands on
-- the right meal twenty minutes later.
create table if not exists messages (
  id      bigint generated always as identity primary key,
  ts      timestamptz not null default now(),
  chat_id bigint not null,
  role    text not null,                  -- user | arnold
  text    text not null
);
create index if not exists messages_chat_idx on messages (chat_id, ts desc);

-- One open follow-up question per chat. The entry is already saved when the
-- question goes out; the answer corrects it instead of creating a second one.
create table if not exists pending (
  chat_id    bigint primary key,
  question   text not null,
  subject    text,
  ref_table  text,
  ref_id     bigint,
  expires_at timestamptz not null
);

-- Telegram retries a webhook it considers failed. Without this table a slow
-- reply books your dinner twice.
--
-- `done` is what makes it a claim rather than a tombstone: a row is written
-- before the work starts and flipped afterwards. If the function is killed
-- mid-way (a model call that outlives the platform's time limit), the claim
-- stays open, and Telegram's retry is allowed through instead of being
-- discarded as a duplicate. Losing an entry silently is the worse failure.
create table if not exists processed_updates (
  update_id bigint primary key,
  ts        timestamptz not null default now(),
  done      boolean not null default false
);
alter table processed_updates add column if not exists done boolean not null default false;

-- Each coaching trigger fires at most once per day, otherwise Arnold repeats
-- "you are over your target" after every further meal.
create table if not exists coach_events (
  code text not null,
  day  date not null,
  ts   timestamptz not null default now(),
  primary key (code, day)
);

-- Every correction keeps its previous state. A change you did not mean should
-- be visible afterwards, not gone.
create table if not exists corrections_log (
  id         bigint generated always as identity primary key,
  ts         timestamptz not null default now(),
  table_name text not null,
  row_id     bigint not null,
  action     text not null,             -- update | delete
  before     jsonb,
  changes    jsonb,
  reason     text
);

-- Nothing is allowed to disappear silently: if the model call or a write fails,
-- the raw input lands here and you get an honest error message.
create table if not exists errors (
  id      bigint generated always as identity primary key,
  ts      timestamptz not null default now(),
  chat_id bigint,
  input   text,
  error   text not null
);

-- --- Row Level Security -----------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'settings','meals','weights','measurements','daily_metrics','workouts','workout_sets','sleep',
    'habit_entries','assumptions','templates','photos','messages','pending',
    'processed_updates','coach_events','corrections_log','errors'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- --- Storage bucket for photos ----------------------------------------------
insert into storage.buckets (id, name, public)
values ('arnold-photos', 'arnold-photos', false)
on conflict (id) do nothing;
