import type { Locator, Page } from '@playwright/test';
import type { SettingsFileRead } from '../../../src/shared/settings';
import { expect, test } from '../support/harness';
import { noSettingsFile, settingsFileWith } from '../support/fixture';

// Resuming at launch in Settings: on unless chosen otherwise, saved into the app's settings.local.json over your settings.json, with where the choice comes from said under it, as the flags' is.
const yours = (json: unknown): SettingsFileRead => settingsFileWith('settings.json', json);
const apps = (json: unknown): SettingsFileRead => settingsFileWith('settings.local.json', json);

interface Resume {
  dialog: Locator;
  box: Locator;
  from: Locator;
  yoursValue: Locator;
  save: Locator;
}

const open = async (page: Page): Promise<Resume> => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  return {
    dialog,
    box: dialog.getByRole('checkbox', { name: 'Resume sessions that were running when the app closed' }),
    from: dialog.locator('#settings-resume-from'),
    yoursValue: dialog.locator('#settings-resume-yours-value'),
    save: dialog.getByRole('button', { name: 'Save' }),
  };
};

test('resuming is on until it is switched off, which Settings saves and then says was set here', async ({ app, page }) => {
  await app.boot();
  let settings = await open(page);
  await expect(settings.box).toBeChecked();
  await expect(settings.from).toBeHidden();

  await settings.box.uncheck();
  await settings.save.click();
  await expect(settings.dialog).toBeHidden();
  expect(await app.calls('setSettings')).toEqual([[{ launchFlags: '', resumeRunningSessionsOnStartup: false }]]);

  settings = await open(page);
  await expect(settings.box).not.toBeChecked();
  await expect(settings.from).toHaveText('Set here; settings.json sets none.');
});

test('a choice set here over settings.json shows that file’s choice under it', async ({ app, page }) => {
  await app.boot({ settings: { yours: yours({ resumeRunningSessionsOnStartup: false }), app: apps({ resumeRunningSessionsOnStartup: true }) } });
  const settings = await open(page);
  await expect(settings.box).toBeChecked();
  await expect(settings.from).toHaveText('Set here, over the choice in settings.json:');
  await expect(settings.yoursValue).toHaveText('Off');
});

test('a value a file gives that is no choice is named under it, and the default stays', async ({ app, page }) => {
  await app.boot({ settings: { yours: yours({ resumeRunningSessionsOnStartup: 'yes' }), app: noSettingsFile('settings.local.json') } });
  const settings = await open(page);
  await expect(settings.box).toBeChecked();
  await expect(settings.dialog.locator('#settings-resume-problems')).toHaveText('The choice in settings.json is not used: It has to be true or false.');
});
