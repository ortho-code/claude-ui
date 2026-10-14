import type { Locator } from '@playwright/test';
import { expect, test } from '../../../support/harness';
import { bootList } from './list';

// What a list section's heading shows of what the script printed.

test("a section's heading shows the section's tooltip, and a heading without one shows none", async ({ app, page }) => {
  await bootList(app, page, {
    version: 1,
    sections: [
      { title: 'scienta', tooltip: '~/development/scienta', items: [{ key: 'a', text: 'main' }] },
      { title: 'Clean', items: [{ key: 'b', text: 'tennis-calculator' }] },
    ],
  });
  const heading = (title: string): Locator => page.locator('.list-section .section-heading', { hasText: title });
  await heading('scienta').locator('.label').hover();
  await expect(page.locator('#tooltip')).toHaveText('~/development/scienta');
  await page.mouse.move(0, 0);
  await expect(page.locator('#tooltip')).toBeHidden();
  await expect(heading('Clean')).not.toHaveAttribute('data-tooltip');
});
