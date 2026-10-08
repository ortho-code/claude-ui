import type { Locator, Page } from '@playwright/test';
import type { SettingsFileRead } from '../../../src/shared/settings';
import { expect, test } from '../support/harness';
import { noSettingsFile, settingsFileWith } from '../support/fixture';

// What a launch does with the sessions that were running when the app closed, in Settings: paused unless chosen otherwise, saved into the app's settings.local.json over your settings.json, with where the choice comes from said under it, as the flags' is.
const yours = (json: unknown): SettingsFileRead => settingsFileWith('settings.json', json);
const apps = (json: unknown): SettingsFileRead => settingsFileWith('settings.local.json', json);

interface Running {
  dialog: Locator;
  start: Locator;
  pause: Locator;
  leave: Locator;
  from: Locator;
  yoursValue: Locator;
  save: Locator;
}

const open = async (page: Page): Promise<Running> => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  const group = dialog.getByRole('radiogroup', { name: 'Sessions running when the app closed' });
  return {
    dialog,
    start: group.getByRole('radio', { name: 'Start them again' }),
    pause: group.getByRole('radio', { name: 'Keep them paused in the live strip' }),
    leave: group.getByRole('radio', { name: 'Leave them with the other tabs' }),
    from: dialog.locator('#settings-running-from'),
    yoursValue: dialog.locator('#settings-running-yours-value'),
    save: dialog.getByRole('button', { name: 'Save' }),
  };
};

test('the sessions running at quit come back paused until another choice is saved, which Settings then says was set here', async ({ app, page }) => {
  await app.boot();
  let settings = await open(page);
  await expect(settings.pause).toBeChecked();
  await expect(settings.from).toBeHidden();

  await settings.start.check();
  await settings.save.click();
  await expect(settings.dialog).toBeHidden();
  expect(await app.calls('setSettings')).toEqual([[{ launchFlags: '', runningSessionsAtLaunch: 'start' }]]);

  settings = await open(page);
  await expect(settings.start).toBeChecked();
  await expect(settings.from).toHaveText('Set here; settings.json sets none.');
});

test('a choice set here over settings.json shows that file’s choice under it, and “Use settings.json” goes back to it', async ({ app, page }) => {
  await app.boot({ settings: { yours: yours({ runningSessionsAtLaunch: 'leave' }), app: apps({ runningSessionsAtLaunch: 'start' }) } });
  const settings = await open(page);
  await expect(settings.start).toBeChecked();
  await expect(settings.from).toHaveText('Set here, over the choice in settings.json:');
  await expect(settings.yoursValue).toHaveText('Leave them with the other tabs');

  await settings.dialog.locator('#settings-running-use').click();
  await expect(settings.leave).toBeChecked();
  await expect(settings.leave).toBeFocused();
});

test('a value a file gives that is no choice is named under it, and the default stays', async ({ app, page }) => {
  await app.boot({ settings: { yours: yours({ runningSessionsAtLaunch: 'resume' }), app: noSettingsFile('settings.local.json') } });
  const settings = await open(page);
  await expect(settings.pause).toBeChecked();
  await expect(settings.dialog.locator('#settings-running-problems')).toHaveText('The choice in settings.json is not used: It has to be one of "start", "pause", "leave".');
});
