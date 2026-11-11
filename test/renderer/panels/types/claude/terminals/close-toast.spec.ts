import type { Locator, Page } from '@playwright/test';
import { exitLater } from '../../../../support/clock';
import { session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { row, tab, tabLabels, toastButton } from '../../../../support/window';

// A close you press offers Finished and Set aside… beside Undo, so the decision is one press at the moment it is cheapest (decided 2026-11-05).
// Whichever is pressed, the toast it raises has an Undo back to before the close.
const one = session({ id: '00000000-0000-4000-8000-0000000000e1', title: 'First tab' });
const two = session({ id: '00000000-0000-4000-8000-0000000000e2', title: 'Second tab' });
const fixture = { sessions: [one, two], openSessions: [one.id, two.id], history: { [one.id]: [], [two.id]: [] } };
// The stand-in numbers the ptys it starts from 1, and the default layout starts no shell, so the first claude is 1.
const FIRST = 1;

const message = (page: Page): Locator => page.locator('#toast-message');
const buttons = (page: Page): Locator => page.locator('#toast .toast-action');
const dialog = (page: Page): Locator => page.locator('#set-aside-overlay');
const choice = (page: Page, name: RegExp): Locator => page.locator('#set-aside-choices button', { hasText: name });

/** An item of a session's menu, from its row's kebab, opened first. */
async function menuItem(page: Page, title: string, item: string): Promise<Locator> {
  await row(page, title).locator('.session-kebab').click();
  return page.locator('.kebab-menu:not(.submenu) button.menu-row', { hasText: new RegExp(`^${item}$`) });
}

/** Close a stopped tab from its row's menu, and wait for its toast, saying `said`. */
async function closeFromMenu(page: Page, title: string, said = `Closed "${title}"`): Promise<void> {
  await (await menuItem(page, title, 'Close tab')).click();
  await expect(tab(page, title)).toHaveCount(0);
  await expect(message(page)).toHaveText(said);
}

/** Start a session's tab and let claude print, so the tab is live. */
async function startLive(page: Page, app: App, title: string): Promise<void> {
  await tabLabels(page).filter({ hasText: title }).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalData', FIRST, 'claude is here')).toBe(1);
}

test("a stopped tab's close offers Undo, Finished and Set aside…, in that order", async ({ app, page }) => {
  await app.boot(fixture);
  await closeFromMenu(page, one.title);
  await expect(buttons(page)).toHaveText(['Undo', 'Finished', 'Set aside…']);
});

test("Finished from the close's toast finishes the session, and its Undo makes it unfinished and puts the tab back where it stood, with its needs-you mark", async ({ app, page }) => {
  await app.boot({ ...fixture, needsYou: { [one.id]: [{ type: 'app.was-running' as const, at: 1, how: 'quit' as const }] } });
  await closeFromMenu(page, one.title);
  await toastButton(page, 'Finished').click();
  await expect(message(page)).toHaveText(`Finished "${one.title}"`);
  expect(await app.calls('finish')).toEqual([[[one.id]]]);
  await expect(row(page, one.title)).toHaveCount(0);

  await toastButton(page, 'Undo').click();
  expect(await app.calls('unfinish')).toEqual([[[one.id]]]);
  await expect(row(page, one.title)).toHaveCount(1);
  await expect(tabLabels(page)).toHaveText([one.title, two.title]);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  await expect(row(page, one.title).locator('.nudge')).toHaveClass(/\bneeds\b/);
  expect(await app.calls('startTerminal')).toEqual([]);
});

test("Set aside… from the close's toast opens the dialog with the session's note; Set aside marks it, and the toast's Undo clears the mark and puts the tab back", async ({ app, page }) => {
  await app.boot({ ...fixture, notes: { [one.id]: 'waiting on review' } });
  await closeFromMenu(page, one.title);
  await toastButton(page, 'Set aside…').click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('#set-aside-note')).toHaveValue('waiting on review');
  await choice(page, /^Whenever$/).click();
  await page.locator('#set-aside-ok').click();
  await expect(dialog(page)).toBeHidden();
  await expect(message(page)).toHaveText(`Set "${one.title}" aside, whenever`);
  expect((await app.calls('markSetAside')).map(([ids, due]) => [ids, due])).toEqual([[[one.id], null]]);

  await toastButton(page, 'Undo').click();
  expect(await app.calls('clearSetAside')).toEqual([[[one.id]]]);
  await expect(tabLabels(page)).toHaveText([one.title, two.title]);
});

