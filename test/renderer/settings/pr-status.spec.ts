import type { Locator, Page } from '@playwright/test';
import type { SettingsFileRead } from '../../../src/shared/settings';
import { expect, test } from '../support/harness';
import { noSettingsFile, settingsFileWith } from '../support/fixture';

// Whether the app asks GitHub for PR status, in Settings: a checkbox, on unless chosen otherwise, saved into the app's settings.local.json over your settings.json, with where the choice comes from said under it, as the other settings' is.
const yours = (json: unknown): SettingsFileRead => settingsFileWith('settings.json', json);
const apps = (json: unknown): SettingsFileRead => settingsFileWith('settings.local.json', json);

interface PrStatusSetting {
  dialog: Locator;
  box: Locator;
  from: Locator;
  yoursValue: Locator;
  save: Locator;
}

const open = async (page: Page): Promise<PrStatusSetting> => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  return {
    dialog,
    box: dialog.getByRole('checkbox', { name: 'PR status from GitHub' }),
    from: dialog.locator('#settings-pr-status-from'),
    yoursValue: dialog.locator('#settings-pr-status-yours-value'),
    save: dialog.getByRole('button', { name: 'Save' }),
  };
};

test('the box is ticked until it is unticked and saved, which Settings then says was set here', async ({ app, page }) => {
  await app.boot();
  let settings = await open(page);
  await expect(settings.box).toBeChecked();
  await expect(settings.from).toBeHidden();

  await settings.box.uncheck();
  await settings.save.click();
  await expect(settings.dialog).toBeHidden();
  expect(await app.calls('setSettings')).toEqual([[{ launchFlags: '', runningSessionsAtLaunch: 'pause', prStatus: false }]]);

  settings = await open(page);
  await expect(settings.box).not.toBeChecked();
  await expect(settings.from).toHaveText('Set here; settings.json sets none.');
});

test('a choice set here over settings.json shows that file’s choice under it, and “Use settings.json” goes back to it', async ({ app, page }) => {
  await app.boot({ settings: { yours: yours({ prStatus: false }), app: apps({ prStatus: true }) } });
  const settings = await open(page);
  await expect(settings.box).toBeChecked();
  await expect(settings.from).toHaveText('Set here, over the choice in settings.json:');
  await expect(settings.yoursValue).toHaveText('Off');

  await settings.dialog.locator('#settings-pr-status-use').click();
  await expect(settings.box).not.toBeChecked();
  await expect(settings.box).toBeFocused();
});

test('a value a file gives that is not true or false is named under it, and the default stays', async ({ app, page }) => {
  await app.boot({ settings: { yours: yours({ prStatus: 'no' }), app: noSettingsFile('settings.local.json') } });
  const settings = await open(page);
  await expect(settings.box).toBeChecked();
  await expect(settings.dialog.locator('#settings-pr-status-problems')).toHaveText('The choice in settings.json is not used: It has to be true or false.');
});
