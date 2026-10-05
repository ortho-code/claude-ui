import { defineConfig } from 'vitest/config';

// The unit tests, in test/unit mirroring src.
// The window's checks under test/renderer are Playwright's, and vitest must not pick up their `*.spec.ts`.
export default defineConfig({
  test: { include: ['test/unit/**/*.test.ts'] },
});
