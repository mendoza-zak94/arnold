import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The live test costs money and needs a key. `npm run live` runs it
    // explicitly; `npm test` must stay offline and free.
    exclude: ['node_modules/**', 'test/live.test.ts'],
    environment: 'node',
  },
});