test("cancelling Set aside… brings the close's toast back, its Undo still there", async ({ app, page }) => {
  await app.boot(fixture);
  await closeFromMenu(page, one.title);
  await toastButton(page, 'Set aside…').click();
  await page.locator('#set-aside-cancel').click();
  await expect(dialog(page)).toBeHidden();
  await expect(message(page)).toHaveText(`Closed "${one.title}"`);
  await expect(buttons(page)).toHaveText(['Undo', 'Finished', 'Set aside…']);
  await toastButton(page, 'Undo').click();
  await expect(tabLabels(page)).toHaveText([one.title, two.title]);
  expect(await app.calls('markSetAside')).toEqual([]);
});

test("a running tab's close offers the three once claude has gone, not at the press", async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app, one.title);
  await (await menuItem(page, one.title, 'Close tab')).click();
  await expect(buttons(page)).toHaveCount(0);
  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await expect(message(page)).toHaveText(`Closed "${one.title}"`);
  await expect(buttons(page)).toHaveText(['Undo', 'Finished', 'Set aside…']);
});

test("the bar's Close tab with two stopped tabs raises one toast, whose Finished finishes both and whose Set aside… asks for both without a line", async ({ app, page }) => {
  await app.boot(fixture);
  await (await menuItem(page, one.title, 'Select…')).click();
  await row(page, two.title).click();
  await page.locator('#bulk-bar [data-act="close"]').click();
  await expect(message(page)).toHaveText('Closed 2 tabs');
  await toastButton(page, 'Set aside…').click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('#set-aside-note')).toBeHidden();
  await page.locator('#set-aside-cancel').click();
  await expect(message(page)).toHaveText('Closed 2 tabs');
  await toastButton(page, 'Finished').click();
  await expect(message(page)).toHaveText('Finished 2 sessions');
  expect(await app.calls('finish')).toEqual([[[one.id, two.id]]]);
});

test("a session already set aside: the close toast's Set aside… shows its mark, and Finished's Undo puts the mark back", async ({ app, page }) => {
  await app.boot({ ...fixture, setAside: { [one.id]: { due: null, at: 1 } } });
  await closeFromMenu(page, one.title, `Closed "${one.title}", set aside, whenever`);
  await toastButton(page, 'Set aside…').click();
  await expect(page.locator('#set-aside-overlay')).toContainText('Now set aside, whenever');
  await page.locator('#set-aside-cancel').click();
  await toastButton(page, 'Finished').click();
  await expect(row(page, one.title)).toHaveCount(0);
  await toastButton(page, 'Undo').click();
  await expect(row(page, one.title).locator('.set-aside-mark')).toBeVisible();
});

test("claude's own exit raises no close toast", async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app, one.title);
  await exitLater(page);
  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await expect(tab(page, one.title)).toHaveCount(0);
  await expect(buttons(page)).toHaveCount(0);
});

test('at 800px wide, a long title wraps and the three buttons stay on one line each', async ({ app, page }) => {
  const long = session({ id: '00000000-0000-4000-8000-0000000000e3', title: 'A very long session title that goes on and on about the OAuth scopes and the token refresh and the review' });
  await page.setViewportSize({ width: 800, height: 600 });
  await app.boot({ sessions: [long, two], openSessions: [long.id, two.id], history: { [long.id]: [], [two.id]: [] } });
  await closeFromMenu(page, long.title);
  for (const label of ['Undo', 'Finished', 'Set aside…']) {
    const box = await toastButton(page, label).boundingBox();
    const lineHeight = await toastButton(page, label).evaluate((el) => parseFloat(getComputedStyle(el).lineHeight) || 16);
    expect(box!.height).toBeLessThan(lineHeight * 2);
  }
  const toastBox = await page.locator('#toast').boundingBox();
  expect(toastBox!.x + toastBox!.width).toBeLessThanOrEqual(800);
});
