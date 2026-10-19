import { session } from '../support/fixture';
import { expect, test } from '../support/harness';
import { row } from '../support/window';

// A long line in a menu's header (MenuItem.header) widens its menu only to every popover's 300px; a line cut short carries its whole text as its tooltip, and a line that fits carries none.
// A session's menu stands in for every menu with a header.

test("a long line in a menu's header stops at the menu's 300px and its whole text is its tooltip", async ({ app, page }) => {
  const long = session({ title: 'A session whose title runs on far past anything a menu could show on one line' });
  await app.boot({ sessions: [long] });
  await row(page, long.title).locator('.session-kebab').click();
  expect(Math.round((await page.locator('.kebab-menu').boundingBox())!.width)).toBe(300);
  const header = page.locator('.kebab-menu .menu-header');
  const [title, ...rest] = await header.locator('.menu-header-line').all();
  await expect(title).toHaveAttribute('data-tooltip', long.title);
  for (const line of rest) await expect(line).not.toHaveAttribute('data-tooltip');
});
