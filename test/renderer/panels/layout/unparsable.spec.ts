import { expect, test } from '../../support/harness';
import { CONFIG_ROOT } from '../../support/fixture';
import { LAYOUT, withLayout } from './layout';

// A layout file that does not parse (docs/architecture.md § The layout file): a toast names the file and what main said is wrong and where, until a read succeeds, and the window keeps what it last had.
const broken = { configRoot: CONFIG_ROOT, file: `${CONFIG_ROOT}/layouts/default.json`, status: 'unparsable' as const, error: 'expected a comma at line 3, column 3', json: null, types: [] };

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
