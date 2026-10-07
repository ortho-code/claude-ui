import type { Locator, Page } from '@playwright/test';

/**
 * Press `target` with the mouse and release it with `between` happening while the button is down, as a status, a model switch or a new listing arriving mid-click does.
 * A click is a press and a release on the same element, so a surface drawn again between the two produces none unless it kept the element where it was (`src/renderer/keyed.ts`).
 */
export async function clickAcross(page: Page, target: Locator, between: () => Promise<unknown>): Promise<void> {
  await target.hover();
  await page.mouse.down();
  await between();
  await page.mouse.up();
}
