import type { Page } from '@playwright/test';
import { session } from '../../../../support/fixture';
import { expect, test, type App } from '../../../../support/harness';
import { row, rows } from '../../../../support/window';

// The list's order follows the sessions' last activity, which on its own draws the list again nowhere (`AFFECTS_ROW`), so it catches up once a minute, and never while the pointer is over the list, the focus is in it or a menu from it is up (docs/architecture.md § UI conventions).
const MINUTE = 60_000;
const START = Date.parse('2026-09-30T09:00:00.000Z');
const at = (ms: number): string => new Date(ms).toISOString();
const older = session({ id: '00000000-0000-4000-8000-000000000001', title: 'Older work', lastActivity: at(START - 10 * MINUTE) });
const newer = session({ id: '00000000-0000-4000-8000-000000000002', title: 'Newer work', lastActivity: at(START - 5 * MINUTE) });

/** The titles of the rows, in the order drawn. */
const order = (page: Page): Promise<string[]> => rows(page).locator('.card-title').allTextContents();

/** Boot with `newer` above `older`, then write a message to `older` now: the listing moves, the list is told nothing. */
async function olderWorkedOn(app: App, page: Page): Promise<void> {
  await page.clock.install({ time: START });
  await app.boot({ sessions: [newer, older] });
  await expect.poll(() => order(page)).toEqual([newer.title, older.title]);
  await app.listOnDisk([{ ...older, lastActivity: at(START) }, newer]);
}

/** Put the pointer somewhere outside the list. */
async function pointerAway(page: Page): Promise<void> {
  await page.mouse.move(page.viewportSize()!.width - 5, 5);
}

test('a session worked on rises to its place within a minute, with nothing else moving', async ({ app, page }) => {
  await olderWorkedOn(app, page);
  await pointerAway(page);
  await page.clock.fastForward(MINUTE);
  await expect.poll(() => order(page)).toEqual([older.title, newer.title]);
});

test('the order holds while the pointer is over the list, and catches up at the first minute after it leaves', async ({ app, page }) => {
  await olderWorkedOn(app, page);
  await row(page, newer.title).hover();
  await page.clock.fastForward(2 * MINUTE);
  expect(await order(page)).toEqual([newer.title, older.title]);

  await pointerAway(page);
  await page.clock.fastForward(MINUTE);
  await expect.poll(() => order(page)).toEqual([older.title, newer.title]);
});

test('an open review takes in a session that crosses its 30 days, within a minute', async ({ app, page }) => {
  const DAY = 24 * 60 * MINUTE;
  const long = session({ id: '00000000-0000-4000-8000-000000000003', title: 'Long untouched', lastActivity: at(START - 40 * DAY) });
  const nearly = session({ id: '00000000-0000-4000-8000-000000000004', title: 'Nearly untouched', lastActivity: at(START - 30 * DAY + MINUTE) });
  await page.clock.install({ time: START });
  await app.boot({ sessions: [nearly, long] });
  await page.locator('#review-button').click();
  await expect.poll(() => order(page)).toEqual([long.title]);

  await pointerAway(page);
  await page.clock.fastForward(2 * MINUTE);
  await expect.poll(() => order(page)).toEqual([long.title, nearly.title]);
});

test("the order holds while a row's menu is up", async ({ app, page }) => {
  await olderWorkedOn(app, page);
  await row(page, newer.title).locator('.kebab').click();
  await expect(page.locator('.kebab-menu')).toBeVisible();
  // Neither the pointer nor the focus in the list, so only the menu holds it.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await pointerAway(page);
  await expect(page.locator('.kebab-menu')).toBeVisible();
  await page.clock.fastForward(2 * MINUTE);
  expect(await order(page)).toEqual([newer.title, older.title]);

  // Closed by its kebab, the pointer and the focus taken out of the list again, the order catches up at the next tick: the menu was what held it.
  await row(page, newer.title).locator('.kebab').click();
  await expect(page.locator('.kebab-menu')).toBeHidden();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await pointerAway(page);
  await page.clock.fastForward(MINUTE);
  await expect.poll(() => order(page)).toEqual([older.title, newer.title]);
});
