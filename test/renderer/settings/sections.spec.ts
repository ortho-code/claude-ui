import type { SettingsFileRead } from '../../../src/shared/settings';
import { settingsFileWith } from '../support/fixture';
import { expect, test } from '../support/harness';
import { openSettings } from '../support/settings';

// Settings in sections (decided 2026-11-08): a list of sections on the left, the one on show beside it, one Save for them all.
const file = (json: unknown): SettingsFileRead => settingsFileWith('settings.json', json);
const SECTIONS = ['General', 'Sessions', 'Needs you', 'Appearance', 'Version control', 'Logs'];

test('each section shows its own settings and hides the others, and the arrow keys move along the list', async ({ app, page }) => {
  await app.boot();
  const dialog = await openSettings(page);
  await expect(dialog.getByRole('tab')).toHaveText(SECTIONS);
  await expect(dialog.getByLabel('Default launch flags')).toBeVisible();
  await expect(dialog.getByLabel('Leave button')).toBeHidden();

  await dialog.getByRole('tab', { name: 'Sessions' }).click();
  await expect(dialog.getByRole('tab', { name: 'Sessions' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByLabel('Leave button')).toBeVisible();
  await expect(dialog.getByLabel('Default launch flags')).toBeHidden();

  await page.keyboard.press('ArrowDown');
  await expect(dialog.getByRole('tab', { name: 'Needs you' })).toBeFocused();
  await expect(dialog.getByRole('tabpanel', { name: 'Needs you' })).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(dialog.getByRole('tabpanel', { name: 'General' })).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await expect(dialog.getByRole('tabpanel', { name: 'Logs' })).toBeVisible();
  await page.keyboard.press('Home');
  await expect(dialog.getByRole('tabpanel', { name: 'General' })).toBeVisible();
});

test('an edit stays while another section is on show, and Cancel drops it', async ({ app, page }) => {
  await app.boot();
  const dialog = await openSettings(page);
  await dialog.getByLabel('Language for times and dates').fill('en-GB');
  await dialog.getByRole('tab', { name: 'Sessions' }).click();
  await dialog.getByRole('tab', { name: 'General' }).click();
  await expect(dialog.getByLabel('Language for times and dates')).toHaveValue('en-GB');

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await app.calls('setSettings')).toEqual([]);
  const again = await openSettings(page);
  await expect(again.getByLabel('Language for times and dates')).toHaveValue('');
});

test('a save refused over a field in a section not on show shows that section, with the focus in the field', async ({ app, page }) => {
  await app.boot();
  const dialog = await openSettings(page, 'Sessions');
  await dialog.getByLabel('Set aside: the choices').fill('in 2x');
  await dialog.getByRole('tab', { name: 'General' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByRole('tabpanel', { name: 'Sessions' })).toBeVisible();
  await expect(dialog.getByLabel('Set aside: the choices')).toBeFocused();
  await expect(dialog.locator('#settings-set-aside-error')).toBeVisible();
  expect(await app.calls('setSettings')).toEqual([]);
});

test('a mistake in a setting marks the section holding it in the list, and no other', async ({ app, page }) => {
  await app.boot({ settings: file({ looks: { nothing: { colour: 'peach' } } }) });
  const dialog = await openSettings(page);
  await expect(dialog.getByRole('tab', { name: 'Appearance' })).toHaveClass(/\bhas-mistake\b/);
  for (const other of SECTIONS.filter((name) => name !== 'Appearance')) await expect(dialog.getByRole('tab', { name: other, exact: true })).not.toHaveClass(/\bhas-mistake\b/);
});

test('a settings.json that does not parse is named over every section', async ({ app, page }) => {
  await app.boot({ settings: { name: 'settings.json', status: 'unparsable', error: 'expected a comma at line 3, column 3', json: null } });
  const dialog = await openSettings(page);
  const notes = dialog.locator('#settings-notes');
  for (const name of SECTIONS) {
    await dialog.getByRole('tab', { name, exact: true }).click();
    await expect(notes).toBeVisible();
    await expect(notes).toContainText('settings.json does not parse');
  }
});

test('Settings opens again on the section last shown, with the focus in its first field, or on its tab where it has none', async ({ app, page }) => {
  await app.boot();
  let dialog = await openSettings(page, 'Version control');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(dialog.getByRole('tabpanel', { name: 'Version control' })).toBeVisible();
  await expect(dialog.getByRole('switch', { name: 'PR status from GitHub' })).toBeFocused();

  await dialog.getByRole('tab', { name: 'Logs' }).click();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByRole('tabpanel', { name: 'Logs' })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Logs' })).toBeFocused();
});

test("a section's name stays in view while its settings scroll under it", async ({ app, page }) => {
  await page.setViewportSize({ width: 1000, height: 480 });
  await app.boot();
  const dialog = await openSettings(page);
  const panel = dialog.getByRole('tabpanel', { name: 'General' });
  const heading = panel.getByRole('heading', { name: 'General' });
  await panel.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  expect(await panel.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  const [panelBox, headingBox] = [await panel.boundingBox(), await heading.boundingBox()];
  expect(headingBox!.y).toBe(panelBox!.y);
});

test("the parts set only by hand open the config folder, by its name", async ({ app, page }) => {
  await app.boot();
  const dialog = await openSettings(page, 'Version control');
  await dialog.getByRole('tabpanel', { name: 'Version control' }).getByRole('button', { name: 'Open config folder' }).click();
  await dialog.getByRole('tab', { name: 'Appearance' }).click();
  await dialog.getByRole('tabpanel', { name: 'Appearance' }).getByRole('button', { name: 'Open config folder' }).click();
  await dialog.getByRole('tab', { name: 'Needs you' }).click();
  await dialog.getByRole('tabpanel', { name: 'Needs you' }).getByRole('button', { name: 'Open config folder' }).click();
  expect(await app.calls('openFolder')).toEqual([['config'], ['config'], ['config']]);
});
