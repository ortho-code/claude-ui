import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../../support/harness';
import { token } from '../../../support/looks';
import { keptChanges, runs } from '../../layout/layout';
import { bootList, layoutWith, print, type PrintedList } from './list';

// A list that offers views gets a switch between them in its panel's header (docs/panel-types.md § A view): the view on show is marked, a pick is kept for the panel as a group's picked panel is, and the script runs again with it as CLAUDE_UI_VIEW.

const VIEWS = [
  { id: 'flat', label: 'Flat', icon: 'list' },
  { id: 'tree', label: 'As a tree', icon: 'tree' },
];
const listed = (views: unknown[]): PrintedList => ({ version: 1, views, sections: [{ items: [{ key: 'a', text: 'a.txt' }] }] });

const buttons = (page: Page): Locator => page.locator('.panel-header .panel-view');

test('a list offering views shows a switch between them in its header, its first marked as on show', async ({ app, page }) => {
  await bootList(app, page, listed(VIEWS));
  await expect(buttons(page)).toHaveCount(2);
  await expect(buttons(page).nth(0)).toHaveAttribute('aria-label', 'Flat');
  await expect(buttons(page).nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(buttons(page).nth(1)).toHaveAttribute('aria-pressed', 'false');
});

test('a list offering one view shows no switch', async ({ app, page }) => {
  await bootList(app, page, listed(VIEWS.slice(0, 1)));
  await expect(page.locator('.panel-header .panel-views')).toBeHidden();
  await expect(buttons(page)).toHaveCount(0);
});

test('the view on show takes neither a pointer nor the hover, since a press on it does nothing', async ({ app, page }) => {
  await bootList(app, page, listed(VIEWS));
  const shown = buttons(page).nth(0);
  await shown.hover();
  expect(await shown.evaluate((el) => getComputedStyle(el).cursor)).toBe('default');
  expect(await shown.evaluate((el) => getComputedStyle(el).color)).toBe(await token(page, '--text'));
});

test("an edit of the entry's view while the app runs is what the next run asks for, without the panel starting afresh", async ({ app, page }) => {
  await bootList(app, page, listed(VIEWS), { entry: { view: 'flat' } });
  await app.emit('onLayoutChanged', layoutWith({ view: 'tree' }).layout);
  await page.locator('.panel-header .icon-btn').last().click();
  await expect.poll(() => runs(app, 'changes')).toHaveLength(2);
  expect((await runs(app, 'changes'))[1].view).toBe('tree');
  await print(app, 1, listed(VIEWS));
  await expect(buttons(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
  // A pick is weighed against the entry as it is now: flat differs from its tree, so it is kept, where against the entry as mounted it would not have been.
  await buttons(page).nth(0).click();
  await expect.poll(async () => (await keptChanges(app)).at(-1)).toEqual({ id: 'changes', field: 'view', value: 'flat' });
});

test("an entry's view the list does not offer is named under the panel, and the list's first is shown", async ({ app, page }) => {
  await bootList(app, page, listed(VIEWS), { entry: { view: 'tre' } });
  await expect(page.locator('.panel-note:not(.list-failed)')).toContainText('view "tre" on changes is not one of the views its list offers (flat, tree); its first is shown until another is picked.');
  await expect(buttons(page).nth(0)).toHaveAttribute('aria-pressed', 'true');
});

test('a pick is kept for the panel and runs the script again with it, and picking the first back takes it away', async ({ app, page }) => {
  await bootList(app, page, listed(VIEWS));
  expect((await runs(app, 'changes'))[0].view).toBe('');
  await buttons(page).nth(1).click();
  await expect(buttons(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => keptChanges(app)).toContainEqual({ id: 'changes', field: 'view', value: 'tree' });
  await expect.poll(() => runs(app, 'changes')).toHaveLength(2);
  expect((await runs(app, 'changes'))[1].view).toBe('tree');

  await print(app, 1, listed(VIEWS));
  await buttons(page).nth(0).click();
  await expect.poll(async () => (await keptChanges(app)).at(-1)).toEqual({ id: 'changes', field: 'view', value: null });
  await expect.poll(() => runs(app, 'changes')).toHaveLength(3);
  expect((await runs(app, 'changes'))[2].view).toBe('flat');
});

test("the view kept on this machine is what the first run asks for, over the entry's own", async ({ app, page }) => {
  await bootList(app, page, listed(VIEWS), { entry: { view: 'flat' }, nodes: { changes: { view: 'tree' } } });
  expect((await runs(app, 'changes'))[0].view).toBe('tree');
  await expect(buttons(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
});

test("an entry's view is what the panel starts on, and a pick of another is kept over it", async ({ app, page }) => {
  await bootList(app, page, listed(VIEWS), { entry: { view: 'tree' } });
  expect((await runs(app, 'changes'))[0].view).toBe('tree');
  await expect(buttons(page).nth(1)).toHaveAttribute('aria-pressed', 'true');
  await buttons(page).nth(0).click();
  await expect.poll(() => keptChanges(app)).toContainEqual({ id: 'changes', field: 'view', value: 'flat' });
});

test('a kept view the list no longer offers gives way to its first, in the switch and to the script', async ({ app, page }) => {
  await bootList(app, page, listed(VIEWS), { nodes: { changes: { view: 'gone' } } });
  // Before any list has said what it offers, the pick is given as it is.
  expect((await runs(app, 'changes'))[0].view).toBe('gone');
  await expect(buttons(page).nth(0)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.panel-header .icon-btn').last().click();
  await expect.poll(() => runs(app, 'changes')).toHaveLength(2);
  expect((await runs(app, 'changes'))[1].view).toBe('flat');
});

test('a list offering no views shows no switch, and is run with none once it has printed', async ({ app, page }) => {
  await bootList(app, page, listed([]), { entry: { view: 'tree' } });
  await expect(buttons(page)).toHaveCount(0);
  expect((await runs(app, 'changes'))[0].view).toBe('tree');
  await page.locator('.panel-header .icon-btn').last().click();
  await expect.poll(() => runs(app, 'changes')).toHaveLength(2);
  expect((await runs(app, 'changes'))[1].view).toBe('');
});
