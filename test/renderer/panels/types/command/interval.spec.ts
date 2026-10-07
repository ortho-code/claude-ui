import type { Locator, Page } from '@playwright/test';
import type { PanelRunEvent } from '../../../../../src/shared/panels';
import { type App, expect, test } from '../../../support/harness';
import { railItem, runs, withLayout } from '../../layout/layout';

// A command panel with an interval runs on it as well as on show (docs/architecture.md § The `command` type): from when the window goes live, shown or not, and a tick after each run ends, out of sight too.
// A run on the interval holds what is on show until it ends, then swaps in what it printed, failed or not; a press still starts the body afresh.
const MINUTE = 60_000;
const LINES = Array.from({ length: 200 }, (_, at) => `line ${at}`);

/** Two commands in one group, so a rail carries their dots: `first` on show and `second` behind it, either with the interval given. */
function group(interval: { first?: string; second?: string }): ReturnType<typeof withLayout> {
  const options = (command: string, every?: string): Record<string, string> => ({ command, ...(every ? { interval: every } : {}) });
  return withLayout({
    version: 2,
    root: {
      id: 'window',
      columns: [
        { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
        { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
        {
          id: 'right',
          size: '360px',
          panels: [
            { id: 'first', type: 'command', title: 'First', icon: 'git', options: options('git status --short', interval.first) },
            { id: 'second', type: 'command', title: 'Second', icon: 'check', options: options('make check', interval.second) },
          ],
        },
      ],
    },
  });
}

/** Send the latest run of `entry` what a command would print, then how it ended. */
async function finish(app: App, entry: string, text: string, end: PanelRunEvent = { kind: 'exit', code: 0, signal: null }): Promise<void> {
  const { token } = (await runs(app, entry)).at(-1)!;
  if (text) await app.emit('onPanelRun', entry, token, { kind: 'output', text });
  await app.emit('onPanelRun', entry, token, end);
}

const output = (page: Page): Locator => page.locator('.panel-output:visible');
const end = (page: Page): Locator => page.locator('.panel-end');
const dot = (page: Page, panel: RegExp): Locator => railItem(page, panel).locator('.nudge');

test('a command panel with an interval runs when the window goes live though out of sight, and a tick after each run ends', async ({ app, page }) => {
  await page.clock.install();
  await app.boot(group({ second: '1m' }));
  await expect.poll(() => runs(app, 'second')).toHaveLength(1);
  await expect(railItem(page, /^Second/)).not.toHaveClass(/\bshown\b/);

  // Counted from a run's end: none while the run goes.
  await page.clock.fastForward(2 * MINUTE);
  expect(await runs(app, 'second')).toHaveLength(1);
  await finish(app, 'second', 'ok\n', { kind: 'exit', code: 1, signal: null });
  // A failed run out of sight says so on the rail.
  await expect(dot(page, /^Second/)).toHaveClass(/\bfailed\b/);
  await page.clock.fastForward(MINUTE);
  await expect.poll(() => runs(app, 'second')).toHaveLength(2);

  // The panel on show, without an interval, ran once on show and not since.
  expect(await runs(app, 'first')).toHaveLength(1);
});

test("a tick keeps the output, the header's word and the dot until its run ends, then swaps in what it printed, keeping the scroll", async ({ app, page }) => {
  await page.clock.install();
  await app.boot(group({ first: '1m' }));
  await expect.poll(() => runs(app, 'first')).toHaveLength(1);
  await finish(app, 'first', LINES.map((line) => `${line}\n`).join(''), { kind: 'exit', code: 1, signal: null });
  await expect(output(page)).toContainText('line 199');
  await expect(end(page)).toHaveText('exit 1');
  await expect(dot(page, /^First/)).toHaveClass(/\bfailed\b/);
  await output(page).evaluate((pre) => (pre.scrollTop = 600));

  await page.clock.fastForward(MINUTE);
  await expect.poll(() => runs(app, 'first')).toHaveLength(2);
  const { token } = (await runs(app, 'first')).at(-1)!;
  await app.emit('onPanelRun', 'first', token, { kind: 'output', text: 'new 0\n' });
  // Mid-run: the last run's output, word and dot, and nothing of the new one yet.
  await expect(output(page)).toContainText('line 199');
  await expect(output(page)).not.toContainText('new 0');
  await expect(end(page)).toHaveText('exit 1');
  await expect(dot(page, /^First/)).toHaveClass(/\bfailed\b/);
  expect(await output(page).evaluate((pre) => pre.scrollTop)).toBe(600);

  await finish(app, 'first', LINES.map((line) => `new ${line.slice(5)}\n`).slice(1).join(''));
  await expect(output(page)).toContainText('new 199');
  await expect(output(page)).not.toContainText('line 199');
  await expect(output(page)).toContainText('new 0');
  await expect(end(page)).toHaveText('');
  await expect(dot(page, /^First/)).toBeHidden();
  expect(await output(page).evaluate((pre) => pre.scrollTop)).toBe(600);

  // Shorter output keeps the scroll as far as it reaches: from the long output's end to the short one's, not back at the top.
  const before = await output(page).evaluate((pre) => (pre.scrollTop = pre.scrollHeight));
  await page.clock.fastForward(MINUTE);
  await expect.poll(() => runs(app, 'first')).toHaveLength(3);
  await finish(app, 'first', LINES.slice(0, 100).map((line) => `short ${line}\n`).join(''));
  await expect(output(page)).toContainText('short line 99');
  const { scrollTop, bottom } = await output(page).evaluate((pre) => ({ scrollTop: pre.scrollTop, bottom: pre.scrollHeight - pre.clientHeight }));
  expect(bottom).toBeGreaterThan(0);
  expect(bottom).toBeLessThan(before);
  expect(scrollTop).toBe(bottom);
});

test('a tick that fails shows what it printed and why, as a press would', async ({ app, page }) => {
  await page.clock.install();
  await app.boot(group({ first: '1m' }));
  await expect.poll(() => runs(app, 'first')).toHaveLength(1);
  await finish(app, 'first', 'all good\n');
  await expect(output(page)).toHaveText('all good\n');

  await page.clock.fastForward(MINUTE);
  await expect.poll(() => runs(app, 'first')).toHaveLength(2);
  await finish(app, 'first', 'half of it\n', { kind: 'stopped', reason: 'timeout' });
  await expect(output(page)).toHaveText('half of it\n');
  await expect(end(page)).toHaveText('stopped after 30 s');
  await expect(dot(page, /^First/)).toHaveClass(/\bfailed\b/);
});

test('a press of Refresh on a panel with an interval still starts the body afresh, and shows the run as it prints', async ({ app, page }) => {
  await page.clock.install();
  await app.boot(group({ first: '1m' }));
  await expect.poll(() => runs(app, 'first')).toHaveLength(1);
  await finish(app, 'first', 'before\n', { kind: 'exit', code: 1, signal: null });
  await expect(end(page)).toHaveText('exit 1');

  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => runs(app, 'first')).toHaveLength(2);
  await expect(output(page)).toHaveText('');
  await expect(end(page)).toHaveText('');
  const { token } = (await runs(app, 'first')).at(-1)!;
  await app.emit('onPanelRun', 'first', token, { kind: 'output', text: 'after\n' });
  await expect(output(page)).toHaveText('after\n');
});
