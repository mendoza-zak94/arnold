/**
 * The one test that costs money. Skipped unless ARNOLD_LIVE=1.
 *
 * The other ~130 tests need no network, which is what makes them fast and honest
 * about the logic. What they cannot tell you is whether the model actually
 * understands the tool schema your config generated - and that is the one thing
 * worth checking with real money before trusting a setup.
 *
 * Run:  npm run live          (needs ANTHROPIC_API_KEY)
 *
 * Costs a fraction of a cent per case and writes to no database.
 */

import { describe, expect, it } from 'vitest';
import { buildTool, type ClassifyResult } from '../lib/schema';
import { systemPrompt, languageInstruction } from '../lib/prompt';
import { baseConfig } from '../lib/config';
import { extract } from '../lib/claude';

const live = process.env.ARNOLD_LIVE === '1' && Boolean(process.env.ANTHROPIC_API_KEY);

const config = baseConfig();
const tool = buildTool(config);
const system = `${systemPrompt(config)}\n${languageInstruction(config.language)}`;

const classify = (message: string) => extract<ClassifyResult>({
  model: config.models.classify,
  system,
  content: [{ type: 'text', text: `Message: ${message}` }],
  tool,
});

describe.skipIf(!live)('live model behaviour', () => {
  it('extracts a meal with a plausible total', { timeout: 60_000 }, async () => {
    const r = await classify('200 g grilled chicken breast with 150 g rice and a green salad');
    expect(r.is_entry).toBe(true);
    expect(r.meals?.length).toBeGreaterThan(0);
    const kcal = r.meals![0].items.reduce((a, i) => a + (i.kcal ?? 0), 0);
    expect(kcal).toBeGreaterThan(300);
    expect(kcal).toBeLessThan(1200);
  });

  it('never invents a distance or a calorie figure for a workout', { timeout: 60_000 }, async () => {
    // The rule that matters most. A guessed distance goes straight into the
    // energy balance and is invisible afterwards.
    const r = await classify('went for a run');
    const w = r.workouts?.[0];
    if (w) {
      expect(w.distance_km).toBeUndefined();
      expect(w.kcal).toBeUndefined();
    }
  });

  it('treats a question as a question, not an entry', { timeout: 60_000 }, async () => {
    const r = await classify('how much protein is in 200 g of skyr?');
    expect(r.is_entry).toBe(false);
  });

  it('reads a stated weight and an explicit fasted flag', { timeout: 60_000 }, async () => {
    const r = await classify('weighed 84.2 kg this morning, fasted');
    expect(r.weight?.weight_kg).toBeCloseTo(84.2, 1);
    expect(r.weight?.fasted).toBe(true);
  });

  it('books a configured habit by its id', { timeout: 60_000 }, async () => {
    const habit = config.trackers.habits[0];
    if (!habit) return;
    const r = await classify(`had 2 ${habit.unit} of ${habit.label.toLowerCase()}`);
    expect(r.habits?.some((h) => h.habit_id === habit.id)).toBe(true);
  });
});

describe.skipIf(live)('live model behaviour (skipped)', () => {
  it('is skipped without ARNOLD_LIVE=1 and an API key', () => {
    expect(live).toBe(false);
  });
});
