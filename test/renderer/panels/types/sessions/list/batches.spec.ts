import type { Page } from '@playwright/test';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { projectHeading, row, rows, titles } from '../../../../support/window';

// A key that brings many rows back puts them on the page a batch a frame, from the top: the first rows with the key, the rest after it, and a newer key drops what an older one left.
const nth = (i: number): ReturnType<typeof session> => session({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, title: `Row ${String(i).padStart(3, '0')}` });
const top = nth(0);
const many = [top, ...Array.from({ length: 199 }, (_, i) => nth(i + 1))];

/** Type `text` into the search as one key, and answer the list's first row and how many rows it has before anything else runs. */
const typeNow = (page: Page, text: string): Promise<{ first: string | null; count: number }> =>
  page.evaluate((value) => {
    const input = document.getElementById('search') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    const drawn = document.querySelectorAll('#sessions .session .card-title');
    return { first: drawn.length > 0 ? drawn[0].textContent : null, count: drawn.length };
  }, text);

test("rows a key brings back all reach the page, in the list's order, the first of them with the key itself", async ({ app, page }) => {
  await app.boot({ sessions: many });
  await expect(rows(page)).toHaveCount(many.length);
  const order = await titles(page).allTextContents();
  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill('no such session');
  await expect(rows(page)).toHaveCount(0);

  const now = await typeNow(page, '');
  expect(now.first).toBe(order[0]);
  await expect(rows(page)).toHaveCount(many.length);
  expect(await titles(page).allTextContents()).toEqual(order);
});

test("in bulk mode, each batch of rows comes back with its boxes saying what is ticked now, not what was when it left", async ({ app, page }) => {
  await app.boot({ sessions: many });
  // Every row ticked, then bulk mode ended, so each row leaves the list still drawn as ticked.
  await projectHeading(page, 'demo').locator('.project-kebab').click();
  await page.locator('.kebab-menu:not(.submenu) button.menu-row', { hasText: /^Select sessions…$/ }).click();
  await expect(page.locator('#sessions .session > .tick.on')).toHaveCount(many.length);
  await page.locator('#bulk-done').click();
  await page.locator('#filter-toggle').click();
  // Quoted, since "000" alone is in every row's id.
  await page.locator('#search').fill(`"${top.title}"`);
  await expect(rows(page)).toHaveCount(1);
  // Bulk mode again, with only the row on show ticked.
  await row(page, top.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button.menu-row', { hasText: /^Select…$/ }).click();

  await page.locator('#search').fill('');
  await expect(rows(page)).toHaveCount(many.length);
  await expect(page.locator('#sessions .session > .tick.on')).toHaveCount(1);
});

test('a key typed while rows are still going on the page drops the ones an earlier key left', async ({ app, page }) => {
  await app.boot({ sessions: many });
  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill('no such session');
  await expect(rows(page)).toHaveCount(0);

  await typeNow(page, '');
  // Row 000 to Row 009: ten rows, all of which the first batch already drew; quoted, since "00" alone is in every row's id.
  await typeNow(page, '"Row 00"');
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done))))));
  await expect(rows(page)).toHaveCount(10);
});
