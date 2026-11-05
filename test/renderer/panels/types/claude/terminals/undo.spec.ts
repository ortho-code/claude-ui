import type { Locator, Page } from '@playwright/test';
import { exitLater } from '../../../../support/clock';
import { session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { row, tab, tabLabels } from '../../../../support/window';

// A tab you close and a session you archive, from any control, offer Undo in the toast once the tab has gone, which puts the tab back where it was, cold, and unarchives the session (decided 2026-10-28).
// A tab claude's own exit closed offers nothing: you did not remove it.
const one = session({ id: '00000000-0000-4000-8000-0000000000d1', title: 'First tab' });
const two = session({ id: '00000000-0000-4000-8000-0000000000d2', title: 'Second tab' });
const fixture = { sessions: [one, two], openSessions: [one.id, two.id], history: { [one.id]: [], [two.id]: [] } };
// The stand-in numbers the ptys it starts from 1, and the default layout starts no shell, so the first claude is 1.
const FIRST = 1;

const toast = (page: Page): Locator => page.locator('#toast');
const undo = (page: Page): Locator => page.locator('#toast-action');

/** An item of a session's menu, from its row's kebab, opened first. */
async function menuItem(page: Page, title: string, item: string): Promise<Locator> {
  await row(page, title).locator('.session-kebab').click();
  return page.locator('.kebab-menu button.menu-row', { hasText: new RegExp(`^${item}$`) });
}

/** Start a session's tab and let claude print, so the tab is live. */
async function startLive(page: Page, app: App, title: string): Promise<void> {
  await tabLabels(page).filter({ hasText: title }).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalData', FIRST, 'claude is here')).toBe(1);
}

test('Close tab on a stopped tab offers Undo, which puts the tab back where it was, cold', async ({ app, page }) => {
  await app.boot(fixture);
  await (await menuItem(page, one.title, 'Close tab')).click();
  await expect(tab(page, one.title)).toHaveCount(0);
  await expect(page.locator('#toast-message')).toHaveText(`Closed "${one.title}"`);
  await expect(undo(page)).toHaveText('Undo');

  await undo(page).click();
  await expect(toast(page)).toBeHidden();
  await expect(tabLabels(page)).toHaveText([one.title, two.title]);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  expect(await app.calls('startTerminal')).toEqual([]);
});

test("a stopped tab's button and its middle-click offer Undo too", async ({ app, page }) => {
  await app.boot(fixture);
  await tab(page, two.title).locator('.tab-close').click();
  await expect(page.locator('#toast-message')).toHaveText(`Closed "${two.title}"`);
  await undo(page).click();
  await expect(tabLabels(page)).toHaveText([one.title, two.title]);

  await tabLabels(page).filter({ hasText: one.title }).click({ button: 'middle' });
  await expect(page.locator('#toast-message')).toHaveText(`Closed "${one.title}"`);
  await undo(page).click();
  await expect(tabLabels(page)).toHaveText([one.title, two.title]);
});

test('Close tab on a running session offers Undo once claude has gone, not at the press', async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app, one.title);
  await (await menuItem(page, one.title, 'Close tab')).click();
  await expect(tab(page, one.title)).toHaveCount(1);
  await expect(undo(page)).toBeHidden();

  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await expect(tab(page, one.title)).toHaveCount(0);
  await undo(page).click();
  await expect(tabLabels(page)).toHaveText([one.title, two.title]);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
});

test("a tab claude's own exit closed offers no Undo", async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app, one.title);
  await exitLater(page);
  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await expect(tab(page, one.title)).toHaveCount(0);
  await expect(undo(page)).toBeHidden();
});

test('Archive offers Undo, which unarchives the session and puts its tab back where it was', async ({ app, page }) => {
  await app.boot(fixture);
  await (await menuItem(page, one.title, 'Archive')).click();
  await expect(row(page, one.title)).toHaveCount(0);
  await expect(page.locator('#toast-message')).toHaveText(`Archived "${one.title}"`);

  await undo(page).click();
  expect(await app.calls('unfinish')).toEqual([[[one.id]]]);
  await expect(row(page, one.title)).toHaveCount(1);
  await expect(tabLabels(page)).toHaveText([one.title, two.title]);
  expect(await app.calls('startTerminal')).toEqual([]);
});

test('Archive of a running session offers Undo once claude has gone and the mark is written', async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app, one.title);
  await (await menuItem(page, one.title, 'Archive')).click();
  await expect(undo(page)).toBeHidden();
  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await expect(page.locator('#toast-message')).toHaveText(`Archived "${one.title}"`);
  await undo(page).click();
  await expect(row(page, one.title)).toHaveCount(1);
  await expect(tabLabels(page)).toHaveText([one.title, two.title]);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
});

test('Archive of a session with no tab offers Undo, which unarchives it', async ({ app, page }) => {
  await app.boot({ ...fixture, openSessions: [two.id] });
  await (await menuItem(page, one.title, 'Archive')).click();
  await expect(row(page, one.title)).toHaveCount(0);
  await undo(page).click();
  await expect(row(page, one.title)).toHaveCount(1);
  await expect(tabLabels(page)).toHaveText([two.title]);
});

// Read and then reached for, so longer than a message's 3 s.
test('a toast with Undo is still up after a plain toast would have gone', async ({ app, page }) => {
  await app.boot(fixture);
  await (await menuItem(page, one.title, 'Close tab')).click();
  await expect(undo(page)).toBeVisible();
  await page.waitForTimeout(4000);
  await expect(undo(page)).toBeVisible();
});
