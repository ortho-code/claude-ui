import type { Locator, Page } from '@playwright/test';
import type { TerminalLaunch } from '../../../../../../src/shared/types';
import { exitLater } from '../../../../support/clock';
import { session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { row, tab, tabs } from '../../../../support/window';

// Finished is one press on a running session too: its claude is asked to leave as a close asks it, the tab stays for whatever claude asks on its way out, and the session is finished once claude has gone, so the claude it asked does not run a finished session.
const one = session();
// A tab on show has its history read; what it holds is not what is checked here.
const fixture = { history: { [one.id]: [] } };
// The stand-in numbers the ptys it starts from 1, and the default layout starts no shell, so the first claude is 1.
const FIRST = 1;
// The session claude goes on in, by its own `/resume` or after a `/clear`: one the listing does not have, so the tab names it as a new one.
const OTHER = '00000000-0000-4000-8000-0000000000ee';

/** Start the session's row and let claude print, so the tab is live. */
async function startLive(page: Page, app: App): Promise<void> {
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalData', FIRST, 'claude is here')).toBe(1);
}

/** An item of the session's menu, from its row's kebab, opened first. */
async function menuItem(page: Page, item: string): Promise<Locator> {
  await row(page, one.title).locator('.session-kebab').click();
  return page.locator('.kebab-menu button.menu-row', { hasText: new RegExp(`^${item}$`) });
}

const button = (page: Page): Locator => tab(page, one.title).locator('.tab-close');

test('Finished on a running session asks its claude to leave, keeps the tab until it has gone, then finishes it and closes the tab', async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app);
  await (await menuItem(page, 'Finished')).click();
  expect(await app.calls('closeTerminal')).toEqual([[FIRST, false]]);
  // Still there, stopping, for what claude may ask, and not finished while it runs.
  await expect(tab(page, one.title).locator('.nudge')).toHaveClass(/\bstopping\b/);
  await expect(row(page, one.title)).toHaveCount(1);
  expect(await app.calls('finish')).toEqual([]);

  await app.emit('onTerminalExit', FIRST, 0);
  await expect(tab(page, one.title)).toHaveCount(0);
  await expect(row(page, one.title)).toHaveCount(0);
  expect(await app.calls('finish')).toEqual([[[one.id]]]);
});

// Esc at claude's question on the way out takes it back to its prompt, and the next prompt says it stayed: the finish goes with the stop.
test('a prompt submitted after Finished calls it off: the tab stays live, and claude leaving later finishes nothing', async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app);
  const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  await (await menuItem(page, 'Finished')).click();
  await app.emit('onSessionStatus', one.id, 'busy', launch.tabToken!, 'UserPromptSubmit');
  await expect(button(page)).toHaveAttribute('data-tooltip', 'Stop session');
  // Said, since a prompt sent just before the press can report after it and call off a finish you meant (decided 2026-10-28).
  await expect(page.locator('#toast-message')).toHaveText(`Finishing "${one.title}" was called off`);

  // Claude ending by itself closes the tab, as it does for any running session.
  await exitLater(page);
  await app.emit('onTerminalExit', FIRST, 0);
  await expect(tab(page, one.title)).toHaveCount(0);
  await expect(row(page, one.title)).toHaveCount(1);
  expect(await app.calls('finish')).toEqual([]);
});

// A `/resume` fires no prompt's report (measured), and both mean you went on working, as a prompt does: the finish goes, rather than finishing the session the tab went on in (decided 2026-10-28).
// Saying nothing, since you typed it yourself.
for (const source of ['resume', 'clear'] as const) {
  test(`a ${source} at claude's question on the way out calls a finish off, without a toast, and finishes neither session`, async ({ app, page }) => {
    await app.boot(fixture);
    await startLive(page, app);
    const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
    await (await menuItem(page, 'Finished')).click();
    expect(await app.emit('onSessionStart', OTHER, launch.tabToken!, source)).toBe(1);
    await expect(tabs(page).locator('.tab-close')).toHaveAttribute('data-tooltip', 'Stop session');
    // Its text, which a toast going after its three seconds leaves in place, so a toast shown and gone fails this too.
    await expect(page.locator('#toast-message')).toHaveText('');

    await exitLater(page);
    await app.emit('onTerminalExit', FIRST, 0);
    await expect(tabs(page)).toHaveCount(0);
    await expect(row(page, one.title)).toHaveCount(1);
    expect(await app.calls('finish')).toEqual([]);
  });
}

