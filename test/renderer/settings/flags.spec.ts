import type { Locator, Page } from '@playwright/test';
import type { SettingsFileRead } from '../../../src/shared/settings';
import { expect, test } from '../support/harness';
import { CONFIG_ROOT, noLocalLayout, settingsFileWith } from '../support/fixture';
import { openSettings } from '../support/settings';

// The launch flags in Settings (docs/architecture/config.md § The config folder): saved into settings.json, which the dialog says once under its title, with only a value of the file's that is not used said under the field.
const file = (json: unknown): SettingsFileRead => settingsFileWith('settings.json', json);
const broken: SettingsFileRead = { name: 'settings.json', status: 'unparsable', error: 'expected a comma at line 3, column 3', json: null };
/** The one save Settings sent, with these flags: a save sends every setting, the others as they were left, which here is the default. */
const savedWith = (launchFlags: string): unknown[][] => [[{ launchFlags, runningSessionsAtLaunch: 'cold', prStatus: true, leaveButton: 'stop-close', setAside: ['tomorrow', 'in 1w', 'whenever'], setAsideTime: '09:00', locale: '' }]];

interface SettingsDialog {
  dialog: Locator;
  field: Locator;
  save: Locator;
  cancel: Locator;
}

const open = async (page: Page): Promise<SettingsDialog> => {
  const dialog = await openSettings(page);
  return {
    dialog,
    field: dialog.locator('#settings-flags'),
    save: dialog.getByRole('button', { name: 'Save' }),
    cancel: dialog.getByRole('button', { name: 'Cancel' }),
  };
};

/** What the stand-in's settings.json holds now, as main would find it on disk. */
const onDisk = (page: Page): Promise<unknown> => page.evaluate(() => window.__claudeUiFixture.settings.json);

test('Settings says once, under its title, where its settings are saved, and nothing under a field says where a value came from', async ({ app, page }) => {
  await app.boot({ settings: file({ launchFlags: '--mine' }) });
  const settings = await open(page);
  await expect(settings.dialog.locator('.dialog-detail').first()).toHaveText('Saved in settings.json in the config folder, where you can edit them by hand too.');
  await expect(settings.field).toHaveValue('--mine');
  await expect(settings.dialog.getByText(/Set here|From settings\.json|settings\.json sets none/)).toHaveCount(0);
  await expect(settings.dialog.getByRole('button', { name: 'Use settings.json' })).toHaveCount(0);
});

test('flags saved in Settings go into settings.json', async ({ app, page }) => {
  await app.boot();
  let settings = await open(page);
  await expect(settings.field).toHaveValue('');
  await settings.field.fill('--allowedTools Grep');
  await settings.save.click();
  await expect(settings.dialog).toBeHidden();
  expect(await app.calls('setSettings')).toEqual(savedWith('--allowedTools Grep'));
  expect(await onDisk(page)).toEqual({ launchFlags: '--allowedTools Grep' });

  settings = await open(page);
  await expect(settings.field).toHaveValue('--allowedTools Grep');
});

test('Save is off while a save would write nothing, on after an edit, and off again once the edit is put back', async ({ app, page }) => {
  await app.boot({ settings: file({ launchFlags: '--mine' }) });
  const settings = await open(page);
  const general = settings.dialog.getByRole('tab', { name: 'General' });
  await expect(settings.save).toBeDisabled();
  await expect(general).not.toHaveClass(/\bhas-change\b/);
  await settings.field.press('Enter');
  await expect(settings.dialog).toBeVisible();

  const flags = settings.dialog.locator('.dialog-group:has(#settings-flags)');
  const language = settings.dialog.locator('.dialog-group:has(#settings-locale)');
  await expect(flags).not.toHaveClass(/\bhas-change\b/);

  await settings.field.fill('--mine --other');
  await expect(settings.save).toBeEnabled();
  await expect(general).toHaveClass(/\bhas-change\b/);
  await expect(flags).toHaveClass(/\bhas-change\b/);
  await expect(language).not.toHaveClass(/\bhas-change\b/);
  await expect(settings.dialog.getByRole('tab', { name: 'Sessions' })).not.toHaveClass(/\bhas-change\b/);

  await settings.field.fill('--mine');
  await expect(settings.save).toBeDisabled();
  await expect(general).not.toHaveClass(/\bhas-change\b/);
  await expect(flags).not.toHaveClass(/\bhas-change\b/);
  expect(await app.calls('setSettings')).toEqual([]);
  expect(await onDisk(page)).toEqual({ launchFlags: '--mine' });
});

test('flags are saved without the spaces around them', async ({ app, page }) => {
  await app.boot();
  const settings = await open(page);
  await settings.field.fill('  --allowedTools Grep  ');
  await settings.save.click();
  await expect(settings.dialog).toBeHidden();
  expect(await app.calls('setSettings')).toEqual(savedWith('--allowedTools Grep'));
});

