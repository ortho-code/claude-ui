import { defineConfig } from '@playwright/test';

// The window's own checks: the built renderer in a headless Chromium, with a typed stand-in for the main process (harness.ts). Run by `npm run test:renderer`, which builds first.
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  // At the repo root and gitignored, not under dist/, which electron-builder packs.
  outputDir: '../../test-results',
  forbidOnly: process.env.CI !== undefined,
  // None: a check that passes on a second try is a flake, and a gate that retries it away teaches everybody to ignore it.
  retries: 0,
  reporter: process.env.CI !== undefined ? [['list'], ['github']] : 'list',
  use: {
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
  },
});
