import type { Locator, Page } from '@playwright/test';
import type { SettingsFileRead } from '../../../src/shared/config/settings';
import { settingsFileWith } from '../support/fixture';
import { expect, test } from '../support/harness';
import { openSettings } from '../support/settings';

// What differs from the defaults (decided 2026-11-08): under each setting that differs, its default and a Reset that puts it back when you save; and a switch that narrows every section to those settings.
const file = (json: unknown): SettingsFileRead => settingsFileWith('settings.json', json);
const onDisk = (page: Page): Promise<unknown> => page.evaluate(() => window.__claudeUiFixture.settings.json);
const defaultOf = (dialog: Locator, key: string): Locator => dialog.locator(`#settings-${key}-default`);
const needsYouRow = (dialog: Locator, id: string): Locator => dialog.locator(`#settings-needs-you-list [data-needs-you-id="${id}"]`);

test('a setting that differs from the default says the default under it, and one at its default says nothing', async ({ app, page }) => {
  await app.boot({ settings: file({ leaveButton: 'none', needsYou: { 'pr.merged': { enabled: false } } }) });
  const dialog = await openSettings(page, 'Sessions');
  await expect(defaultOf(dialog, 'leaveButton')).toBeVisible();
  await expect(defaultOf(dialog, 'leaveButton').locator('.settings-default-value')).toHaveText('"stop-close"');
  await expect(defaultOf(dialog, 'setAside')).toBeHidden();
  await dialog.getByRole('tab', { name: 'Needs you' }).click();
  await expect(needsYouRow(dialog, 'pr.merged').locator('.settings-default-value')).toHaveText('as the app ships it');
  await expect(needsYouRow(dialog, 'pr.closed').locator('.settings-default')).toBeHidden();

  await app.settingsOnDisk(file({}));
  await expect(needsYouRow(dialog, 'pr.merged').locator('.settings-default')).toBeHidden();
});

test('a value the file gives that is not used says the default in force under the reason', async ({ app, page }) => {
  await app.boot({ settings: file({ approvals: { acme: 2 } }) });
  const dialog = await openSettings(page, 'Version control');
  await expect(dialog.locator('#settings-approvals-problems')).toContainText('"acme" is not a repository written as owner/name.');
  await expect(defaultOf(dialog, 'approvals').locator('.settings-default-value')).toHaveText('{}');
});

test('Reset on a setting with a field puts the default in the field, and Save writes it', async ({ app, page }) => {
  await app.boot({ settings: file({ leaveButton: 'none', locale: 'nl-NL' }) });
  const dialog = await openSettings(page, 'Sessions');
  const save = dialog.getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();
  await defaultOf(dialog, 'leaveButton').getByRole('button', { name: 'Reset' }).click();
  await expect(dialog.getByLabel('Leave button')).toHaveValue('stop-close');
  await expect(defaultOf(dialog, 'leaveButton').getByRole('button')).toHaveText('Reset pending');
  await expect(defaultOf(dialog, 'leaveButton').getByRole('button')).toBeDisabled();
  await save.click();
  await expect(dialog).toBeHidden();
  expect(await onDisk(page)).toEqual({ leaveButton: 'stop-close', locale: 'nl-NL' });
});

test('Reset on a setting without a field writes its default with Save, the others left as they were', async ({ app, page }) => {
  await app.boot({ settings: file({ approvals: { 'acme/app': 2 }, locale: 'nl-NL' }) });
  const dialog = await openSettings(page, 'Version control');
  await defaultOf(dialog, 'approvals').getByRole('button', { name: 'Reset' }).click();
  await expect(dialog.getByRole('tab', { name: 'Version control' })).toHaveClass(/\bhas-change\b/);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(await onDisk(page)).toEqual({ approvals: {}, locale: 'nl-NL' });
});

