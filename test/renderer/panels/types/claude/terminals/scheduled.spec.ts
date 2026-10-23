import type { Locator, Page } from '@playwright/test';
import type { TerminalLaunch } from '../../../../../../src/shared/types';
import { session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { row, stripRow, tab } from '../../../../support/window';

// A task claude has scheduled for a session, a `/loop` wakeup or a cron, as its last Stop listed it (docs/architecture.md § Status cues): a clock beside the session wherever it runs, its tab, its row and its strip row, naming each task, so a stop that ends the task is no surprise.
const one = session();
// A tab on show has its history read; what it holds is not what is checked here.
const fixture = { sessions: [one], history: { [one.id]: [] } };
// The stand-in numbers the ptys it starts from 1, and the default layout starts no shell, so the first claude is 1.
const FIRST = 1;

/** The session's clocks: its tab's, its row's and its strip row's. */
const clocks = (page: Page): Locator[] => [tab(page, one.title), row(page, one.title), stripRow(page, one.title)].map((at) => at.locator('.scheduled-mark'));

/** Start the session from its row and let its claude print, so it runs. */
async function start(page: Page, app: App): Promise<void> {
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalData', FIRST, 'claude is here')).toBe(1);
}

test('a session with a task scheduled shows a clock on its tab, its row and its strip row, naming each task', async ({ app, page }) => {
  await app.boot(fixture);
  await start(page, app);
  for (const clock of clocks(page)) await expect(clock).toBeHidden();

  expect(
    await app.emit('onSessionScheduled', one.id, [
      { prompt: '/loop check the deploy', recurring: false },
      { prompt: 'say the word tock', recurring: true },
    ]),
  ).toBe(1);
  for (const clock of clocks(page)) {
    await expect(clock).toBeVisible();
    await expect(clock).toHaveAttribute('data-tooltip', 'Scheduled:\n/loop check the deploy (once)\nsay the word tock (repeats)');
  }

  // A later turn that ends with nothing scheduled takes it off.
  await app.emit('onSessionScheduled', one.id, []);
  for (const clock of clocks(page)) await expect(clock).toBeHidden();
});

// `/clear` or claude's own `/resume` take the tab's claude on to another session: the one it left has no claude of the app's any more, so its row keeps no clock, though main never says its list emptied.
for (const source of ['clear', 'resume']) {
  test(`the session a tab's claude left by ${source === 'clear' ? '/clear' : '/resume'} keeps no clock`, async ({ app, page }) => {
    const other = session({ id: '00000000-0000-4000-8000-0000000000cc', title: 'Another session' });
    await app.boot({ sessions: [one, other], history: { [one.id]: [], [other.id]: [] } });
    await start(page, app);
    const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
    await app.emit('onSessionScheduled', one.id, [{ prompt: 'say the word tock', recurring: true }]);
    await expect(row(page, one.title).locator('.scheduled-mark')).toBeVisible();

    expect(await app.emit('onSessionStart', other.id, launch.tabToken ?? '', source)).toBe(1);
    await expect(row(page, one.title).locator('.scheduled-mark')).toBeHidden();
  });
}

// A task scheduled in a claude that has gone is gone with it, as far as anything here can tell, whatever main last said.
test('the clock goes when the session stops', async ({ app, page }) => {
  await app.boot(fixture);
  await start(page, app);
  await app.emit('onSessionScheduled', one.id, [{ prompt: 'say the word tock', recurring: true }]);
  await expect(tab(page, one.title).locator('.scheduled-mark')).toBeVisible();

  await tab(page, one.title).locator('.tab-close').click();
  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  await expect(tab(page, one.title).locator('.scheduled-mark')).toBeHidden();
  await expect(row(page, one.title).locator('.scheduled-mark')).toBeHidden();
});
