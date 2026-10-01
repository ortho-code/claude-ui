import { stat } from 'node:fs/promises';
import path from 'node:path';
import { test as base, expect, type Route } from '@playwright/test';
import { build } from 'esbuild';
import type { ClaudeUiApi, UiState } from '../../../src/shared/types';
import { defaultFixture, type BridgeEvent, type BridgeEventArgs, type BridgeFixture } from './fixture';

/** The window as it ships: `npm run build`'s output, which `npm run test:renderer` builds first. */
const DIST = path.resolve(__dirname, '../../../dist/renderer');
/**
 * A made-up origin the page is served on, every request answered from DIST: no server and no port. Module scripts do not load from file://.
 * HTTPS so the page is a secure context, as the app's own file:// page is: over plain http Chromium withholds `crypto.randomUUID`, and the window mints every new session's id with it.
 */
const ORIGIN = 'https://claude-ui.test';

export interface App {
  /** Load the window, as a first run with one session and no layout file, with whatever the check needs different. */
  boot(overrides?: Partial<BridgeFixture>): Promise<void>;
  /** The arguments of every call to `name` so far, in order. */
  calls(name: keyof ClaudeUiApi): Promise<unknown[][]>;
  /** The view the window last asked main to keep (`setUiState`), or nothing before it first has: saved on a debounce, so read with a poll. */
  saved(): Promise<UiState | undefined>;
  /** Fire what the window subscribed to as `name`, as main would; answers how many callbacks there were. */
  emit<K extends BridgeEvent>(name: K, ...args: BridgeEventArgs<K>): Promise<number>;
  /** Hold every answer to `name` until `release(name)`, as main still working on it would (`BridgeControl.hold`). */
  hold(name: keyof ClaudeUiApi): Promise<void>;
  release(name: keyof ClaudeUiApi): Promise<void>;
}

async function serve(route: Route): Promise<void> {
  const file = path.join(DIST, decodeURIComponent(new URL(route.request().url()).pathname));
  const found = file.startsWith(DIST + path.sep) && (await stat(file).catch(() => null))?.isFile() === true;
  await (found ? route.fulfill({ path: file }) : route.fulfill({ status: 404 }));
}

export const test = base.extend<{ app: App }, { installScript: string }>({
  // Bundled once per worker, straight from the source: no file on disk to go stale.
  installScript: [
    // eslint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from this pattern, and this one has none
    async ({}, use) => {
      const bundle = await build({ entryPoints: [path.join(__dirname, 'install.ts')], bundle: true, write: false, format: 'iife', platform: 'browser', logLevel: 'silent' });
      await use(bundle.outputFiles[0].text);
    },
    { scope: 'worker' },
  ],

  app: async ({ page, installScript }, use) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    page.on('pageerror', (error) => errors.push(`uncaught: ${error.message}`));
    await page.route(`${ORIGIN}/**`, serve);

    const app: App = {
      boot: async (overrides = {}) => {
        await page.addInitScript((fixture) => (window.__claudeUiFixture = fixture), { ...defaultFixture(), ...overrides });
        await page.addInitScript({ content: installScript });
        await page.goto(`${ORIGIN}/index.html`);
      },
      calls: async (name) => (await page.evaluate(() => window.__claudeUiTest.calls)).filter((call) => call.name === name).map((call) => call.args),
      saved: async () => (await app.calls('setUiState')).at(-1)?.[0] as UiState | undefined,
      // Typed on `App`; untyped across into the page, where Playwright's own typing of an argument loses the pairing of an event with its arguments.
      emit: (name, ...args) =>
        page.evaluate(({ event, values }) => (window.__claudeUiTest.emit as (event: string, ...values: unknown[]) => number)(event, ...values), { event: name, values: args }),
      hold: (name) => page.evaluate((call) => window.__claudeUiTest.hold(call), name),
      release: (name) => page.evaluate((call) => window.__claudeUiTest.release(call), name),
    };
    await use(app);

    // Every check also says nothing went wrong on the way: nothing thrown or logged as an error in the page, and nothing the window wrote to the app's own log as one.
    // The log is only there to read once the window was loaded: a check can fail before it boots.
    if (page.url().startsWith(ORIGIN)) {
      for (const [level, area, message] of (await app.calls('log')) as [string, string, string][]) {
        if (level === 'error') errors.push(`log (${area}): ${message}`);
      }
    }
    expect(errors, 'what went wrong in the window').toEqual([]);
  },
});

export { expect };
