import { defineConfig } from 'vitest/config';

/**
 * Config for `npm run live` only. Separate from vitest.config.ts because that
 * one deliberately excludes the live test, and the CLI adds to the exclude list
 * rather than replacing it.
 */
export default defineConfig({
  test: {
    include: ['test/live.test.ts'],
    exclude: ['node_modules/**'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
