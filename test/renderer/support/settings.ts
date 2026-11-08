import type { Locator, Page } from '@playwright/test';
import { expect } from './harness';

/** Open Settings from the sidebar's header and hand back the dialog, once it is on show. */
export async function openSettings(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  return dialog;
}
