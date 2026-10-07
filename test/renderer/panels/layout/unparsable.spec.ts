import { expect, test } from '../../support/harness';
import { CONFIG_ROOT, localLayoutWith, noLocalLayout } from '../../support/fixture';
import { keptChanges, LAYOUT, withLayout } from './layout';

// A layout file that does not parse (docs/architecture.md § The layout file): a toast names the file and what main said is wrong and where, until a read succeeds, and the window keeps what it last had.
const broken = { configRoot: CONFIG_ROOT, file: `${CONFIG_ROOT}/layouts/default.json`, status: 'unparsable' as const, error: 'expected a comma at line 3, column 3', json: null, types: [], local: noLocalLayout() };

test('a layout file that does not parse at start-up is toasted with where it goes wrong, over the default layout', async ({ app, page }) => {
  await app.boot({ layout: broken });
  await expect(page.locator('#toast-message')).toHaveText('default.json: expected a comma at line 3, column 3');
  await expect(page.locator('.panel-group')).toHaveCount(2);
});

test('a layout file broken while the app runs keeps the last good layout up, and the next good read takes the toast down', async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT));
  await expect(page.locator('.panel-group')).toHaveCount(4);
  await app.emit('onLayoutChanged', broken);
  await expect(page.locator('#toast-message')).toHaveText('default.json: expected a comma at line 3, column 3');
  await expect(page.locator('.panel-group')).toHaveCount(4);
  await app.emit('onLayoutChanged', withLayout(LAYOUT).layout);
  await expect(page.locator('#toast')).toBeHidden();
  await expect(page.locator('.panel-group')).toHaveCount(4);
});

test('the app’s file beside the layout not parsing is toasted, the window keeps what it has, and a person’s fix of it is taken in', async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT, { right: { folded: true } }));
  await expect(page.getByRole('button', { name: 'Unfold right' })).toBeVisible();
  const report = withLayout(LAYOUT).layout;
  await app.emit('onLayoutChanged', { ...report, local: { ...report.local, status: 'unparsable', error: 'expected a comma at line 2, column 5' } });
  await expect(page.locator('#toast-message')).toHaveText('default.local.json: expected a comma at line 2, column 5');
  await expect(page.getByRole('button', { name: 'Unfold right' })).toBeVisible();
  await app.emit('onLayoutChanged', { ...report, local: localLayoutWith({ drawer: { folded: true } }) });
  await expect(page.locator('#toast')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Fold right' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unfold drawer' })).toBeVisible();
  expect(await keptChanges(app)).toEqual([]);
});
