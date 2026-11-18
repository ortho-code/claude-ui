import type { Locator, Page } from '@playwright/test';
import { PROJECT, session } from '../support/fixture';
import { expect, test } from '../support/harness';
import { row } from '../support/window';

// A menu taller than the room the window has for it stops at the window's edge, and its items scroll inside it, so every one can be reached; a submenu too.
// A session's menu, and its Move to group with many groups, stand in for every menu and submenu, which share one builder (`openMenu`, `openSubmenu`).

/** Whether `box` lies inside the window, top to bottom. */
const insideWindow = async (page: Page, box: Locator): Promise<boolean> => {
  const rect = (await box.boundingBox())!;
  return rect.y >= 0 && rect.y + rect.height <= page.viewportSize()!.height;
};

test("a menu taller than the window stops at its edge, and its last item scrolls into reach", async ({ app, page }) => {
  const one = session();
  await page.setViewportSize({ width: 800, height: 260 });
  await app.boot({ sessions: [one] });
  await row(page, one.title).locator('.session-kebab').click();
  const menu = page.locator('.kebab-menu:not(.submenu)');
  expect(await insideWindow(page, menu)).toBe(true);
  const last = menu.locator('.menu-row').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport({ ratio: 1 });
});

test('a submenu taller than the window stops at its edge, and its last item scrolls into reach', async ({ app, page }) => {
  const one = session();
  const groups = Array.from({ length: 30 }, (_, i) => ({ id: `g-${i}`, name: `Group ${i}`, repoRoot: PROJECT }));
  await page.setViewportSize({ width: 800, height: 400 });
  await app.boot({ sessions: [one], groupState: { groups, groupOf: {} } });
  await row(page, one.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu:not(.submenu) .menu-row', { hasText: /^Move to group$/ }).hover();
  const submenu = page.locator('.kebab-menu.submenu');
  expect(await insideWindow(page, submenu)).toBe(true);
  const last = submenu.locator('.menu-row').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport({ ratio: 1 });
});
