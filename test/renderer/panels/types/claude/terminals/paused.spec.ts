import type { TerminalLaunch } from '../../../../../../src/shared/types';
import { PROJECT, session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { tab } from '../../../../support/window';

// A tab you paused is kept as paused with the open tabs, comes back paused at the next launch without starting, and loses the mark only when its session runs again.
const one = session();
const two = session({ id: '00000000-0000-4000-8000-000000000002', title: 'Second session' });
// A tab on show has its history read; what it holds is not what is checked here.
const history = { [one.id]: [], [two.id]: [] };
// The stand-in numbers the ptys it starts from 1, and the default layout starts no shell, so the first claude is 1.
const FIRST = 1;

/** The open tabs, the running ones and the paused ones, as the window last wrote them. */
const lastKept = async (app: App): Promise<unknown> => (await app.calls('setOpenSessions')).at(-1);

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
