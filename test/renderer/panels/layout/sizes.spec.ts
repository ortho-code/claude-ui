import type { Page } from '@playwright/test';
import { expect, test } from '../../support/harness';
import { keptChanges, LAYOUT, withLayout } from './layout';

/** The sidebar's width on screen. */
const sidebarWidth = async (page: Page): Promise<number> => Math.round((await page.locator('#sidebar').boundingBox())!.width);

test("dragging a divider keeps the size it ends on in the app's file, and a double-click on it takes it away", async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT));
  // In document order the window split's own divider, between the sidebar and the middle column, comes first.
  const divider = page.locator('.divider.drag').first();
  const box = (await divider.boundingBox())!;
  // Well above the middle, where the sidebar's fold chevron sits on this divider: a press there is a click, not a drag.
  const from = { x: box.x + box.width / 2, y: box.y + 100 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y, { steps: 6 });
  await page.mouse.up();
  // A pixel node keeps pixels; the middle column, the one flexible child, takes what is left and is not written.
  await expect.poll(() => keptChanges(app)).toEqual([{ id: 'sidebar', field: 'size', value: '380px' }]);

  // Where the divider is now, having moved with the drag.
  const moved = (await divider.boundingBox())!;
  await page.mouse.dblclick(moved.x + moved.width / 2, from.y);
  await expect.poll(() => keptChanges(app)).toEqual([
    { id: 'sidebar', field: 'size', value: '380px' },
    { id: 'sidebar', field: 'size', value: null },
  ]);
});

test("a size kept in the app's file wins over the file's, and an edit of the file's size counts at once for a node it does not hold", async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT, { sidebar: { size: '280px' } }));
  await expect.poll(() => sidebarWidth(page)).toBe(280);
  const edited = structuredClone(LAYOUT);
  edited.root.columns[0].size = '300px';
  edited.root.columns[2].size = '400px';
  await app.emit('onLayoutChanged', withLayout(edited, { sidebar: { size: '280px' } }).layout);
  await expect.poll(async () => Math.round((await page.locator('.panel-group').filter({ has: page.getByRole('button', { name: /^Checks/ }) }).boundingBox())!.width)).toBe(400);
  expect(await sidebarWidth(page)).toBe(280);
});

test("a size the app's file keeps for a node the layout no longer has is dropped at the next change", async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT, { gone: { size: 0.4 } }));
  await page.getByRole('button', { name: 'Fold right' }).click();
  await expect.poll(() => keptChanges(app)).toEqual([
    { id: 'gone', field: 'size', value: null },
    { id: 'right', field: 'folded', value: true },
  ]);
});
