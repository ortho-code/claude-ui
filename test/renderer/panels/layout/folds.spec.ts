import { expect, test } from '../../support/harness';
import { LAYOUT, railItem, runs, savedPanels, withLayout, withState } from './layout';

test('a chevron folds a group to its rail, and an icon there unfolds it on that panel; both are kept', async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT));
  const right = page.locator('.panel-group', { has: page.locator('.panel-rail') }).filter({ has: page.getByRole('button', { name: /^Checks/ }) });
  await expect(right.locator('.panel-content')).toBeVisible();

  await page.getByRole('button', { name: 'Fold right' }).click();
  await expect(right.locator('.panel-content')).toBeHidden();
  await expect.poll(async () => (await savedPanels(app))?.collapsed).toEqual(['right']);

  await railItem(page, /^Checks/).click();
  await expect(right.locator('.panel-content')).toBeVisible();
  await expect(railItem(page, /^Checks/)).toHaveClass(/\bshown\b/);
  await expect.poll(async () => savedPanels(app)).toMatchObject({ collapsed: [], active: { right: 'checks' } });
});

test('a stored pick is shown at once in an open group', async ({ app, page }) => {
  await app.boot({ ...withLayout(LAYOUT), ...withState({ active: { right: 'checks' } }) });
  await expect(railItem(page, /^Checks/)).toHaveClass(/\bshown\b/);
  await expect.poll(() => runs(app, 'checks')).toHaveLength(1);
  expect(await runs(app, 'status')).toEqual([]);
});

test('a stored fold comes back folded, running nothing, and shows its stored pick once unfolded', async ({ app, page }) => {
  await app.boot({ ...withLayout(LAYOUT), ...withState({ active: { right: 'checks' }, collapsed: ['right'] }) });
  await expect(page.getByRole('button', { name: 'Unfold right' })).toBeVisible();
  // The shell in the drawer starts, being on show; nothing behind the folded group does.
  await expect.poll(() => app.calls('startShell')).toHaveLength(1);
  expect(await runs(app, 'checks')).toEqual([]);
  await page.getByRole('button', { name: 'Unfold right' }).click();
  await expect(railItem(page, /^Checks/)).toHaveClass(/\bshown\b/);
  await expect.poll(() => runs(app, 'checks')).toHaveLength(1);
});
