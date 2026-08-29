/**
 * arnold.config.ts - the one file you are meant to edit.
 *
 * Everything Arnold does is driven from here: which language it speaks, what
 * your body looks like, what you want to reach, and what it should track. The
 * tool schema that Claude fills in is GENERATED from this object (lib/schema.ts),
 * so adding a tracker below is enough - no prompt engineering, no code changes.
 *
 * Values you can also change later from the chat ("I'm 183 tall", "target 80 kg")
 * are stored in the database and win over the defaults here. This file is the
 * starting point, not a lock.
 */

import type { ArnoldConfig } from './lib/config-types';

const config: ArnoldConfig = {
  /**
   * Language Arnold replies in. Any language Claude speaks works here - write
   * it the way you would say it ("english", "deutsch", "francais", "portugues").
   * Fixed UI strings ship for "en" and "de"; anything else falls back to
   * English labels while the model still writes its own sentences in your
   * language. See docs/CUSTOMIZE.md if you want to add a full translation.
   */
  language: 'en',

  /** metric = kg/cm/km. imperial = lb/in/mi, converted on the way in and out. */
  units: 'metric',

  /**
   * Your timezone as an IANA name, e.g. "Europe/Berlin", "America/New_York".
   * This decides which calendar day an entry belongs to. Get it wrong and your
   * late dinners land on tomorrow.
   */
  timezone: 'Europe/Lisbon',

  profile: {
    /** Height in cm - or in inches when units is "imperial". Feeds the BMR formula. */
    height: 175,
    /** Birth year is enough - Arnold derives the age itself and it stays right. */
    birthYear: 1994,
    /**
     * 'male' | 'female'. This only feeds the Mifflin-St Jeor formula, which has
     * exactly these two constants. If neither fits, pick the one closer to your
     * lean mass and correct the result with activityFactor.
     */
    sex: 'male',
    /**
     * Everything except logged workouts: desk work, commute, housework.
     * 1.2 = mostly sitting, 1.3 = sitting plus normal errands, 1.5 = on your
     * feet all day. Do NOT put your training in here - workouts are added
     * separately from what you log, otherwise every session counts twice.
     */
    activityFactor: 1.3,
  },

  goal: {
    /** 'lose' | 'maintain' | 'gain' */
    direction: 'lose',
    /**
     * Target weight and the date you want to be there. Both optional: without
     * them Arnold still tracks and comments, it just cannot tell you whether
     * you are on schedule.
     */
    targetWeight: null,
    targetDate: null, // e.g. '2026-12-24'
    /**
     * Safe rate band as percent of body weight per week. Above 1 %/week lean
     * mass goes with it (Garthe 2011), below 0.5 %/week you cannot tell the
     * change from noise. Arnold nags when you leave this band, in either
     * direction. For 'gain', the same numbers apply upwards.
     */
    weeklyRatePct: { min: 0.5, max: 1.0 },
    /**
     * Daily calorie target. 'auto' derives it from your energy expenditure and
     * the rate band above, and moves with your weight. A fixed number here
     * overrides that ("dailyCalories: 2200").
     */
    dailyCalories: 'auto',
    /**
     * Protein target in grams per kg of body weight. 1.6 is the evidence-backed
     * floor for keeping muscle in a deficit; 2.0-2.2 is the usual upper end.
     * Set to null to switch protein tracking off.
     */
    proteinPerKg: 1.8,
  },

  /**
   * What Arnold tracks. Switch anything off and it disappears from the tool
   * schema, from the prompt and from the daily summary - the model then cannot
   * even book it by accident.
   */
  trackers: {
    meals: true,
    weight: true,
    workouts: true,
    /** Tape measure: waist, chest, arms. */
    measurements: true,
    /** "in bed at 23, up at 6" */
    sleep: true,

    /**
     * Anything you want to count per day. This is the extensible part: add an
     * entry, redeploy, and you can log it by talking about it. Nothing else to
     * change.
     *
     *   id         stable key, lowercase, used in the database
     *   label      what Arnold calls it in replies
     *   unit       what one entry counts ("drinks", "cigarettes", "glasses")
     *   kcalPerUnit  optional - if set, it counts into your daily calories.
     *                A 0.5 l beer is roughly 200 kcal, a glass of wine 125.
     *                Alcohol that does not count into the balance is the most
     *                common reason a deficit exists on paper only.
     *   dailyLimit optional - Arnold mentions it when you go over
     *   goal       'less' | 'more' | 'track' - direction for the weekly report
     */
    habits: [
      {
        id: 'alcohol',
        label: 'Alcohol',
        unit: 'drinks',
        kcalPerUnit: 150,
        dailyLimit: 2,
        goal: 'less',
      },
      {
        id: 'cigarettes',
        label: 'Cigarettes',
        unit: 'cigarettes',
        goal: 'less',
      },
      {
        id: 'water',
        label: 'Water',
        unit: 'ml',
        dailyLimit: null,
        goal: 'more',
      },

      {
        id: 'coffee',
        label: 'Coffee',
        unit: 'cups',
        dailyLimit: 4,
        goal: 'less',
      },
      {
        id: 'steps',
        label: 'Steps',
        unit: 'steps',
        dailyLimit: null,
        goal: 'more',
      },
      // Add your own. Examples that need no code:
      // { id: 'caffeine', label: 'Coffee', unit: 'cups', dailyLimit: 4, goal: 'less' },
      // { id: 'steps',    label: 'Steps',  unit: 'steps', goal: 'more' },
      // { id: 'meditation', label: 'Meditation', unit: 'minutes', goal: 'more' },
    ],
  },

  coach: {
    /**
     * Whether Arnold comments beyond the plain receipt. Comments are rare on
     * purpose: one per trigger per day, and only when something actually
     * changed. A coach that talks after every meal gets muted (Hurley 2024:
     * each missed daily goal cuts the odds of the next message being opened by
     * about a third).
     */
    enabled: true,
    /**
     * Weekly report. The cron runs daily on Vercel's free plan, and the handler
     * checks whether today is this weekday - 0 = Sunday.
     * Set to null to switch the report off.
     */
    weeklyReportWeekday: 0,
    /**
     * Below this many weigh-ins or logged days out of 7, Arnold gives no advice
     * at all and says so. Advice on top of missing data is guesswork with a
     * confident voice.
     */
    minWeighInsPerWeek: 3,
    minLoggedDaysPerWeek: 4,
  },

  models: {
    /** Fast, cheap, does the logging. Must support tool use and vision. */
    classify: 'gpt-5.6-luna',
    /** Slower, smarter, writes the coaching. Only called when there is a reason. */
    coach: 'gpt-5.6-terra',
  },
};

export default config;
