import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/harness';
import { settingsFileWith } from '../support/fixture';
import { openSettings } from '../support/settings';

// What a tab's button does, in Settings: a dropdown of the choices in words, saved into settings.json, as the other choices are.
interface Leave {
  dialog: Locator;
  choice: Locator;
  save: Locator;
}

const open = async (page: Page): Promise<Leave> => {
  const dialog = await openSettings(page);
  await dialog.getByRole('tab', { name: 'Sessions' }).click();
  return {
    dialog,
    choice: dialog.getByRole('combobox', { name: 'Leave button' }),
    save: dialog.getByRole('button', { name: 'Save' }),
  };
};

test('the dropdown offers the five choices in words, in their order', async ({ app, page }) => {
  await app.boot();
  const settings = await open(page);
  await expect(settings.choice.locator('option')).toHaveText(['Stop, then close the tab', 'Stop, then mark the session finished', 'Close the tab', 'Mark the session finished', 'No button, only the menu']);
});

test('the button stops and then closes until another choice is saved into settings.json', async ({ app, page }) => {
  await app.boot();
  let settings = await open(page);
  await expect(settings.choice).toHaveValue('stop-close');

  await settings.choice.selectOption('finish');
  await settings.save.click();
  await expect(settings.dialog).toBeHidden();
  expect(await page.evaluate(() => window.__claudeUiFixture.settings.json)).toEqual({ leaveButton: 'finish' });

  settings = await open(page);
  await expect(settings.choice).toHaveValue('finish');
});

test('a choice in settings.json shows in the dropdown', async ({ app, page }) => {
  await app.boot({ settings: settingsFileWith('settings.json', { leaveButton: 'none' }) });
  const settings = await open(page);
  await expect(settings.choice).toHaveValue('none');
});
