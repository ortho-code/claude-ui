import type { Locator, Page } from '@playwright/test';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { row } from '../../../../support/window';

// The help beside the query field lists the syntax and every field with its values, from the fields the field reads, beside the session list; a value adds its term, and a link leads to the guide's page.
const card = '#query-help-card';

/** The row of a field, by its name. */
const field = (page: Page, name: string): Locator => page.locator(`${card} tr`, { has: page.locator('code', { hasText: new RegExp(`^${name.replace('.', '\\.')}:$`) }) });

async function openHelp(page: Page): Promise<void> {
  await page.locator('#filter-toggle').click();
  await page.locator('#query-help').click();
  await expect(page.locator(card)).toBeVisible();
}

test('the help button opens a card of the syntax and every field with its values, which Esc shuts', async ({ app, page }) => {
  await app.boot();
  await openHelp(page);
  await expect(page.locator('#query-help')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#query-help')).toHaveClass(/\bmenu-open\b/);
  await expect(page.locator(`${card} h3`)).toHaveText(['Syntax', 'Fields']);
  await expect(field(page, 'is').locator('.query-help-value')).toHaveText(['working', 'running', 'asking', 'unfinished', 'set-aside', 'pinned', 'worktree', 'gone', 'sibling', 'ready-to-finish']);
  await expect(field(page, 'needs').locator('.query-help-value').filter({ hasText: /^finish-up$/ })).toHaveCount(1);
  await expect(field(page, 'active').locator('.query-help-value')).toHaveText(['today', '>=today-7d', '<today-30d']);
  await expect(field(page, 'pr')).toContainText('or a number, owner/repo#12');
  await expect(field(page, 'project').locator('.query-help-value')).toHaveText(['current']);
  await expect(field(page, 'project')).toContainText('or text, as part of it');
  await expect(field(page, 'group')).toContainText('text, as part of it');

  await page.keyboard.press('Escape');
  await expect(page.locator(card)).toBeHidden();
  await expect(page.locator('#query-help')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#query-help')).not.toHaveClass(/\bmenu-open\b/);
});

test('the card fits its width: nothing scrolls sideways and no value breaks over two lines', async ({ app, page }) => {
  await app.boot();
  await openHelp(page);
  const body = page.locator(`${card} .side-popover-body`);
  expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const heights = await page.locator(`${card} .query-help-value`).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  expect(Math.max(...heights)).toBeLessThanOrEqual(Math.min(...heights));
});

test('the card opens beside the session list, not over it', async ({ app, page }) => {
  await app.boot();
  await openHelp(page);
  const list = await page.locator('#filter-panel').evaluate((el) => (el.closest('.panel-group') ?? el).getBoundingClientRect().right);
  const left = await page.locator(card).evaluate((el) => el.getBoundingClientRect().left);
  expect(left).toBeGreaterThanOrEqual(list);
});

test("a value pressed in the card adds its term to the query, as a pill's term", async ({ app, page }) => {
  await app.boot();
  await openHelp(page);
  await field(page, 'is').locator('.query-help-value', { hasText: /^pinned$/ }).click();
  await expect(page.locator('#search')).toHaveValue('is:pinned');
  await field(page, 'has').locator('.query-help-value', { hasText: /^pr$/ }).click();
  await expect(page.locator('#search')).toHaveValue('is:pinned has:pr');
  await expect(page.locator(card)).toBeVisible();
});

test("the card's guide link opens the guide's page on queries", async ({ app, page }) => {
  await app.boot();
  await openHelp(page);
  await page.locator(`${card} .query-help-guide`).click();
  await expect.poll(() => app.calls('openExternal')).toEqual([['https://github.com/ortho-code/claude-ui/blob/main/docs/guide/queries.md']]);
});

test('a press outside the card leaves it open, so the field can be typed in beside it, and its × shuts it', async ({ app, page }) => {
  await app.boot();
  await openHelp(page);
  await page.locator('#search').click();
  await page.keyboard.type('is:');
  await expect(page.locator(card)).toBeVisible();
  await page.locator(`${card} .side-popover-close`).click();
  await expect(page.locator(card)).toBeHidden();
  await expect(page.locator('#query-help')).toHaveAttribute('aria-expanded', 'false');
});

test('the help button shuts the card it opened', async ({ app, page }) => {
  await app.boot();
  await openHelp(page);
  await page.locator('#query-help').click();
  await expect(page.locator(card)).toBeHidden();
});

test('with the list filling the window, the card opens over the list at a width to read, since neither side has room', async ({ app, page }) => {
  await app.boot();
  await page.locator('#sidebar').getByRole('button', { name: 'Full screen' }).click();
  await openHelp(page);
  const list = await page.locator('#sidebar').evaluate((el) => {
    const box = el.getBoundingClientRect();
    return { left: box.left, right: box.right };
  });
  const box = await page.locator(card).evaluate((el) => {
    const at = el.getBoundingClientRect();
    return { left: at.left, right: at.right, width: at.width };
  });
  expect(box.width).toBeGreaterThanOrEqual(280);
  expect(box.left).toBeGreaterThanOrEqual(list.left);
  expect(box.right).toBeLessThanOrEqual(list.right);
});

test('Esc with the card open shuts the card and leaves selecting several as it was', async ({ app, page }) => {
  const one = session({ id: '00000000-0000-4000-8000-0000000000b1', title: 'One' });
  await app.boot({ sessions: [one], history: { [one.id]: [] } });
  await row(page, one.title).locator('.kebab').click();
  await page.locator('.kebab-menu button.menu-row', { hasText: /^Select…$/ }).click();
  await expect(page.locator('#bulk-line')).toBeVisible();
  await openHelp(page);
  // Focus on the help button, not in the field, so only the card stands between Esc and the list.
  await expect(page.locator('#query-help')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator(card)).toBeHidden();
  await expect(page.locator('#bulk-line')).toBeVisible();
});

test('a change of the window size keeps the card open, beside the list', async ({ app, page }) => {
  await app.boot();
  await openHelp(page);
  await page.setViewportSize({ width: 1100, height: 700 });
  await expect(page.locator(card)).toBeVisible();
  const list = await page.locator('#filter-panel').evaluate((el) => (el.closest('.panel-group') ?? el).getBoundingClientRect().right);
  expect(await page.locator(card).evaluate((el) => el.getBoundingClientRect().left)).toBeGreaterThanOrEqual(list);
});
