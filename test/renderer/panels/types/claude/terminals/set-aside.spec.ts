import type { Locator, Page } from '@playwright/test';
import type { TerminalLaunch } from '../../../../../../src/shared/types';
import { session, settingsFileWith } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { goLive } from '../../../../support/live';
import { row, tab, tabLabels, toastButton } from '../../../../support/window';

// What setting a running session aside does to its claude, by `setAsideRunning`: stop it and close the tab (the default), stop it and keep the tab, or keep it running (decided 2026-11-11).
// Every set aside raises a toast saying until when, whose Undo puts back all it did: the mark, the tabs it closed, and claude where it ran.
const one = session({ id: '00000000-0000-4000-8000-0000000000a1', title: 'First tab' });
const two = session({ id: '00000000-0000-4000-8000-0000000000a2', title: 'Second tab' });
const fixture = { sessions: [one, two], openSessions: [one.id, two.id], history: { [one.id]: [], [two.id]: [] } };
const choosing = (setAsideRunning: string): typeof fixture & { settings: ReturnType<typeof settingsFileWith> } => ({ ...fixture, settings: settingsFileWith('settings.json', { setAsideRunning }) });
// The stand-in numbers the ptys it starts from 1, and the default layout starts no shell, so the first claude is 1.
const FIRST = 1;
const SAID = `Set "${one.title}" aside, whenever`;

const message = (page: Page): Locator => page.locator('#toast-message');
const buttons = (page: Page): Locator => page.locator('#toast .toast-action');
const undo = (page: Page): Locator => toastButton(page, 'Undo');

/** An item of a session's menu, from its row's kebab, opened first. */
async function menuItem(page: Page, title: string, item: string): Promise<Locator> {
  await row(page, title).locator('.session-kebab').click();
  return page.locator('.kebab-menu:not(.submenu) button.menu-row', { hasText: new RegExp(`^${item}$`) });
}

/** Set a session aside from its row's menu, whenever. */
async function setAsideWhenever(page: Page, title: string): Promise<void> {
  await (await menuItem(page, title, 'Set aside…')).click();
  await page.locator('#set-aside-choices button', { hasText: /^Whenever$/ }).click();
  await page.locator('#set-aside-ok').click();
  await expect(page.locator('#set-aside-overlay')).toBeHidden();
}

const live = (page: Page, app: App): Promise<void> => goLive(page, app, tabLabels(page).filter({ hasText: one.title }), FIRST);

test('by default a running session set aside has its claude asked to leave and its tab closed once it has gone, with a toast whose only button is Undo', async ({ app, page }) => {
  await app.boot(fixture);
  await live(page, app);
  await setAsideWhenever(page, one.title);
  expect(await app.calls('closeTerminal')).toHaveLength(1);
  await expect(tab(page, one.title)).toHaveCount(1);

  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await expect(tab(page, one.title)).toHaveCount(0);
  await expect(message(page)).toHaveText(SAID);
  await expect(buttons(page)).toHaveText(['Undo']);
});

test("the default's Undo takes the mark off, puts the tab back where it stood and starts claude again", async ({ app, page }) => {
  await app.boot(fixture);
  await live(page, app);
  await setAsideWhenever(page, one.title);
  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await undo(page).click();
  await expect(tabLabels(page)).toHaveText([one.title, two.title]);
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  expect(await app.calls('clearSetAside')).toEqual([[[one.id]]]);
  await expect(row(page, one.title).locator('.set-aside-mark')).toBeHidden();
});

test('an Undo pressed while claude is still leaving keeps the tab and starts claude again once it has gone, with no close of its own', async ({ app, page }) => {
  await app.boot(fixture);
  await live(page, app);
  await setAsideWhenever(page, one.title);
  await expect(message(page)).toHaveText(SAID);
  await undo(page).click();
  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await expect(tab(page, one.title)).toHaveCount(1);
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  await expect(message(page)).toBeHidden();
});