// A second claude in a session another tab runs is forced out, also one asked to leave for a finish, and its going on in another session called the finish off.
test('a finish whose claude resumes a session another tab runs is called off, and that claude is forced out, its tab kept', async ({ app, page }) => {
  const two = session({ id: '00000000-0000-4000-8000-000000000002', title: 'Second session' });
  await app.boot({ sessions: [one, two], history: { [one.id]: [], [two.id]: [] } });
  await startLive(page, app);
  const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  await row(page, two.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  expect(await app.emit('onTerminalData', FIRST + 1, 'claude is here')).toBe(1);
  await (await menuItem(page, 'Finished')).click();
  expect(await app.calls('closeTerminal')).toEqual([[FIRST, false]]);

  await app.emit('onSessionStart', two.id, launch.tabToken!, 'resume');
  await expect.poll(() => app.calls('killTerminal')).toEqual([[FIRST]]);
  await app.emit('onTerminalExit', FIRST, 143);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  expect(await app.calls('finish')).toEqual([]);
});

// The tab is gone by then, so the toast is all that says the session is still in the list.
test("a finish main fails to write at claude's exit says so, and leaves the session in the list", async ({ app, page }) => {
  await app.boot({ ...fixture, finishFails: 'meta.json could not be written' });
  await startLive(page, app);
  await (await menuItem(page, 'Finished')).click();
  await app.emit('onTerminalExit', FIRST, 0);
  await expect(page.locator('#toast-message')).toHaveText(`Couldn't finish "${one.title}". It's still here.`);
  await expect(row(page, one.title)).toHaveCount(1);
});

test('a finish main fails to write for a session with no tab says so, and leaves it in the list', async ({ app, page }) => {
  await app.boot({ ...fixture, finishFails: 'meta.json could not be written' });
  await (await menuItem(page, 'Finished')).click();
  await expect(page.locator('#toast-message')).toHaveText(`Couldn't finish "${one.title}". It's still here.`);
  await expect(row(page, one.title)).toHaveCount(1);
});

test('a finish claude has not left is forced by the Force finish, and the forced exit finishes it', async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app);
  await (await menuItem(page, 'Finished')).click();
  await expect(button(page)).toHaveAttribute('data-mark', 'finish');
  await expect(button(page)).toHaveAttribute('data-tooltip', 'Finishing…');
  await expect(button(page)).toHaveAttribute('data-tooltip', /^Force finish/);
  await expect(button(page)).toHaveAttribute('data-mark', 'force-finish');
  await button(page).click();
  expect(await app.calls('killTerminal')).toEqual([[FIRST]]);

  await app.emit('onTerminalExit', FIRST, 143);
  await expect(tab(page, one.title)).toHaveCount(0);
  expect(await app.calls('finish')).toEqual([[[one.id]]]);
});

// A claude already asked to leave is asked nothing more, since a second pair of presses ends what it asks on its way out unanswered: what its exit does changes, as Close changes it.
for (const leave of ['Stop session', 'Close tab'] as const) {
  test(`Finished on a tab whose claude is leaving from ${leave} sends nothing more, and finishes it at the exit`, async ({ app, page }) => {
    await app.boot(fixture);
    await startLive(page, app);
    await (await menuItem(page, leave)).click();
    expect(await app.calls('closeTerminal')).toEqual([[FIRST, false]]);

    const finish = await menuItem(page, 'Finished');
    await expect(finish).not.toHaveClass(/\bunavailable\b/);
    await finish.click();
    expect(await app.calls('closeTerminal')).toEqual([[FIRST, false]]);
    expect(await app.calls('finish')).toEqual([]);

    await app.emit('onTerminalExit', FIRST, 0);
    await expect(tab(page, one.title)).toHaveCount(0);
    await expect(row(page, one.title)).toHaveCount(0);
    expect(await app.calls('finish')).toEqual([[[one.id]]]);
  });
}

// There is no claude yet to ask to leave, as Stop session says too.
test('Finished is unavailable while the tab starts, saying so, and finishes nothing', async ({ app, page }) => {
  await app.boot(fixture);
  await app.hold('startTerminal');
  await row(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const finish = await menuItem(page, 'Finished');
  await expect(finish).toHaveClass(/\bunavailable\b/);
  await expect(finish).toHaveAttribute('data-tooltip', 'Starting…');
  await finish.click({ force: true });
  expect(await app.calls('finish')).toEqual([]);
  expect(await app.calls('closeTerminal')).toEqual([]);
});

// A claude that has not gone may still need you, answering its question say, so a quit leaves the session unfinished and its tab kept for the next launch, as a close under way is.
test('a quit while a finish waits for claude writes no mark, and keeps the tab for the next launch', async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app);
  await (await menuItem(page, 'Finished')).click();
  expect(await app.emit('onQuitting')).toBe(1);
  await app.emit('onTerminalExit', FIRST, 143);
  expect(await app.calls('finish')).toEqual([]);
  expect((await app.calls('setOpenSessions')).at(-1)).toEqual([[one.id], [one.id]]);
});
