import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/config/defaults';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { row } from '../../../../support/window';

// The filters open beside the session list from the button at the query field's end, and close only by that button, their × or Esc; folded at their foot, the query's help lists the syntax and every field with its values, from the fields the field reads, a value adding its term, and a link leading to the guide's page.
const card = '#filters-card';
const help = `${card} #query-help`;

/** The row of a field, by its name. */
const field = (page: Page, name: string): Locator => page.locator(`${help} tr`, { has: page.locator('code', { hasText: new RegExp(`^${name.replace('.', '\\.')}:$`) }) });

async function openFilters(page: Page): Promise<void> {
  await page.locator('#filter-toggle').click();
  await expect(page.locator(card)).toBeVisible();
}

async function openHelp(page: Page): Promise<void> {
  await openFilters(page);
  await page.locator(`${help} > summary`).click();
  await expect(page.locator(`${help} h3`).first()).toBeVisible();
}

/** The right edge of the panel group the session list is in. */
const listRight = (page: Page): Promise<number> => page.locator('#sidebar').evaluate((el) => (el.closest('.panel-group') ?? el).getBoundingClientRect().right);

test('the help starts folded at the foot of the filters, and unfolds to the syntax and every field with its values', async ({ app, page }) => {
  await app.boot();
  await openFilters(page);
  await expect(page.locator(`${help} > summary`)).toHaveText('Every field and the syntax');
  await expect(page.locator(help)).not.toHaveAttribute('open');
  await page.locator(`${help} > summary`).click();
  await expect(page.locator(`${help} h3`)).toHaveText(['Syntax', 'Fields']);
  await expect(field(page, 'is').locator('.query-help-value')).toHaveText(['working', 'running', 'asking', 'unfinished', 'set-aside', 'pinned', 'worktree', 'gone', 'sibling', 'ready-to-finish']);
  await expect(field(page, 'needs').locator('.query-help-value').filter({ hasText: /^finish-up$/ })).toHaveCount(1);
  await expect(field(page, 'active').locator('.query-help-value')).toHaveText(['today', '>=today-7d', '<today-30d']);
  await expect(field(page, 'pr')).toContainText('or a number, owner/repo#12');
  await expect(field(page, 'project').locator('.query-help-value')).toHaveText(['current']);
  await expect(field(page, 'project')).toContainText('or text, as part of it');
  await expect(field(page, 'group')).toContainText('text, as part of it');
});

test('the help left unfolded is saved as unfolded', async ({ app, page }) => {
  await app.boot();
  await openHelp(page);
  await expect.poll(async () => (await app.saved())?.queryHelpOpen).toBe(true);
});

test('a launch with the help stored unfolded opens the filters with it unfolded', async ({ app, page }) => {
  await app.boot({ uiState: { ...defaultUi(), queryHelpOpen: true } });
  await openFilters(page);
  await expect(page.locator(help)).toHaveAttribute('open');
});

test('the filters fit their width: nothing scrolls sideways and no value breaks over two lines', async ({ app, page }) => {
  await app.boot();
  await openHelp(page);
  const body = page.locator(`${card} .side-popover-body`);
  expect(await body.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const heights = await page.locator(`${help} .query-help-value`).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  expect(Math.max(...heights)).toBeLessThanOrEqual(Math.min(...heights));
});

test("a value pressed in the help adds its term to the query, as a pill's term", async ({ app, page }) => {
  await app.boot();
  await openHelp(page);
  await field(page, 'is').locator('.query-help-value', { hasText: /^pinned$/ }).click();
  await expect(page.locator('#search')).toHaveValue('is:pinned');
  await field(page, 'has').locator('.query-help-value', { hasText: /^pr$/ }).click();
  await expect(page.locator('#search')).toHaveValue('is:pinned has:pr');
  await expect(page.locator(card)).toBeVisible();
});

test("the help's guide link opens the guide's page on queries", async ({ app, page }) => {
  await app.boot();
  await openHelp(page);
  await page.locator(`${help} .query-help-guide`).click();
  await expect.poll(() => app.calls('openExternal')).toEqual([['https://github.com/ortho-code/claude-ui/blob/main/docs/guide/queries.md']]);
});

test('Esc shuts the filters, and the button shows them open until then', async ({ app, page }) => {
  await app.boot();
  await openFilters(page);
  await expect(page.locator('#filter-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#filter-toggle')).toHaveClass(/\bmenu-open\b/);
  await page.keyboard.press('Escape');
  await expect(page.locator(card)).toBeHidden();
  await expect(page.locator('#filter-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#filter-toggle')).not.toHaveClass(/\bmenu-open\b/);
});

test('a press outside the filters leaves them open, so the field can be typed in beside them, and their × shuts them', async ({ app, page }) => {
  await app.boot();
  await openFilters(page);
  await page.locator('#search').click();
  await page.keyboard.type('is:');
  await expect(page.locator(card)).toBeVisible();
  await page.locator(`${card} .side-popover-close`).click();
  await expect(page.locator(card)).toBeHidden();
  await expect(page.locator('#filter-toggle')).toHaveAttribute('aria-expanded', 'false');
});

test('the filter button shuts the filters it opened', async ({ app, page }) => {
  await app.boot();
  await openFilters(page);
  await page.locator('#filter-toggle').click();
  await expect(page.locator(card)).toBeHidden();
});

test('with the list filling the window, the filters open over the list at a width to read, since neither side has room', async ({ app, page }) => {
  await app.boot();
  await page.locator('#sidebar').getByRole('button', { name: 'Full screen' }).click();
  await openFilters(page);
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

test('Esc with the filters open shuts them and leaves selecting several as it was', async ({ app, page }) => {
  const one = session({ id: '00000000-0000-4000-8000-0000000000b1', title: 'One' });
  await app.boot({ sessions: [one], history: { [one.id]: [] } });
  await row(page, one.title).locator('.kebab').click();
  await page.locator('.kebab-menu button.menu-row', { hasText: /^Select…$/ }).click();
  await expect(page.locator('#bulk-line')).toBeVisible();
  await openFilters(page);
  // Focus on the filter button, not in the field, so only the filters stand between Esc and the list.
  await expect(page.locator('#filter-toggle')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator(card)).toBeHidden();
  await expect(page.locator('#bulk-line')).toBeVisible();
});

test('opening the review shuts the filters, as it sets the filter aside', async ({ app, page }) => {
  const old = session({ id: '00000000-0000-4000-8000-0000000000b2', title: 'Old', lastActivity: '2020-01-01T00:00:00.000Z' });
  await app.boot({ sessions: [old] });
  await openFilters(page);
  await page.locator('#review-button').click();
  await expect(page.locator('#bulk-line')).toContainText('Review');
  await expect(page.locator(card)).toBeHidden();
});

test('a change of the window size keeps the filters open, beside the list', async ({ app, page }) => {
  await app.boot();
  await openFilters(page);
  await page.setViewportSize({ width: 1100, height: 700 });
  await expect(page.locator(card)).toBeVisible();
  expect(await page.locator(card).evaluate((el) => el.getBoundingClientRect().left)).toBeGreaterThanOrEqual(await listRight(page));
});
