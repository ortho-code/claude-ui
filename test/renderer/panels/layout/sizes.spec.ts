import { expect, test } from '../../support/harness';
import { LAYOUT, savedPanels, withLayout } from './layout';

test("dragging a divider keeps the split's sizes, and a double-click on it goes back to the file's", async ({ app, page }) => {
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
  // Parenthesised so the chain stops there: a split nobody has dragged has no entry at all, which the index type does not say.
  await expect.poll(async () => Math.round(((await savedPanels(app))?.sizes.window)?.sidebar ?? 0)).toBe(380);

  // Where the divider is now, having moved with the drag.
  const moved = (await divider.boundingBox())!;
  await page.mouse.dblclick(moved.x + moved.width / 2, from.y);
  await expect.poll(async () => (await savedPanels(app))?.sizes.window).toBeUndefined();
});
