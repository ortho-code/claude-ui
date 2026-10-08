import type { Page } from '@playwright/test';
import { type App, expect, test } from '../../../support/harness';
import { chooseProject } from '../../../support/window';
import { runs, withLayout } from '../../layout/layout';

// A run may say in its control file when it runs next (docs/architecture.md § The `command` type): that delay, for that one run, in place of the interval or without one, or `off` for none; what it gets wrong is a note under the group.
const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** One command on show, with the interval given. */
function status(interval?: string): ReturnType<typeof withLayout> {
  return withLayout({
    version: 2,
    root: {
      id: 'window',
      columns: [
        { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
        { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
        { id: 'right', size: '360px', panels: [{ id: 'status', type: 'command', title: 'Status', icon: 'git', options: { command: 'git status --short', ...(interval ? { interval } : {}) } }] },
      ],
    },
  });
}

/** End the latest run, with what it wrote to its control file, or nothing. */
async function finish(app: App, control?: string): Promise<void> {
  const { token } = (await runs(app, 'status')).at(-1)!;
  await app.emit('onPanelRun', 'status', token, { kind: 'exit', code: 0, signal: null, ...(control === undefined ? {} : { control }) });
}

const note = (page: Page, text: string): ReturnType<Page['getByText']> => page.locator('.panel-note').getByText(text);

test('a run that says when it runs next is run again then, for that one run, in place of the interval', async ({ app, page }) => {
  await page.clock.install();
  await app.boot(status('1h'));
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  await finish(app, 'next=1m\n');
  await page.clock.fastForward(MINUTE);
  await expect.poll(() => runs(app, 'status')).toHaveLength(2);

  // That run said nothing: the interval again.
  await finish(app);
  await page.clock.fastForward(5 * MINUTE);
  expect(await runs(app, 'status')).toHaveLength(2);
  await page.clock.fastForward(55 * MINUTE);
  await expect.poll(() => runs(app, 'status')).toHaveLength(3);
});

test('a run that says when it runs next is run again then on a panel without an interval', async ({ app, page }) => {
  await page.clock.install();
  await app.boot(status());
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  await finish(app, 'next=2m\n');
  await page.clock.fastForward(2 * MINUTE);
  await expect.poll(() => runs(app, 'status')).toHaveLength(2);
});

test('a run that says off is not run again on its own, though the panel has an interval', async ({ app, page }) => {
  await page.clock.install();
  await app.boot(status('1m'));
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  await finish(app, 'next=off\n');
  await page.clock.fastForward(10 * MINUTE);
  expect(await runs(app, 'status')).toHaveLength(1);
});

test('what a control file gets wrong is a note under the group until a run writes none, and a next too short is run at the floor', async ({ app, page }) => {
  await page.clock.install();
  await app.boot(status());
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  await finish(app, 'next=3s\nwhen=later\n');
  await expect(note(page, 'status: CLAUDE_UI_CONTROL: next 3s is shorter than the 10s it can be at the least, so the next run is in 10s.')).toBeVisible();
  await expect(note(page, 'status: CLAUDE_UI_CONTROL: when is not a name this build reads; it is ignored.')).toBeVisible();

  await page.clock.fastForward(9 * SECOND);
  expect(await runs(app, 'status')).toHaveLength(1);
  await page.clock.fastForward(SECOND);
  await expect.poll(() => runs(app, 'status')).toHaveLength(2);
  await finish(app);
  await expect(page.locator('.panel-note')).toHaveCount(0);
});

test("a run that finds nowhere to run takes away what the last run's control file got wrong", async ({ app, page }) => {
  await app.boot(status());
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  await finish(app, 'when=later\n');
  const wrong = note(page, 'status: CLAUDE_UI_CONTROL: when is not a name this build reads; it is ignored.');
  await expect(wrong).toBeVisible();

  await chooseProject(page, 'All');
  await expect(page.getByText('Pick a project to run this in.')).toBeVisible();
  await expect(wrong).toBeHidden();
});

test('a run the app stopped as it quits is not read for when it runs next', async ({ app, page }) => {
  await page.clock.install();
  await app.boot(status());
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  const { token } = (await runs(app, 'status')).at(-1)!;
  await app.emit('onPanelRun', 'status', token, { kind: 'stopped', reason: 'quit', control: 'next=1m\nwhen=later\n' });
  await page.clock.fastForward(5 * MINUTE);
  expect(await runs(app, 'status')).toHaveLength(1);
  await expect(page.locator('.panel-note')).toHaveCount(0);
});
