import type { Locator, Page } from '@playwright/test';
import type { SettingsFileRead } from '../../../src/shared/settings';
import { expect, test } from '../support/harness';
import { settingsFileWith } from '../support/fixture';

// What a launch does with the sessions that were running when the app closed, in Settings: a dropdown, paused unless chosen otherwise, saved into settings.json, as the flags are.
const file = (json: unknown): SettingsFileRead => settingsFileWith('settings.json', json);

interface Running {
  dialog: Locator;
  choice: Locator;
  save: Locator;
}

const open = async (page: Page): Promise<Running> => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  return {
    dialog,
    choice: dialog.getByRole('combobox', { name: 'Sessions running when the app closed' }),
    save: dialog.getByRole('button', { name: 'Save' }),
  };
};

test('the dropdown offers the three choices in words, in their order', async ({ app, page }) => {
  await app.boot();
  const settings = await open(page);
  await expect(settings.choice.locator('option')).toHaveText(['Start them again', 'Keep them paused in the live strip', 'Leave them with the other tabs']);
});

test('the sessions running at quit come back paused until another choice is saved into settings.json', async ({ app, page }) => {
  await app.boot();
  let settings = await open(page);
  await expect(settings.choice).toHaveValue('pause');

  await settings.choice.selectOption('start');
  await settings.save.click();
  await expect(settings.dialog).toBeHidden();
  expect(await app.calls('setSettings')).toEqual([[{ launchFlags: '', runningSessionsAtLaunch: 'start', prStatus: true }]]);
  expect(await page.evaluate(() => window.__claudeUiFixture.settings.json)).toEqual({ runningSessionsAtLaunch: 'start' });

  settings = await open(page);
  await expect(settings.choice).toHaveValue('start');
});

test('a choice in settings.json shows in the dropdown', async ({ app, page }) => {
  await app.boot({ settings: file({ runningSessionsAtLaunch: 'leave' }) });
  const settings = await open(page);
  await expect(settings.choice).toHaveValue('leave');
});

test('a value the file gives that is no choice is named under it, and the default stays', async ({ app, page }) => {
  await app.boot({ settings: file({ runningSessionsAtLaunch: 'resume' }) });
  const settings = await open(page);
  await expect(settings.choice).toHaveValue('pause');
  await expect(settings.dialog.locator('#settings-running-problems')).toHaveText('The choice in settings.json is not used: It has to be one of "start", "pause", "leave".');
});
