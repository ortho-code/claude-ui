import type { Locator, Page } from '@playwright/test';
import type { ScheduledTask, TerminalLaunch } from '../../../../../../src/shared/types';
import { session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { row, stripRow, tab } from '../../../../support/window';

// A tab whose claude went while a task was scheduled keeps its clock, muted, saying what was scheduled then, since claude's own word on it can be missed; kept for the next launch, and through a start of its claude until that claude reports what it has itself (docs/architecture.md § Status cues).
const one = session();
// A tab on show has its history read; what it holds is not what is checked here.
const fixture = { sessions: [one], history: { [one.id]: [] } };
// The stand-in numbers the ptys it starts from 1, and the default layout starts no shell, so the first claude is 1.
const FIRST = 1;
const tock = { prompt: 'say the word tock', recurring: true, cron: 'Every 10 minutes' };
const tick = { prompt: '/loop say tick', recurring: false, cron: null };
const STOPPED = 'Scheduled when stopped:\nsay the word tock · Every 10 minutes · comes back when you open the session';
const LIVE = 'Scheduled:\nsay the word tock · Every 10 minutes · comes back when you open the session';

const clockOn = (at: Locator): Locator => at.locator('.scheduled-mark');
/** The session's clocks on its tab and its row, which every cold tab has, and its strip row's, which only a paused one has. */
const tabAndRow = (page: Page): Locator[] => [tab(page, one.title), row(page, one.title)].map(clockOn);
/** What the window last kept of the tabs' scheduled tasks for the next launch. */
const lastKept = async (app: App): Promise<unknown> => (await app.calls('setScheduledWhenStopped')).at(-1);

/** Start the session from its row, let its claude print, and give it these tasks, a cron by default, as its last Stop would. */
async function start(page: Page, app: App, tasks: ScheduledTask[] = [tock]): Promise<void> {
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalData', FIRST, 'claude is here')).toBe(1);
  await app.emit('onSessionScheduled', one.id, tasks);
}

/** Stop the tab with its button, and let its claude `terminal` go. */
async function stop(page: Page, app: App, terminal: number): Promise<void> {
  await tab(page, one.title).locator('.tab-close').click();
  await expect.poll(async () => (await app.calls('closeTerminal')).some(([id]) => id === terminal)).toBe(true);
  expect(await app.emit('onTerminalExit', terminal, 0)).toBe(1);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
}

async function expectStopped(clock: Locator): Promise<void> {
  await expect(clock).toBeVisible();
  await expect(clock).toHaveClass(/\bstopped\b/);
  await expect(clock).toHaveAttribute('data-tooltip', STOPPED);
}

test('a session paused with a task scheduled keeps its clock, muted, on its tab, its row and its strip row, and keeps it for the next launch', async ({ app, page }) => {
  await app.boot(fixture);
  await start(page, app);
  await row(page, one.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button.menu-row', { hasText: /^Pause$/ }).click();
  await expect.poll(() => app.calls('closeTerminal')).toEqual([[FIRST, true]]);
  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);

  await expect(tab(page, one.title).locator('.nudge')).toHaveClass(/\bpaused\b/);
  for (const clock of [...tabAndRow(page), clockOn(stripRow(page, one.title))]) await expectStopped(clock);
  await expect.poll(() => lastKept(app)).toEqual([{ [one.id]: [tock] }]);
});

// A `/loop` wakeup ends with the session and a cron comes back (measured), so what a stopped tab keeps is its crons.
test('a stop keeps only the crons, since a /loop wakeup ends with the session', async ({ app, page }) => {
  await app.boot(fixture);
  await start(page, app, [tick, tock]);
  await stop(page, app, FIRST);
  for (const clock of tabAndRow(page)) await expectStopped(clock);
  await expect.poll(() => lastKept(app)).toEqual([{ [one.id]: [tock] }]);
});

test('a session with only a /loop wakeup keeps no clock when stopped', async ({ app, page }) => {
  await app.boot(fixture);
  await start(page, app, [tick]);
  await expect(tab(page, one.title).locator('.scheduled-mark')).toBeVisible();
  await stop(page, app, FIRST);
  for (const clock of tabAndRow(page)) await expect(clock).toBeHidden();
  await expect.poll(() => lastKept(app)).toEqual([{}]);
});

// A start says nothing of what it brought back: a cron comes back, a `/loop` wakeup did not, so the muted clock stays until the claude's first report says which.
test('opened again, it keeps the muted clock until its claude reports, and then shows what that report says', async ({ app, page }) => {
  await app.boot(fixture);
  await start(page, app);
  await stop(page, app, FIRST);

  await tab(page, one.title).locator('.tab-label').click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  expect(await app.emit('onTerminalData', 2, 'claude is here again')).toBe(1);
  await expect(tab(page, one.title)).not.toHaveClass(/\bcold\b/);
  for (const clock of tabAndRow(page)) await expectStopped(clock);

  await app.emit('onSessionScheduled', one.id, [tock]);
  for (const clock of tabAndRow(page)) {
    await expect(clock).not.toHaveClass(/\bstopped\b/);
    await expect(clock).toHaveAttribute('data-tooltip', LIVE);
  }
  await expect.poll(() => lastKept(app)).toEqual([{}]);
});

test('opened again, its clock goes once its claude reports nothing scheduled', async ({ app, page }) => {
  await app.boot(fixture);
  await start(page, app);
  await stop(page, app, FIRST);
  await tab(page, one.title).locator('.tab-label').click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  expect(await app.emit('onTerminalData', 2, 'claude is here again')).toBe(1);

  await app.emit('onSessionScheduled', one.id, []);
  for (const clock of tabAndRow(page)) await expect(clock).toBeHidden();
});

// Stopped again before its claude reported anything, it still knows only what it kept from the stop before.
test('stopped again before its claude reports, it keeps what it had', async ({ app, page }) => {
  await app.boot(fixture);
  await start(page, app);
  await stop(page, app, FIRST);
  await tab(page, one.title).locator('.tab-label').click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  expect(await app.emit('onTerminalData', 2, 'claude is here again')).toBe(1);

  await stop(page, app, 2);
  for (const clock of tabAndRow(page)) await expectStopped(clock);
});

// What a tab kept is its session's: a claude started again that moves on to another session, by `/clear` or its own `/resume`, before it reported, takes the tab without it.
for (const source of ['clear', 'resume']) {
  test(`a tab that moves on to another session by ${source === 'clear' ? '/clear' : '/resume'} before its claude reported keeps nothing for it`, async ({ app, page }) => {
    const other = session({ id: '00000000-0000-4000-8000-0000000000cc', title: 'Another session' });
    await app.boot({ sessions: [one, other], history: { [one.id]: [], [other.id]: [] } });
    await start(page, app);
    await stop(page, app, FIRST);
    await tab(page, one.title).locator('.tab-label').click();
    await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
    expect(await app.emit('onTerminalData', 2, 'claude is here again')).toBe(1);
    const [, [, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];

    expect(await app.emit('onSessionStart', other.id, launch.tabToken ?? '', source)).toBe(1);
    await expect(page.locator('#tabbar .tab .scheduled-mark')).toBeHidden();
    await expect(row(page, one.title).locator('.scheduled-mark')).toBeHidden();
    await expect.poll(() => lastKept(app)).toEqual([{}]);
  });
}

// Stopped without the pause, a tab has no strip row.
test('a stopped tab keeps its clock, muted, on its tab and its row', async ({ app, page }) => {
  await app.boot(fixture);
  await start(page, app);
  await stop(page, app, FIRST);
  for (const clock of tabAndRow(page)) await expectStopped(clock);
  await expect(stripRow(page, one.title)).toHaveCount(0);
});

test('a tab kept paused with a task scheduled shows its muted clock at the next launch', async ({ app, page }) => {
  await app.boot({ ...fixture, openSessions: [one.id], pausedSessions: [one.id], scheduledWhenStopped: { [one.id]: [tock] } });
  await expect(tab(page, one.title).locator('.nudge')).toHaveClass(/\bpaused\b/);
  for (const clock of [...tabAndRow(page), clockOn(stripRow(page, one.title))]) await expectStopped(clock);
  expect(await app.calls('startTerminal')).toEqual([]);
});
