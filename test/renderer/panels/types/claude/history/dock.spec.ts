import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/config/defaults';
import type { Exchange, HistoryUi } from '../../../../../../src/shared/types';
import { session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { goLive } from '../../../../support/live';
import { historyAtTop, tab } from '../../../../support/window';

// Dock in the history's head puts it in a column beside the live terminal, kept for the window; claude keeps the keys, Close hides it, and Undock puts it back in the drawer.

const one = session();
const TIME = '2026-11-18T08:00:00.000Z';
/** Long enough that a few of them overflow the history, so it has somewhere to scroll. */
const reply = Array.from({ length: 30 }, (_, line) => `Line ${line + 1}`).join('\n\n');
const exchanges: Exchange[] = ['1', '2', '3', '4', '5'].map((id) => ({ id, time: TIME, request: `Request ${id}`, kind: 'typed', replaced: false, rewound: false, parts: [{ kind: 'text', id: `message-${id}`, time: TIME, text: reply }] }));

const column = (page: Page): Locator => page.locator('.history-dock');
const terminalKeys = (page: Page): Locator => page.locator('.term.active .xterm-helper-textarea');
const terminalWidth = async (page: Page): Promise<number> => (await page.locator('#terminals').boundingBox())!.width;
/** What the window last kept of the history. */
const keptHistory = async (app: App): Promise<HistoryUi | undefined> => (await app.saved())?.history;

/** A live tab on `one`, the window keeping the history as `history` says. */
async function bootLive(app: App, page: Page, history: Partial<HistoryUi> = {}): Promise<void> {
  await app.boot({ openSessions: [one.id], activeSession: one.id, history: { [one.id]: exchanges }, uiState: { ...defaultUi(), history: { ...defaultUi().history, ...history } } });
  await goLive(page, app, tab(page, one.title));
}

test('Dock puts the open history in a column beside the terminal, at the request it was at, and the window keeps it docked', async ({ app, page }) => {
  await bootLive(app, page);
  const width = await terminalWidth(page);
  await page.locator('.history-bar').click();
  await page.keyboard.press('Control+Shift+ArrowUp');
  const at = await historyAtTop(page);
  await page.locator('.history').getByRole('button', { name: 'Dock beside the session' }).click();
  await expect(column(page).locator('.history')).toBeVisible();
  await expect(page.locator('.drawer')).toBeHidden();
  expect(await terminalWidth(page)).toBeLessThan(width);
  expect(await historyAtTop(page)).toBe(at);
  await expect.poll(() => keptHistory(app)).toMatchObject({ docked: true });
});

test('docked, opening the history leaves the keys with claude, and Esc in the history does not close it', async ({ app, page }) => {
  await bootLive(app, page, { docked: true });
  await terminalKeys(page).focus();
  await page.locator('.history-bar').click();
  await expect(column(page).locator('.history')).toBeVisible();
  await expect(terminalKeys(page)).toBeFocused();
  await page.locator('.history-scroll').focus();
  await page.keyboard.press('Escape');
  await expect(column(page).locator('.history')).toBeVisible();
});

test('docked, Close hides the column, and the bar opens it docked again', async ({ app, page }) => {
  await bootLive(app, page, { docked: true });
  await page.locator('.history-bar').click();
  await column(page).getByRole('button', { name: 'Close' }).click();
  await expect(column(page)).toHaveCount(0);
  await page.locator('.history-bar').click();
  await expect(column(page).locator('.history')).toBeVisible();
});

test('docked, Ctrl+Shift+↓ past the last request leaves it open', async ({ app, page }) => {
  await bootLive(app, page, { docked: true });
  await page.keyboard.press('Control+Shift+ArrowUp');
  await expect(column(page).locator('.history')).toBeVisible();
  await page.keyboard.press('Control+Shift+ArrowDown');
  await page.keyboard.press('Control+Shift+ArrowDown');
  await expect(column(page).locator('.history')).toBeVisible();
});

test('Undock puts the history back in the drawer, open, and the window keeps it so', async ({ app, page }) => {
  await bootLive(app, page, { docked: true });
  await page.locator('.history-bar').click();
  await column(page).getByRole('button', { name: 'Undock' }).click();
  await expect(column(page)).toHaveCount(0);
  await expect(page.locator('.drawer .history')).toBeVisible();
  await expect.poll(() => keptHistory(app)).toMatchObject({ docked: false });
});

test('a drag of the divider sets the column’s width, and the window keeps it', async ({ app, page }) => {
  await bootLive(app, page, { docked: true });
  await page.locator('.history-bar').click();
  const before = (await column(page).boundingBox())!.width;
  const divider = (await page.locator('.history-dock-divider').boundingBox())!;
  await page.mouse.move(divider.x + 2, divider.y + 40);
  await page.mouse.down();
  await page.mouse.move(divider.x + 102, divider.y + 40, { steps: 4 });
  await page.mouse.up();
  const after = (await column(page).boundingBox())!.width;
  expect(after).toBeCloseTo(before - 100, -1);
  await expect.poll(async () => (await keptHistory(app))?.width).toBe(Math.round(after));
});

test('a tab with no claude running keeps its history over the pane with Dock on, offers no Dock, and Esc closes it', async ({ app, page }) => {
  await app.boot({ openSessions: [one.id], activeSession: one.id, history: { [one.id]: exchanges }, uiState: { ...defaultUi(), history: { docked: true, width: null } } });
  await page.getByRole('button', { name: 'Show history' }).click();
  await expect(page.locator('.drawer .history')).toHaveClass(/\bstandalone\b/);
  await expect(column(page)).toHaveCount(0);
  await expect(page.locator('.history-dock-button')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('.history')).toBeHidden();
});

test('in a pane narrower than its width, the docked column shrinks with the terminal, and the bar stays in the pane', async ({ app, page }) => {
  await page.setViewportSize({ width: 820, height: 700 });
  await bootLive(app, page, { docked: true });
  await page.locator('.history-bar').click();
  await expect(column(page).locator('.history')).toBeVisible();
  const pane = (await page.locator('#terminal-body').boundingBox())!;
  const bar = (await page.locator('.history-bar').boundingBox())!;
  expect(pane.width).toBeLessThan(560);
  expect(bar.x + bar.width).toBeLessThanOrEqual(pane.x + pane.width + 1);
});
