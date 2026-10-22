import type { Locator, Page } from '@playwright/test';
import type { SettingsFileRead } from '../../../src/shared/settings';
import { expect, test } from '../support/harness';
import { settingsFileWith } from '../support/fixture';

// Whether the app asks GitHub for PR status, in Settings: a checkbox, on unless chosen otherwise, saved into settings.json, as the other settings are.
const file = (json: unknown): SettingsFileRead => settingsFileWith('settings.json', json);

interface PrStatusSetting {
  dialog: Locator;
  box: Locator;
  save: Locator;
}

const open = async (page: Page): Promise<PrStatusSetting> => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  return {
    dialog,
    box: dialog.getByRole('checkbox', { name: 'PR status from GitHub' }),
    save: dialog.getByRole('button', { name: 'Save' }),
  };
};

test('the box is ticked until it is unticked and saved into settings.json', async ({ app, page }) => {
  await app.boot();
  let settings = await open(page);
  await expect(settings.box).toBeChecked();

  await settings.box.uncheck();
  await settings.save.click();
  await expect(settings.dialog).toBeHidden();
  expect(await app.calls('setSettings')).toEqual([[{ launchFlags: '', runningSessionsAtLaunch: 'pause', prStatus: false }]]);
  expect(await page.evaluate(() => window.__claudeUiFixture.settings.json)).toEqual({ prStatus: false });

  settings = await open(page);
  await expect(settings.box).not.toBeChecked();
});

test('a choice in settings.json shows in the box', async ({ app, page }) => {
  await app.boot({ settings: file({ prStatus: false }) });
  const settings = await open(page);
  await expect(settings.box).not.toBeChecked();
});

test('a setting settings.json names twice is named under the settings, and a save that would change it is refused, saying why', async ({ app, page }) => {
  await app.boot({ settings: { ...file({ prStatus: true }), duplicates: ['prStatus'] } });
  const settings = await open(page);
  await expect(settings.dialog.locator('#settings-notes')).toContainText('settings.json names "prStatus" more than once: the last is the one read, and Settings refuses a save that would change it until only one is left.');
  await settings.box.uncheck();
  await settings.save.click();
  await expect(settings.dialog.locator('#settings-error')).toHaveText('settings.json names "prStatus" more than once, so nothing was saved: leave one of each, then save again.');
  await expect(settings.dialog).toBeVisible();
  expect(await page.evaluate(() => window.__claudeUiFixture.settings.json)).toEqual({ prStatus: true });
});

test('a value the file gives that is not true or false is named under it, and the default stays', async ({ app, page }) => {
  await app.boot({ settings: file({ prStatus: 'no' }) });
  const settings = await open(page);
  await expect(settings.box).toBeChecked();
  await expect(settings.dialog.locator('#settings-pr-status-problems')).toHaveText('The choice in settings.json is not used: It has to be true or false.');
});
