import type { Locator, Page } from '@playwright/test';
import type { TerminalLaunch } from '../../../../../../src/shared/types';
import { exitAtOnce } from '../../../../support/clock';
import { PROJECT, session, settingsFileWith } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { row, stripRow, switcherEntry, tab } from '../../../../support/window';

// Pausing sets a tab aside from its session's menu: a running session's claude is asked to leave, and a cold tab is only marked; the session's own dots then show it paused.
// A tab you paused is kept as paused with the open tabs, comes back paused at the next launch without starting, and loses the mark only when its session runs again or you choose Stop session in its menu, the running one's word, which leaves it an ordinary stopped tab.
const one = session();
const two = session({ id: '00000000-0000-4000-8000-000000000002', title: 'Second session' });
// A tab on show has its history read; what it holds is not what is checked here.
const history = { [one.id]: [], [two.id]: [] };
// The stand-in numbers the ptys it starts from 1, and the default layout starts no shell, so the first claude is 1.
const FIRST = 1;

/** The open tabs, the running ones and the paused ones, as the window last wrote them. */
const lastKept = async (app: App): Promise<unknown> => (await app.calls('setOpenSessions')).at(-1);

/** Choose an item of a session's menu, from its row's kebab. */
async function fromMenu(page: Page, title: string, item: 'Pause' | 'Stop session'): Promise<void> {
  await row(page, title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button', { hasText: new RegExp(`^${item}$`) }).click();
}

const tabDot = (page: Page, title: string): Locator => tab(page, title).locator('.nudge');
const rowDot = (page: Page, title: string): Locator => row(page, title).locator('.nudge');

test('pausing a running session from its menu asks its claude to leave, its dots say it is pausing until claude has gone, and paused once it has', async ({ app, page }) => {
  await app.boot({ history });
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalData', FIRST, 'claude is here')).toBe(1);

  await fromMenu(page, one.title, 'Pause');
  expect(await app.calls('closeTerminal')).toEqual([[FIRST, false]]);
  await expect(tab(page, one.title).locator('.tab-close')).toHaveAttribute('data-tooltip', 'Pausing…');
  // Kept as paused at once, so a quit before claude has gone still comes back paused; the dots say the pause is under way until it has.
  await expect.poll(() => lastKept(app)).toEqual([[one.id], [one.id], [one.id]]);
  for (const dot of [tabDot(page, one.title), rowDot(page, one.title), stripRow(page, one.title).locator('.nudge')]) {
    await expect(dot).toHaveClass(/\bpausing\b/);
    await expect(dot).not.toHaveClass(/\bpaused\b/);
  }

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

// A cold tab can come back from a restart with a status left in its file; paused, it would go on nudging from every roll-up while its own dots show the pause.
test('pausing a cold tab forgets the status it still held, so nothing nudges for it', async ({ app, page }) => {
  await app.boot({ sessions: [one], openSessions: [one.id], statuses: { [one.id]: 'waiting' }, history });
  await expect(switcherEntry(page, 'demo').locator('.nudge')).toHaveClass(/\bwaiting\b/);
  await fromMenu(page, one.title, 'Pause');
  await expect(tabDot(page, one.title)).toHaveClass(/\bpaused\b/);
  await expect(switcherEntry(page, 'demo').locator('.nudge')).not.toHaveClass(/\bwaiting\b/);
  await expect(page.locator('#strip-badge')).toBeHidden();
  expect(await app.calls('clearStatus')).toEqual([[one.id]]);
});

test('stopping a paused session takes the mark off and leaves the tab cold', async ({ app, page }) => {
  await app.boot({ sessions: [one], openSessions: [one.id], pausedSessions: [one.id], history });
  await expect(tabDot(page, one.title)).toHaveClass(/\bpaused\b/);
  await fromMenu(page, one.title, 'Stop session');
  await expect(tabDot(page, one.title)).not.toHaveClass(/\bpaused\b/);
  await expect(rowDot(page, one.title)).not.toHaveClass(/\bpaused\b/);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  await expect.poll(() => lastKept(app)).toEqual([[one.id], [], []]);
  expect(await app.calls('startTerminal')).toEqual([]);
});

// A pause is not there until claude has gone: until then the tab runs, so its menu is a running tab's, and its Pause asks claude again, for a claude that let the first ask pass.
test("a paused tab whose claude is still leaving has a running tab's menu, and its Pause asks claude again", async ({ app, page }) => {
  await app.boot({ history });
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await fromMenu(page, one.title, 'Pause');
  // Asked to leave, not gone, and past the moment after which the stop can be forced.
  await expect.poll(() => app.calls('closeTerminal')).toHaveLength(1);
  await expect(tab(page, one.title).locator('.tab-close')).toBeEnabled();
  await row(page, one.title).locator('.session-kebab').click();
  await expect(page.locator('.kebab-menu button.menu-row', { hasText: /^Stop session$/ })).toHaveCount(0);
  await expect(page.locator('.kebab-menu button.menu-row', { hasText: /^Force stop$/ })).not.toHaveClass(/\bunavailable\b/);
  await page.locator('.kebab-menu button.menu-row', { hasText: /^Pause$/ }).click();
  expect(await app.calls('closeTerminal')).toEqual([
    [FIRST, false],
    [FIRST, false],
  ]);
  // Asked again, so the force waits its moment again.
  await expect(tab(page, one.title).locator('.tab-close')).toHaveAttribute('data-tooltip', 'Pausing…');
  expect(await app.calls('killTerminal')).toEqual([]);

  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  await expect(tabDot(page, one.title)).toHaveClass(/\bpaused\b/);
  await expect.poll(() => lastKept(app)).toEqual([[one.id], [], [one.id]]);
});

// A stop claude let pass can be made a pause, which asks claude again and keeps the tab, paused, once it has gone.
test("pausing a session whose stop claude has not answered asks it again, and the tab rests paused once claude has gone", async ({ app, page }) => {
  await app.boot({ history });
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const close = tab(page, one.title).locator('.tab-close');
  await close.click();
  await expect(close).toBeEnabled();
  await expect(tabDot(page, one.title)).toHaveClass(/\bstopping\b/);

  await fromMenu(page, one.title, 'Pause');
  expect(await app.calls('closeTerminal')).toEqual([
    [FIRST, false],
    [FIRST, false],
  ]);
  await expect(tabDot(page, one.title)).toHaveClass(/\bpausing\b/);
  await expect.poll(() => lastKept(app)).toEqual([[one.id], [one.id], [one.id]]);

  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  await expect(tabDot(page, one.title)).toHaveClass(/\bpaused\b/);
});

// Opening a paused tab starts it, and the mark goes when its process arrives: until then there is nothing to stop yet, so Stop session says so, as the tab's button does, rather than offering to take the mark off while the start goes on.
test('a paused tab that is starting offers no Stop session yet, and says why', async ({ app, page }) => {
  await app.boot({ sessions: [one], openSessions: [one.id], pausedSessions: [one.id], history });
  await app.hold('startTerminal');
  await tab(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await row(page, one.title).locator('.session-kebab').click();
  const stop = page.locator('.kebab-menu button.menu-row', { hasText: /^Stop session$/ });
  await expect(stop).toHaveCount(1);
  await expect(stop).toHaveAttribute('data-tooltip', 'Starting…');
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

test('a tab kept as paused comes back paused and is not started at launch, even one that was running when the app closed and with running ones chosen to start', async ({ app, page }) => {
  const starting = settingsFileWith('settings.json', { runningSessionsAtLaunch: 'start' });
  await app.boot({ sessions: [one, two], openSessions: [one.id, two.id], runningSessions: [one.id, two.id], pausedSessions: [one.id], activeSession: one.id, history, settings: starting });
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
  await exitAtOnce(page);
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
