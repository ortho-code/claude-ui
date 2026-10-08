import type { Locator, Page } from '@playwright/test';
import type { TerminalLaunch } from '../../../../../../src/shared/types';
import { PROJECT, session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { row, tab } from '../../../../support/window';

// Pausing sets a tab aside from its session's menu: a running session's claude is asked to leave, and a cold tab is only marked; the session's own dots then show it paused.
// A tab you paused is kept as paused with the open tabs, comes back paused at the next launch without starting, and loses the mark only when its session runs again or you unpause it.
const one = session();
const two = session({ id: '00000000-0000-4000-8000-000000000002', title: 'Second session' });
// A tab on show has its history read; what it holds is not what is checked here.
const history = { [one.id]: [], [two.id]: [] };
// The stand-in numbers the ptys it starts from 1, and the default layout starts no shell, so the first claude is 1.
const FIRST = 1;

/** The open tabs, the running ones and the paused ones, as the window last wrote them. */
const lastKept = async (app: App): Promise<unknown> => (await app.calls('setOpenSessions')).at(-1);

/** Choose an item of a session's menu, from its row's kebab. */
async function fromMenu(page: Page, title: string, item: 'Pause' | 'Unpause'): Promise<void> {
  await row(page, title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button', { hasText: new RegExp(`^${item}$`) }).click();
}

const tabDot = (page: Page, title: string): Locator => tab(page, title).locator('.nudge');
const rowDot = (page: Page, title: string): Locator => row(page, title).locator('.nudge');

test('pausing a running session from its menu asks its claude to leave, and its tab and row show it paused once claude has gone', async ({ app, page }) => {
  await app.boot({ history });
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalData', FIRST, 'claude is here')).toBe(1);

  await fromMenu(page, one.title, 'Pause');
  expect(await app.calls('closeTerminal')).toEqual([[FIRST, false]]);
  // Kept as paused at once, so a quit before claude has gone still comes back paused; the dot shows what claude is doing until it has.
  await expect.poll(() => lastKept(app)).toEqual([[one.id], [one.id], [one.id]]);
  await expect(tabDot(page, one.title)).not.toHaveClass(/\bpaused\b/);

  await app.emit('onTerminalExit', FIRST, 0);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  await expect(tabDot(page, one.title)).toHaveClass(/\bpaused\b/);
  await expect(rowDot(page, one.title)).toHaveClass(/\bpaused\b/);
  await expect.poll(() => lastKept(app)).toEqual([[one.id], [], [one.id]]);
});

test('pausing a cold tab only marks it, and starts nothing', async ({ app, page }) => {
  await app.boot({ sessions: [one], openSessions: [one.id], history });
  await fromMenu(page, one.title, 'Pause');
  await expect(tabDot(page, one.title)).toHaveClass(/\bpaused\b/);
  await expect(rowDot(page, one.title)).toHaveClass(/\bpaused\b/);
  await expect.poll(() => lastKept(app)).toEqual([[one.id], [], [one.id]]);
  expect(await app.calls('startTerminal')).toEqual([]);
});

test('unpausing takes the mark off and leaves the tab cold', async ({ app, page }) => {
  await app.boot({ sessions: [one], openSessions: [one.id], pausedSessions: [one.id], history });
  await expect(tabDot(page, one.title)).toHaveClass(/\bpaused\b/);
  await fromMenu(page, one.title, 'Unpause');
  await expect(tabDot(page, one.title)).not.toHaveClass(/\bpaused\b/);
  await expect(rowDot(page, one.title)).not.toHaveClass(/\bpaused\b/);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  await expect.poll(() => lastKept(app)).toEqual([[one.id], [], []]);
  expect(await app.calls('startTerminal')).toEqual([]);
});

test('a session without a tab has no pause in its menu', async ({ app, page }) => {
  await app.boot({ history });
  await row(page, one.title).locator('.session-kebab').click();
  await expect(page.locator('.kebab-menu button', { hasText: 'Archive' })).toBeVisible();
  await expect(page.locator('.kebab-menu button', { hasText: /pause/i })).toHaveCount(0);
});

test('a prompt submitted while the pause waits for claude to leave calls the pause off', async ({ app, page }) => {
  await app.boot({ history });
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  expect(await app.emit('onTerminalData', FIRST, 'claude is here')).toBe(1);

  await fromMenu(page, one.title, 'Pause');
  await expect.poll(() => lastKept(app)).toEqual([[one.id], [one.id], [one.id]]);
  // Esc at a question claude asks on its way out takes it back to its prompt, and only the next prompt says so.
  expect(await app.emit('onSessionStatus', one.id, 'busy', launch.tabToken ?? '', 'UserPromptSubmit')).toBe(1);
  await expect.poll(() => lastKept(app)).toEqual([[one.id], [one.id], []]);
  await expect(tab(page, one.title).locator('.tab-close')).toBeEnabled();
});

test('a dot marked read before its session was paused shows the pause, not the mark', async ({ app, page }) => {
  await app.boot({ sessions: [one], openSessions: [one.id], statuses: { [one.id]: 'idle' }, history });
  await rowDot(page, one.title).click();
  await expect(rowDot(page, one.title)).toHaveClass(/\backed\b/);
  await fromMenu(page, one.title, 'Pause');
  await expect(rowDot(page, one.title)).toHaveClass(/\bpaused\b/);
  await expect(rowDot(page, one.title)).not.toHaveClass(/\backed\b/);
  await expect(tabDot(page, one.title)).not.toHaveClass(/\backed\b/);
});

test("a paused session's dot is no control: a click on it opens the session, which resumes it, rather than marking it read", async ({ app, page }) => {
  await app.boot({ sessions: [one], openSessions: [one.id], pausedSessions: [one.id], history });
  await rowDot(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await expect.poll(() => lastKept(app)).toEqual([[one.id], [one.id], []]);
  await expect(tabDot(page, one.title)).not.toHaveClass(/\bpaused\b/);
});

test('a tab kept as paused comes back paused and is not started at launch, even one that was running when the app closed', async ({ app, page }) => {
  await app.boot({ sessions: [one, two], openSessions: [one.id, two.id], runningSessions: [one.id, two.id], pausedSessions: [one.id], activeSession: one.id, history });
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  expect(launch.resumeSessionId).toBe(two.id);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  await expect.poll(() => lastKept(app)).toEqual([[one.id, two.id], [two.id], [one.id]]);
});

test('starting a paused tab takes the mark off once its claude has arrived', async ({ app, page }) => {
  await app.boot({ sessions: [one], openSessions: [one.id], pausedSessions: [one.id], history });
  await expect.poll(() => lastKept(app)).toEqual([[one.id], [], [one.id]]);
  await tab(page, one.title).locator('.tab-label').click();
  await expect.poll(() => lastKept(app)).toEqual([[one.id], [one.id], []]);
});

test('a paused tab whose start fails within its first moments stays paused', async ({ app, page }) => {
  await app.boot({ sessions: [one], openSessions: [one.id], pausedSessions: [one.id], history });
  await tab(page, one.title).locator('.tab-label').click();
  await expect.poll(() => lastKept(app)).toEqual([[one.id], [one.id], []]);
  await app.emit('onTerminalExit', FIRST, 127);
  await expect.poll(() => lastKept(app)).toEqual([[one.id], [], [one.id]]);
});

test('a paused tab whose start is refused stays paused', async ({ app, page }) => {
  await app.boot({ sessions: [one], openSessions: [one.id], pausedSessions: [one.id], history });
  await expect.poll(() => lastKept(app)).toEqual([[one.id], [], [one.id]]);
  // Gone from the disk where the listing still has it: main refuses the start, so no claude ever arrives.
  await page.evaluate((folder) => {
    window.__claudeUiFixture.paths[folder] = 'missing';
  }, PROJECT);
  await tab(page, one.title).locator('.tab-label').click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await expect(page.locator('#toast-message')).toBeVisible();
  for (const [, , paused] of (await app.calls('setOpenSessions')) as string[][][]) expect(paused).toEqual([one.id]);
});