test('Reset on one id of needsYou, on its row, empties that entry and keeps the others, and an emptied one is no change', async ({ app, page }) => {
  await app.boot({ settings: file({ needsYou: { 'pr.merged': { enabled: false }, 'pr.closed': { enabled: false } } }) });
  let dialog = await openSettings(page, 'Needs you');
  await needsYouRow(dialog, 'pr.merged').getByRole('button', { name: 'Reset' }).click();
  await expect(needsYouRow(dialog, 'pr.merged').getByRole('button')).toHaveText('Reset pending');
  await expect(needsYouRow(dialog, 'pr.closed').getByRole('button')).toHaveText('Reset');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(await onDisk(page)).toEqual({ needsYou: { 'pr.merged': {}, 'pr.closed': { enabled: false } } });

  dialog = await openSettings(page, 'Needs you');
  await expect(needsYouRow(dialog, 'pr.merged').locator('.settings-default')).toBeHidden();
  await expect(needsYouRow(dialog, 'pr.merged').locator('.settings-tag')).toHaveCount(0);
});

test('Only what differs shows the strength order’s mistake under it, though the looks are as they ship', async ({ app, page }) => {
  await app.boot({ settings: file({ strength: ['waiting', 'nothing', 'busy', 'background', 'needs-you', 'ready', 'closed'] }) });
  const dialog = await openSettings(page, 'Appearance');
  await dialog.getByRole('switch', { name: 'Only what differs' }).check();
  await expect(dialog.locator('#settings-strength-problems')).toBeVisible();
  await expect(dialog.locator('#settings-strength-problems')).toContainText('The order in settings.json is not used');
});

test('Cancel after a Reset writes nothing, and the next open offers the Reset again', async ({ app, page }) => {
  await app.boot({ settings: file({ approvals: { 'acme/app': 2 } }) });
  let dialog = await openSettings(page, 'Version control');
  await defaultOf(dialog, 'approvals').getByRole('button', { name: 'Reset' }).click();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await app.calls('setSettings')).toEqual([]);
  dialog = await openSettings(page, 'Version control');
  await expect(defaultOf(dialog, 'approvals').getByRole('button')).toHaveText('Reset');
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
});

test('Only what differs narrows each section to its settings that differ, counts them in the list, and dims a section with none', async ({ app, page }) => {
  await app.boot({ settings: file({ locale: 'nl-NL', leaveButton: 'none', setAside: ['in 2h'], needsYou: { 'pr.merged': { enabled: false } } }) });
  const dialog = await openSettings(page, 'General');
  const general = dialog.getByRole('tabpanel', { name: 'General' });
  await dialog.getByRole('switch', { name: 'Only what differs' }).check();

  await expect(dialog.getByLabel('Language for times and dates')).toBeVisible();
  await expect(dialog.getByLabel('Default launch flags')).toBeHidden();
  await expect(general.locator('#settings-folder-config')).toBeHidden();
  await expect(general.locator('.settings-hint')).toHaveText('Showing the setting here that differs from the defaults; switch off Only what differs to see them all.');
  await expect(dialog.getByRole('tab', { name: 'Sessions' }).locator('.settings-count')).toHaveText('2');
  await expect(dialog.getByRole('tab', { name: 'Version control' })).toHaveClass(/\bdimmed\b/);

  await dialog.getByRole('tab', { name: 'Needs you' }).click();
  await expect(needsYouRow(dialog, 'pr.merged')).toBeVisible();
  await expect(needsYouRow(dialog, 'finish-up')).toBeVisible();
  await expect(needsYouRow(dialog, 'pr.closed')).toBeHidden();
  await expect(needsYouRow(dialog, 'back-to-work')).toBeHidden();

  await dialog.getByRole('switch', { name: 'Only what differs' }).uncheck();
  await expect(needsYouRow(dialog, 'pr.closed')).toBeVisible();
  await expect(needsYouRow(dialog, 'back-to-work')).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Version control' })).not.toHaveClass(/\bdimmed\b/);
});
