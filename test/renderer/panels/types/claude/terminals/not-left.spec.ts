import type { Locator, Page } from '@playwright/test';
import type { TerminalLaunch } from '../../../../../../src/shared/types';
import { session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { row, stripRow, tab } from '../../../../support/window';

// A stop claude has not answered by leaving 3 s after the ask says so where it shows without a hover: beside the name on the tab, the list row and the strip row, and in an attention toast that stays until claude leaves, the stop is called off, or it is dismissed (docs/architecture.md § Stopping a session).
const stuck = session({ id: '00000000-0000-4000-8000-000000000001', title: 'Fix the login bug' });
const other = session({ id: '00000000-0000-4000-8000-000000000002', title: 'Write the release notes' });
const fixture = { sessions: [stuck, other], history: { [stuck.id]: [], [other.id]: [] } };
// The stand-in numbers the ptys it starts from 1, and the default layout starts no shell.
const STUCK = 1;
const OTHER = 2;

/** The words beside the session's name on its tab, its list row and its strip row. */
const words = (page: Page): Locator[] => [tab(page, stuck.title), row(page, stuck.title), stripRow(page, stuck.title)].map((at) => at.locator('.not-left'));
const toasts = (page: Page): Locator => page.locator('#notifications .notif');

/** Start the stuck session with a cron scheduled, and the other on show, and answer the stuck one's tab token. */
async function startBoth(page: Page, app: App): Promise<string> {
  await page.clock.install();
  await app.boot(fixture);
  await row(page, stuck.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalData', STUCK, 'claude is here')).toBe(1);
  await app.emit('onSessionScheduled', stuck.id, [{ prompt: 'say hi', recurring: true, cron: 'Every 10 minutes' }]);
  await row(page, other.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  expect(await app.emit('onTerminalData', OTHER, 'claude is here too')).toBe(1);
  const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  return launch.tabToken!;
}

/** Ask the stuck session to stop from its row's menu, out of sight, as the strip and the menu let you, with the window's clock held from then on, so only the check moves it. */
async function askToStop(page: Page, app: App): Promise<void> {
  // A second on, so the time is still ahead when the call lands; nothing waits on the clock before the ask.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  await row(page, stuck.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button.menu-row', { hasText: /^Stop session$/ }).click();
  await expect.poll(() => app.calls('closeTerminal')).toHaveLength(1);
}

async function expectSaid(page: Page): Promise<void> {
  for (const said of words(page)) await expect(said).toHaveText("hasn't left");
  await expect(toasts(page)).toHaveCount(1);
  await expect(toasts(page)).toContainText(stuck.title);
  await expect(toasts(page)).toContainText("Claude hasn't left — it may be asking you something");
  await expect(toasts(page)).toContainText('say hi · Every 10 minutes');
}

async function expectUnsaid(page: Page): Promise<void> {
  for (const said of words(page)) await expect(said).toBeHidden();
  await expect(toasts(page)).toHaveCount(0);
}

test("a stop claude has not left 3 s after the ask says so beside the name and in a toast that stays, and not before", async ({ app, page }) => {
  await startBoth(page, app);
  await askToStop(page, app);
  await page.clock.runFor(2999);
  await expect(tab(page, stuck.title).locator('.tab-close')).toBeEnabled();
  await expectUnsaid(page);

  await page.clock.runFor(1);
  await expectSaid(page);
  // Past the 5 s an attention toast about a turn stays for.
  await page.clock.runFor(10_000);
  await expect(toasts(page)).toHaveCount(1);

  await app.emit('onTerminalExit', STUCK, 0);
  await expect(tab(page, stuck.title)).toHaveClass(/\bcold\b/);
  await expectUnsaid(page);
});

test('a click on the toast brings the tab that has not left on show', async ({ app, page }) => {
  await startBoth(page, app);
  await askToStop(page, app);
  await page.clock.runFor(3000);
  await toasts(page).click();
  await expect(tab(page, stuck.title)).toHaveClass(/\bactive\b/);
  await expect(toasts(page)).toHaveCount(0);
});

test('a prompt that calls the stop off takes the words and the toast away', async ({ app, page }) => {
  const token = await startBoth(page, app);
  await askToStop(page, app);
  await page.clock.runFor(3000);
  await expectSaid(page);
  await app.emit('onSessionStatus', stuck.id, 'busy', token, 'UserPromptSubmit');
  await expectUnsaid(page);
});

test('forcing the stop takes the words and the toast away', async ({ app, page }) => {
  await startBoth(page, app);
  await askToStop(page, app);
  await page.clock.runFor(3000);
  await expectSaid(page);
  await stripRow(page, stuck.title).locator('.strip-item-stop').click();
  expect(await app.calls('killTerminal')).toEqual([[STUCK]]);
  await expectUnsaid(page);
});

// The stack holds four, and newer ones push the oldest out, but not one that stays for a stop still under way.
test('newer toasts do not push the toast for a stop claude has not left out of the stack', async ({ app, page }) => {
  await startBoth(page, app);
  await askToStop(page, app);
  await page.clock.runFor(3000);
  await expectSaid(page);
  // The other session, not on show once the stuck one is, ends four turns.
  await tab(page, stuck.title).click();
  for (const status of ['waiting', 'idle', 'waiting', 'idle'] as const) await app.emit('onSessionStatus', other.id, status, '', 'Stop');
  await expect(toasts(page).filter({ hasText: other.title })).toHaveCount(3);
  await expect(toasts(page).filter({ hasText: stuck.title })).toHaveCount(1);
});

// Its question is on screen there, as a turn's end on show toasts nothing.
test('the tab on show gets the words but no toast', async ({ app, page }) => {
  await startBoth(page, app);
  await tab(page, stuck.title).click();
  await tab(page, stuck.title).locator('.tab-close').click();
  await expect.poll(() => app.calls('closeTerminal')).toHaveLength(1);
  await page.clock.runFor(3000);
  for (const said of words(page)) await expect(said).toHaveText("hasn't left");
  await expect(toasts(page)).toHaveCount(0);
});
