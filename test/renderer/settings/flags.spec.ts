import type { Locator, Page } from '@playwright/test';
import { settingsView, type SettingsFileRead } from '../../../src/shared/settings';
import { expect, test } from '../support/harness';
import { CONFIG_ROOT, noLocalLayout, noSettingsFile, settingsFileWith } from '../support/fixture';

// The launch flags in Settings (docs/architecture.md § The config folder): saved into the app's settings.local.json over your settings.json, with where the value comes from said under the field.
const yours = (json: unknown): SettingsFileRead => settingsFileWith('settings.json', json);
const apps = (json: unknown): SettingsFileRead => settingsFileWith('settings.local.json', json);
const noApps = noSettingsFile('settings.local.json');

interface SettingsDialog {
  dialog: Locator;
  field: Locator;
  from: Locator;
  yoursValue: Locator;
  use: Locator;
  save: Locator;
  cancel: Locator;
}

const open = async (page: Page): Promise<SettingsDialog> => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  return {
    dialog,
    field: dialog.locator('#settings-flags'),
    from: dialog.locator('#settings-flags-from'),
    yoursValue: dialog.locator('#settings-flags-yours-value'),
    use: dialog.getByRole('button', { name: 'Use settings.json' }),
    save: dialog.getByRole('button', { name: 'Save' }),
    cancel: dialog.getByRole('button', { name: 'Cancel' }),
  };
};

test('flags saved in Settings go to the app’s file, and the field says they were set here', async ({ app, page }) => {
  await app.boot();
  let settings = await open(page);
  await expect(settings.field).toHaveValue('');
  await expect(settings.from).toBeHidden();
  await settings.field.fill('--allowedTools Grep');
  await settings.save.click();
  await expect(settings.dialog).toBeHidden();
  expect(await app.calls('setSettings')).toEqual([[{ launchFlags: '--allowedTools Grep' }]]);

  settings = await open(page);
  await expect(settings.field).toHaveValue('--allowedTools Grep');
  await expect(settings.from).toHaveText('Set here; settings.json sets none.');
  await expect(settings.use).toBeVisible();
});

test('flags set here over settings.json show its flags, and “Use settings.json” goes back to them on save', async ({ app, page }) => {
  await app.boot({ settings: { yours: yours({ launchFlags: '--mine' }), app: apps({ launchFlags: '--app' }) } });
  let settings = await open(page);
  await expect(settings.field).toHaveValue('--app');
  await expect(settings.from).toHaveText('Set here, over the flags in settings.json:');
  await expect(settings.yoursValue).toHaveText('--mine');

  await settings.use.click();
  await expect(settings.field).toHaveValue('--mine');
  await expect(settings.from).toHaveText('From settings.json, once you save.');
  await expect(settings.use).toBeHidden();
  await settings.save.click();
  await expect(settings.dialog).toBeHidden();
  expect(await app.calls('setSettings')).toEqual([[{ launchFlags: '--mine' }]]);

  // Equal to yours, so the stand-in, by main's rule, took the app's value away rather than copying yours.
  settings = await open(page);
  await expect(settings.field).toHaveValue('--mine');
  await expect(settings.from).toHaveText('From settings.json.');
  await expect(settings.use).toBeHidden();
});

test('a value a file gives that is refused is named under the field, and a mistake in a file as a whole under the section', async ({ app, page }) => {
  await app.boot({ settings: { yours: yours({ launchFlags: '--session-id x', lanchFlags: 1 }), app: noApps } });
  const settings = await open(page);
  await expect(settings.field).toHaveValue('');
  await expect(settings.dialog.locator('#settings-flags-problems')).toHaveText(
    "The flags in settings.json are not used: --session-id can't be set here — claude-ui gives each session its own id, and claude refuses an id twice.",
  );
  await expect(settings.dialog.locator('#settings-notes')).toContainText('settings.json: "lanchFlags" is not a setting the app has.');
});

test('flags Settings would refuse are said under the field and never saved', async ({ app, page }) => {
  await app.boot();
  const settings = await open(page);
  await settings.field.fill('--resume other');
  await settings.save.click();
  await expect(settings.dialog.locator('#settings-error')).toHaveText("--resume can't be set here — claude-ui decides which session a tab resumes.");
  await expect(settings.dialog).toBeVisible();
  expect(await app.calls('setSettings')).toEqual([]);
});

test('a settings file that does not parse is toasted from start-up, until a read succeeds', async ({ app, page }) => {
  const broken: SettingsFileRead = { name: 'settings.json', status: 'unparsable', error: 'expected a comma at line 3, column 3', json: null };
  await app.boot({ settings: { yours: broken, app: noApps } });
  await expect(page.locator('#toast-message')).toHaveText('settings.json: expected a comma at line 3, column 3');
  await app.emit('onSettingsChanged', settingsView(yours({ launchFlags: '--mine' }), noApps));
  await expect(page.locator('#toast')).toBeHidden();
});

test('fixing the layout file leaves up the settings file’s toast that replaced the layout’s', async ({ app, page }) => {
  const layout = { configRoot: CONFIG_ROOT, file: `${CONFIG_ROOT}/layouts/default.json`, error: null, json: null, types: [], local: noLocalLayout() };
  await app.boot({ layout: { ...layout, status: 'unparsable', error: 'expected a value at the end of the file' } });
  await expect(page.locator('#toast-message')).toHaveText('default.json: expected a value at the end of the file');
  await app.emit('onSettingsChanged', settingsView({ name: 'settings.json', status: 'unparsable', error: 'expected a comma at line 3, column 3', json: null }, noApps));
  await expect(page.locator('#toast-message')).toHaveText('settings.json: expected a comma at line 3, column 3');
  await app.emit('onLayoutChanged', { ...layout, status: 'missing' });
  await expect(page.locator('#toast-message')).toHaveText('settings.json: expected a comma at line 3, column 3');
  await expect(page.locator('#toast')).toBeVisible();
});

test('an edit of a settings file while Settings is open shows there, and leaves what was typed in the field', async ({ app, page }) => {
  await app.boot();
  const settings = await open(page);
  await settings.field.fill('--typed');
  await app.emit('onSettingsChanged', settingsView(yours({ launchFlags: '--mine' }), apps({ launchFlags: '--app' })));
  await expect(settings.from).toHaveText('Set here, over the flags in settings.json:');
  await expect(settings.yoursValue).toHaveText('--mine');
  await expect(settings.field).toHaveValue('--typed');
  await settings.cancel.click();
});
