import { session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { row, tab } from '../../../../support/window';

// What the window keeps for the next launch: the open tabs, and which of them run, written together.
// A session counts as running from its start until its process has gone, and what the quit itself ends is not written, so the next launch finds what ran when the app closed.
const one = session();
// A tab on show has its history read; what it holds is not what is checked here.
const fixture = { history: { [one.id]: [] } };
// The stand-in numbers the ptys it starts from 1, and the default layout starts no shell, so the first claude is 1.
const FIRST = 1;

/** The open tabs and the running ones, as the window last wrote them. */
const lastKept = async (app: App): Promise<unknown> => (await app.calls('setOpenSessions')).at(-1);

test('a session is kept as running from its start until its process has gone, a stop claude has not answered included', async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, one.title).click();
  await expect.poll(() => lastKept(app)).toEqual([[one.id], [one.id]]);

  const close = tab(page, one.title).locator('.tab-close');
  await close.click();
  expect(await app.calls('closeTerminal')).toEqual([[FIRST, false]]);
  // Asked to leave, and claude has not gone yet: still running.
  await expect(close).toBeDisabled();
  expect(await lastKept(app)).toEqual([[one.id], [one.id]]);

  await app.emit('onTerminalExit', FIRST, 0);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  await expect.poll(() => lastKept(app)).toEqual([[one.id], []]);
});

test('a failed start is no longer kept as running', async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, one.title).click();
  await expect.poll(() => lastKept(app)).toEqual([[one.id], [one.id]]);

  await app.emit('onTerminalExit', FIRST, 127);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  await expect.poll(() => lastKept(app)).toEqual([[one.id], []]);
});

test('what runs when the app quits stays kept as running: the exits the quit causes write nothing', async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, one.title).click();
  await expect.poll(() => lastKept(app)).toEqual([[one.id], [one.id]]);
  const writes = (await app.calls('setOpenSessions')).length;
  // Past the moment in which an exit reads as a failed start, so the exit closes the tab, which would write.
  await page.clock.setSystemTime(Date.now() + 60_000);

  expect(await app.emit('onQuitting')).toBe(1);
  await app.emit('onTerminalExit', FIRST, 0);
  await expect(tab(page, one.title)).toHaveCount(0);
  expect(await app.calls('setOpenSessions')).toHaveLength(writes);
});
