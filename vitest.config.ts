import { defineConfig } from 'vitest/config';

// The unit tests, beside the code they test. The window's checks under test/renderer are Playwright's, and vitest must not pick up their `*.spec.ts`.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
