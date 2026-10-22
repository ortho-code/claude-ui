import type { Locator, Page } from '@playwright/test';
import type { SettingsFileRead } from '../../../src/shared/settings';
import { expect, test } from '../support/harness';
import { noSettingsFile, settingsFileWith } from '../support/fixture';

// What a launch does with the sessions that were running when the app closed, in Settings: a dropdown, paused unless chosen otherwise, saved into the app's settings.local.json over your settings.json, with where the choice comes from said under it, as the flags' is.
const yours = (json: unknown): SettingsFileRead => settingsFileWith('settings.json', json);
const apps = (json: unknown): SettingsFileRead => settingsFileWith('settings.local.json', json);

interface Running {
  dialog: Locator;
  choice: Locator;
  from: Locator;
  yoursValue: Locator;
  save: Locator;
}

const open = async (page: Page): Promise<Running> => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  return {
    dialog,
    choice: dialog.getByRole('combobox', { name: 'Sessions running when the app closed' }),
    from: dialog.locator('#settings-running-from'),
    yoursValue: dialog.locator('#settings-running-yours-value'),
    save: dialog.getByRole('button', { name: 'Save' }),
  };
};

test('the dropdown offers the three choices in words, in their order', async ({ app, page }) => {
  await app.boot();
  const settings = await open(page);
  await expect(settings.choice.locator('option')).toHaveText(['Start them again', 'Keep them paused in the live strip', 'Leave them with the other tabs']);
});

test('the sessions running at quit come back paused until another choice is saved, which Settings then says was set here', async ({ app, page }) => {
  await app.boot();
  let settings = await open(page);
  await expect(settings.choice).toHaveValue('pause');
  await expect(settings.from).toBeHidden();

  await settings.choice.selectOption('start');
  await settings.save.click();
  await expect(settings.dialog).toBeHidden();
  expect(await app.calls('setSettings')).toEqual([[{ launchFlags: '', runningSessionsAtLaunch: 'start', prStatus: true }]]);

  settings = await open(page);
  await expect(settings.choice).toHaveValue('start');
  await expect(settings.from).toHaveText('Set here; settings.json sets none.');

  // With none in settings.json, its button goes back to the default.
  await settings.dialog.locator('#settings-running-use').click();
  await expect(settings.choice).toHaveValue('pause');
  await expect(settings.from).toHaveText('The default, once you save; settings.json sets none.');
});

test('a choice set here over settings.json shows that file’s choice under it, and “Use settings.json” goes back to it', async ({ app, page }) => {
  await app.boot({ settings: { yours: yours({ runningSessionsAtLaunch: 'leave' }), app: apps({ runningSessionsAtLaunch: 'start' }) } });
  const settings = await open(page);
  await expect(settings.choice).toHaveValue('start');
  await expect(settings.from).toHaveText('Set here, over the choice in settings.json:');
  await expect(settings.yoursValue).toHaveText('Leave them with the other tabs');

  await settings.dialog.locator('#settings-running-use').click();
  await expect(settings.choice).toHaveValue('leave');
  await expect(settings.choice).toBeFocused();
});

test('a value a file gives that is no choice is named under it, and the default stays', async ({ app, page }) => {
  await app.boot({ settings: { yours: yours({ runningSessionsAtLaunch: 'resume' }), app: noSettingsFile('settings.local.json') } });
  const settings = await open(page);
  await expect(settings.choice).toHaveValue('pause');
  await expect(settings.dialog.locator('#settings-running-problems')).toHaveText('The choice in settings.json is not used: It has to be one of "start", "pause", "leave".');
});
