import { expect, test } from '../../support/harness';

test('without a layout file the window is the default layout: the sidebar and the terminal area, and nothing runs', async ({ app, page }) => {
  await app.boot();
  await expect(page.locator('.panel-group')).toHaveCount(2);
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('#terminal-pane')).toBeVisible();
  await expect(page.locator('.panel-rail')).toHaveCount(0);
  expect(await app.calls('runPanel')).toEqual([]);
  expect(await app.calls('startShell')).toEqual([]);
});