test('with "stop" the tab stays, cold, once claude has gone, and Undo takes the mark off and starts claude again in it', async ({ app, page }) => {
  await app.boot(choosing('stop'));
  await live(page, app);
  await setAsideWhenever(page, one.title);
  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  await expect(message(page)).toHaveText(SAID);
  await expect(buttons(page)).toHaveText(['Undo']);

  await undo(page).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  expect(await app.calls('clearSetAside')).toEqual([[[one.id]]]);
});

test('with "keep" claude goes on running, the toast comes at once, and Undo takes the mark off', async ({ app, page }) => {
  await app.boot(choosing('keep'));
  await live(page, app);
  await setAsideWhenever(page, one.title);
  await expect(message(page)).toHaveText(SAID);
  expect(await app.calls('closeTerminal')).toEqual([]);
  await undo(page).click();
  expect(await app.calls('clearSetAside')).toEqual([[[one.id]]]);
  expect(await app.calls('startTerminal')).toHaveLength(1);
});

// A prompt there takes the mark off and calls the leave off, so the set aside has nothing more to say.
test('a set aside called off by a prompt leaves a later stop of that tab its own, with no set-aside toast', async ({ app, page }) => {
  await app.boot(choosing('stop'));
  await live(page, app);
  const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  await setAsideWhenever(page, one.title);
  await app.emit('onSessionStatus', one.id, 'busy', launch.tabToken!, 'UserPromptSubmit');
  await expect(row(page, one.title).locator('.set-aside-mark')).toBeHidden();
  await page.locator('#toast-close').click();
  await expect(message(page)).toBeHidden();
  await (await menuItem(page, one.title, 'Stop session')).click();
  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  await expect(message(page)).toBeHidden();
});

test("an Undo pressed after a prompt called the set aside's leave off does not start claude again after a later stop", async ({ app, page }) => {
  await app.boot(choosing('stop'));
  await live(page, app);
  const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  await setAsideWhenever(page, one.title);
  await app.emit('onSessionStatus', one.id, 'busy', launch.tabToken!, 'UserPromptSubmit');
  await undo(page).click();
  await (await menuItem(page, one.title, 'Stop session')).click();
  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  expect(await app.calls('startTerminal')).toHaveLength(1);
});

test("a Close tab pressed while a set aside's claude is leaving takes the exit over, with the close's own toast", async ({ app, page }) => {
  await app.boot(choosing('stop'));
  await live(page, app);
  await setAsideWhenever(page, one.title);
  await (await menuItem(page, one.title, 'Close tab')).click();
  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await expect(tab(page, one.title)).toHaveCount(0);
  await expect(message(page)).toHaveText(`Closed "${one.title}", set aside, whenever`);
});

test('a session whose tab is cold keeps its tab when set aside, whatever the setting, and still gets the toast', async ({ app, page }) => {
  await app.boot(fixture);
  await setAsideWhenever(page, one.title);
  await expect(tab(page, one.title)).toHaveCount(1);
  await expect(message(page)).toHaveText(SAID);
  expect(await app.calls('closeTerminal')).toEqual([]);
});

test("closing the tab of a session set aside says until when, and offers Clear set aside beside Undo, Finished and Set aside…", async ({ app, page }) => {
  await app.boot({ ...fixture, setAside: { [one.id]: { due: null, at: 1 } } });
  await (await menuItem(page, one.title, 'Close tab')).click();
  await expect(message(page)).toHaveText(`Closed "${one.title}", set aside, whenever`);
  await expect(buttons(page)).toHaveText(['Undo', 'Finished', 'Set aside…', 'Clear set aside']);
  await toastButton(page, 'Clear set aside').click();
  expect(await app.calls('clearSetAside')).toEqual([[[one.id]]]);
  await expect(row(page, one.title).locator('.set-aside-mark')).toBeHidden();
});
