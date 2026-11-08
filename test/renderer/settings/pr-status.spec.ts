import type { Locator, Page } from '@playwright/test';
import type { SettingsFileRead } from '../../../src/shared/settings';
import { expect, test } from '../support/harness';
import { settingsFileWith } from '../support/fixture';
import { openSettings } from '../support/settings';

// Whether the app asks GitHub for PR status, in Settings: a checkbox, on unless chosen otherwise, saved into settings.json, as the other settings are.
const file = (json: unknown): SettingsFileRead => settingsFileWith('settings.json', json);

interface PrStatusSetting {
  dialog: Locator;
  box: Locator;
  save: Locator;
}

const open = async (page: Page): Promise<PrStatusSetting> => {
  const dialog = await openSettings(page, 'Version control');
  return {
    dialog,
    box: dialog.getByRole('switch', { name: 'PR status from GitHub' }),
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
  expect(await app.calls('setSettings')).toEqual([[{ launchFlags: '', runningSessionsAtLaunch: 'cold', prStatus: false, leaveButton: 'stop-close', setAside: ['tomorrow', 'in 1w', 'whenever'], setAsideTime: '09:00', locale: '' }]]);
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
  await expect(settings.dialog.locator('#settings-save-error')).toHaveText('settings.json names "prStatus" more than once, so nothing was saved: leave one of each, then save again.');
  await expect(settings.dialog).toBeVisible();
  expect(await page.evaluate(() => window.__claudeUiFixture.settings.json)).toEqual({ prStatus: true });
});

test('a value the file gives that is not true or false is named under it, and the default stays', async ({ app, page }) => {
  await app.boot({ settings: file({ prStatus: 'no' }) });
  const settings = await open(page);
  await expect(settings.box).toBeChecked();
  await expect(settings.dialog.locator('#settings-pr-status-problems')).toHaveText('The choice in settings.json is not used: It has to be true or false.');
});

test('approvals the file gives with a mistake are named under Pull requests, and none is used', async ({ app, page }) => {
  await app.boot({ settings: file({ approvals: { 'acme/app': 0 } }) });
  const settings = await open(page);
  await expect(settings.dialog.locator('#settings-approvals-problems')).toHaveText('The approvals in settings.json are not used: "acme/app" needs a whole number of 1 or more.');
});

test('approvals the file gives that can be used name nothing under Pull requests', async ({ app, page }) => {
  await app.boot({ settings: file({ approvals: { 'acme/app': 2 } }) });
  const settings = await open(page);
  await expect(settings.dialog.locator('#settings-approvals-problems')).toBeEmpty();
});
