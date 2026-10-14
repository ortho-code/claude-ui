import type { Locator } from '@playwright/test';
import { HOME, session } from '../support/fixture';
import { expect, test } from '../support/harness';
import { rows, switcherEntries } from '../support/window';

// A popover's notch stands across its edge, so its inner half lies over the row beside that edge, the first one for a popover below its trigger (popover.css).
// Drawn over that row, it bit a notch-shaped piece out of the row's fill whenever the row had one: the switcher's entry on show, a hovered item, or any row scrolled up under it.
// The notch is a pseudo-element, which in Chromium hit-tests as the popover itself, so what the window finds on top at a point the two share says which of them paints there.
// The checks hold a popover below its trigger, the case the switcher and most menus are in; the rule they hold is one for every edge.

interface UnderNotch {
  /** The row's visible top edge lies within the notch's inward reach, at the notch's centre. */
  reaches: boolean;
  /** At that point, the row is what is on top. */
  onTop: boolean;
}

/** Whether `row` reaches under the notch on `popover`'s top edge, and whether the row rather than the notch is on top half a pixel inside the row's visible top edge, at the notch's centre. */
async function underNotch(popover: Locator, row: Locator): Promise<UnderNotch> {
  const handle = await popover.elementHandle();
  return row.evaluate((rowElement, popoverElement) => {
    const notch = getComputedStyle(popoverElement, '::before');
    const box = popoverElement.getBoundingClientRect();
    const inner = box.top + popoverElement.clientTop;
    const width = parseFloat(notch.width);
    const x = box.left + popoverElement.clientLeft + parseFloat(notch.left) + width / 2;
    // A square turned 45° reaches half its diagonal from its centre.
    const tip = inner + parseFloat(notch.top) + parseFloat(notch.height) / 2 + (width * Math.SQRT2) / 2;
    const y = Math.max(rowElement.getBoundingClientRect().top, inner) + 0.5;
    return { reaches: y < tip, onTop: rowElement.contains(document.elementFromPoint(x, y)) };
  }, handle);
}

test("the switcher's entry on show, first in its list, is drawn over the notch above it", async ({ app, page }) => {
  await app.boot({ activeProject: null });
  await page.locator('#switcher-current').click();
  const all = switcherEntries(page).first();
  await expect(all).toHaveClass(/\bactive\b/);
  expect(await underNotch(page.locator('#switcher-popover'), all)).toEqual({ reaches: true, onTop: true });
});

test('a switcher entry scrolled up under the notch is drawn over it', async ({ app, page }) => {
  const many = Array.from({ length: 20 }, (_, n) => {
    const root = `${HOME}/projects/p${String(n).padStart(2, '0')}`;
    return session({ id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`, title: `Session ${n}`, cwd: root, repoRoot: root });
  });
  await app.boot({ sessions: many, projectOrder: many.map((s) => s.repoRoot), activeProject: null });
  await page.locator('#switcher-current').click();
  await page.locator('#switcher-list').evaluate((list) => (list.scrollTop = 10));
  const first = switcherEntries(page).first();
  await first.hover();
  expect(await underNotch(page.locator('#switcher-popover'), first)).toEqual({ reaches: true, onTop: true });
});

test("a menu's hovered first item is drawn over the notch above it", async ({ app, page }) => {
  await app.boot();
  await rows(page).first().locator('.kebab').click();
  const menu = page.locator('.kebab-menu');
  await expect(menu).toHaveClass(/\battach-top\b/);
  const first = menu.locator('.menu-row').first();
  await first.hover();
  expect(await underNotch(menu, first)).toEqual({ reaches: true, onTop: true });
});
