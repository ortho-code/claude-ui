import { expect, test } from '../../../support/harness';
import { LAYOUT, withLayout } from '../../layout/layout';

test('the default layout’s Editor takes no room, draws no divider and says nothing while nothing is open in it', async ({ app, page }) => {
  await app.boot();
  await expect(page.locator('#terminal-pane')).toBeVisible();
  await expect(page.locator('.editor-panel')).toHaveCount(0);
  await expect(page.locator('.divider')).toHaveCount(1);
  await expect(page.locator('.panel-note')).toHaveCount(0);
});

test('a layout file without the Editor gets one, which takes no room and draws no divider while nothing is open in it', async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT));
  await expect(page.locator('#terminal-pane')).toBeVisible();
  await expect(page.locator('.editor-panel')).toHaveCount(0);
  // The three the file draws: sidebar and main, main and right, and the terminal over the drawer.
  await expect(page.locator('.divider')).toHaveCount(3);
  await expect(page.locator('.panel-note')).toHaveCount(0);
});
