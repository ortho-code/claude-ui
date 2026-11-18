import { defineConfig } from '@playwright/test';
import type { PerfOptions } from './support/fixture';

// The window's performance budgets, held at 1,000 sessions on this machine and at Chromium's 4× CPU throttle (the design's decisions 197 and 198).
// Run by `npm run test:perf`, which builds first; never in CI, where a shared runner's timings would flake (decision 200).
const TIME_ZONE = 'Europe/Amsterdam';
process.env.TZ = TIME_ZONE;

export default defineConfig<PerfOptions>({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  outputDir: '../../test-results/perf',
  // One check at a time on the whole machine: two side by side would each slow the other's timings.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 10 * 60_000,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    timezoneId: TIME_ZONE,
    locale: 'nl-NL',
  },
  projects: [
    { name: 'normal', use: { throttle: 1 } },
    { name: 'throttled 4×', use: { throttle: 4 } },
  ],
});
