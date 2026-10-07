import { expect, test } from '../../support/harness';
import { keptChanges, LAYOUT, railItem, runs, withLayout } from './layout';

test('a chevron folds a group to its rail, and an icon there unfolds it on that panel; both are kept in the app’s file', async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT));
  const right = page.locator('.panel-group', { has: page.locator('.panel-rail') }).filter({ has: page.getByRole('button', { name: /^Checks/ }) });
  await expect(right.locator('.panel-content')).toBeVisible();

  await page.getByRole('button', { name: 'Fold right' }).click();
  await expect(right.locator('.panel-content')).toBeHidden();
  await expect.poll(() => keptChanges(app)).toEqual([{ id: 'right', field: 'folded', value: true }]);

  await railItem(page, /^Checks/).click();
  await expect(right.locator('.panel-content')).toBeVisible();
  await expect(railItem(page, /^Checks/)).toHaveClass(/\bshown\b/);
  // Unfolded is what the file says, so the app's fold is taken away rather than kept as false.
  await expect.poll(() => keptChanges(app)).toEqual([
    { id: 'right', field: 'folded', value: true },
    { id: 'right', field: 'active', value: 'checks' },
    { id: 'right', field: 'folded', value: null },
  ]);
});

test('a pick kept in the app’s file is shown at once in an open group', async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT, { right: { active: 'checks' } }));
  await expect(railItem(page, /^Checks/)).toHaveClass(/\bshown\b/);
  await expect.poll(() => runs(app, 'checks')).toHaveLength(1);
  expect(await runs(app, 'status')).toEqual([]);
});

test('a fold kept in the app’s file comes back folded, running nothing, and shows its kept pick once unfolded', async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT, { right: { active: 'checks', folded: true } }));
  await expect(page.getByRole('button', { name: 'Unfold right' })).toBeVisible();
  // The shell in the drawer starts, being on show; nothing behind the folded group does.
  await expect.poll(() => app.calls('startShell')).toHaveLength(1);
  expect(await runs(app, 'checks')).toEqual([]);
  await page.getByRole('button', { name: 'Unfold right' }).click();
  await expect(railItem(page, /^Checks/)).toHaveClass(/\bshown\b/);
  await expect.poll(() => runs(app, 'checks')).toHaveLength(1);
});

test('a folded group’s siblings fill the room it leaves, whatever their shares add up to', async ({ app, page }) => {
  // The terminal area's share and the drawer's add up to 1 until the drawer folds; then the terminal area's 0.7 is all that is left to grow.
  await app.boot(withLayout(LAYOUT, { claude: { size: 0.7 }, drawer: { folded: true } }));
  await expect(page.getByRole('button', { name: 'Unfold drawer' })).toBeVisible();
  const split = page.locator('.split.rows').first();
  const filled = await split.evaluate((box) => {
    const children = [...box.children] as HTMLElement[];
    return { box: box.getBoundingClientRect().height, children: children.reduce((sum, child) => sum + child.getBoundingClientRect().height, 0) };
  });
  expect(Math.abs(filled.box - filled.children)).toBeLessThan(1);
});

test('a group the layout file says is folded starts on its rail, and unfolding it is kept against the file', async ({ app, page }) => {
  const folded = structuredClone(LAYOUT);
  Object.assign(folded.root.columns[2], { folded: true });
  await app.boot(withLayout(folded));
  await expect(page.getByRole('button', { name: 'Unfold right' })).toBeVisible();
  await page.getByRole('button', { name: 'Unfold right' }).click();
  await expect(page.getByRole('button', { name: 'Fold right' })).toBeVisible();
  await expect.poll(() => keptChanges(app)).toEqual([{ id: 'right', field: 'folded', value: false }]);
});
