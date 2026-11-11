import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/harness';
import { settingsFileWith } from '../support/fixture';
import { openSettings } from '../support/settings';

// What Undo does with a tab whose claude was running, in Settings: a dropdown of the choices in words, saved into settings.json, as the other choices are.
interface UndoChoice {
  dialog: Locator;
  choice: Locator;
  save: Locator;
}

const open = async (page: Page): Promise<UndoChoice> => {
  const dialog = await openSettings(page);
  await dialog.getByRole('tab', { name: 'Sessions' }).click();
  return {
    dialog,
    choice: dialog.getByRole('combobox', { name: 'When Undo brings back a tab whose claude was running' }),
    save: dialog.getByRole('button', { name: 'Save' }),
  };
};

test('the dropdown offers the two choices in words, starting claude again first', async ({ app, page }) => {
  await app.boot();
  const settings = await open(page);
  await expect(settings.choice.locator('option')).toHaveText(['Start claude again', 'Bring the tab back without starting it']);
  await expect(settings.choice).toHaveValue('start');
});

test('a choice saved goes into settings.json and shows when Settings opens again', async ({ app, page }) => {
  await app.boot();
  let settings = await open(page);
  await settings.choice.selectOption('cold');
  await settings.save.click();
  await expect(settings.dialog).toBeHidden();
  expect(await page.evaluate(() => window.__claudeUiFixture.settings.json)).toEqual({ undoRunning: 'cold' });

  settings = await open(page);
  await expect(settings.choice).toHaveValue('cold');
});

test('a choice in settings.json shows in the dropdown', async ({ app, page }) => {
  await app.boot({ settings: settingsFileWith('settings.json', { undoRunning: 'cold' }) });
  const settings = await open(page);
  await expect(settings.choice).toHaveValue('cold');
});