test('the error under the field goes once the field is typed in', async ({ app, page }) => {
  await app.boot();
  const settings = await open(page);
  const error = settings.dialog.locator('#settings-flags-error');
  await settings.field.fill('--resume other');
  await settings.save.click();
  await expect(error).toBeVisible();
  await settings.field.press('End');
  await settings.field.press('Backspace');
  await expect(error).toBeHidden();
  expect(await app.calls('setSettings')).toEqual([]);
  await settings.cancel.click();
});

test('a value the file gives that is refused is named under the field, and a mistake in the file as a whole under the section', async ({ app, page }) => {
  await app.boot({ settings: file({ launchFlags: '--session-id x', lanchFlags: 1 }) });
  const settings = await open(page);
  await expect(settings.field).toHaveValue('');
  await expect(settings.dialog.locator('#settings-flags-problems')).toHaveText(
    "The flags in settings.json are not used: --session-id can't be set here — claude-ui gives each session its own id, and claude refuses an id twice.",
  );
  await expect(settings.dialog.locator('#settings-notes')).toContainText('settings.json: "lanchFlags" is not a setting the app has.');
});

test('a save puts in a value the file gives that is refused, so the file holds one that is used', async ({ app, page }) => {
  await app.boot({ settings: file({ launchFlags: '--session-id x' }) });
  const settings = await open(page);
  await settings.save.click();
  await expect(settings.dialog).toBeHidden();
  expect(await onDisk(page)).toEqual({ launchFlags: '' });
});

test('flags Settings would refuse are said under the field and never saved', async ({ app, page }) => {
  await app.boot();
  const settings = await open(page);
  await settings.field.fill('--resume other');
  await settings.save.click();
  await expect(settings.dialog.locator('#settings-flags-error')).toHaveText("--resume can't be set here — claude-ui decides which session a tab resumes.");
  await expect(settings.dialog).toBeVisible();
  expect(await app.calls('setSettings')).toEqual([]);
});

test('a settings file that does not parse is toasted from start-up, until a read succeeds', async ({ app, page }) => {
  await app.boot({ settings: broken });
  await expect(page.locator('#toast-message')).toHaveText('settings.json: expected a comma at line 3, column 3');
  await app.settingsOnDisk(file({ launchFlags: '--mine' }));
  await expect(page.locator('#toast')).toBeHidden();
});

test('a settings file that stops parsing is toasted though main tells of it only after a save', async ({ app, page }) => {
  await app.boot();
  // The file breaks, and main's read for telling of it starts, but is sent only once a save has been answered: the save's answer has it broken too.
  const readBefore = await page.evaluate((now) => {
    window.__claudeUiFixture.settings = now;
    return window.__claudeUiTest.readSettings();
  }, broken);
  const settings = await open(page);
  await settings.field.fill('--mine');
  await settings.save.click();
  await expect(settings.dialog.locator('#settings-save-error')).toHaveText('settings.json does not parse, so it was not written: expected a comma at line 3, column 3');
  await app.emit('onSettingsChanged', readBefore);
  await expect(page.locator('#toast-message')).toHaveText('settings.json: expected a comma at line 3, column 3');
});

test('Settings opened while main is still telling of an older change shows the settings it read, not the older ones', async ({ app, page }) => {
  await app.boot();
  // Main's read for telling of a change starts with your flags at --old; they are --new by the time Settings is opened, and the telling lands after.
  const readBefore = await page.evaluate(
    (files) => {
      window.__claudeUiFixture.settings = files.old;
      const read = window.__claudeUiTest.readSettings();
      window.__claudeUiFixture.settings = files.now;
      return read;
    },
    { old: file({ launchFlags: '--old' }), now: file({ launchFlags: '--new' }) },
  );
  const settings = await open(page);
  await expect(settings.field).toHaveValue('--new');
  await app.emit('onSettingsChanged', readBefore);
  await expect(settings.field).toHaveValue('--new');
  await settings.cancel.click();
});

test('fixing the layout file leaves up the settings file’s toast that replaced the layout’s', async ({ app, page }) => {
  const layout = { configRoot: CONFIG_ROOT, file: `${CONFIG_ROOT}/layouts/default.json`, error: null, json: null, types: [], local: noLocalLayout() };
  await app.boot({ layout: { ...layout, status: 'unparsable', error: 'expected a value at the end of the file' } });
  await expect(page.locator('#toast-message')).toHaveText('default.json: expected a value at the end of the file');
  await app.settingsOnDisk(broken);
  await expect(page.locator('#toast-message')).toHaveText('settings.json: expected a comma at line 3, column 3');
  await app.emit('onLayoutChanged', { ...layout, status: 'missing' });
  await expect(page.locator('#toast-message')).toHaveText('settings.json: expected a comma at line 3, column 3');
  await expect(page.locator('#toast')).toBeVisible();
});

test('an edit of settings.json while Settings is open shows there, and leaves what was typed in the field', async ({ app, page }) => {
  await app.boot();
  const settings = await open(page);
  await settings.field.fill('--typed');
  await app.settingsOnDisk(file({ launchFlags: '--mine', runningSessionsAtLaunch: 'start' }));
  await expect(settings.dialog.locator('#settings-running')).toHaveValue('start');
  await expect(settings.field).toHaveValue('--typed');
  await settings.cancel.click();
});
