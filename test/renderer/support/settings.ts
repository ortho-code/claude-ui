import type { Locator, Page } from '@playwright/test';
import { expect } from './harness';

/** Open Settings from the sidebar's header on the section named `section`, and hand back the dialog once that section is on show. */
export async function openSettings(page: Page, section = 'General'): Promise<Locator> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: section, exact: true }).click();
  await expect(dialog.getByRole('tabpanel', { name: section, exact: true })).toBeVisible();
  return dialog;
}
