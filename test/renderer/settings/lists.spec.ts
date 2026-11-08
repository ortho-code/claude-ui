import type { Locator } from '@playwright/test';
import { PALETTE } from '../../../src/shared/looks';
import { settingsFileWith } from '../support/fixture';
import { expect, test } from '../support/harness';
import { openSettings } from '../support/settings';

// What Settings shows but cannot change yet (decided 2026-11-08): the needs-you categories and types in force under Needs you, and the strength order in force under Appearance, each drawn in its look.
const rgb = (hex: string): string => `rgb(${[1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16)).join(', ')})`;
const fill = (dot: Locator): Promise<string> => dot.evaluate((element) => getComputedStyle(element).backgroundColor);

test('Needs you lists every category in Now’s order with its types, saying which are off, which PRs they fire for, and what needsYou changed', async ({ app, page }) => {
  await app.boot({ settings: settingsFileWith('settings.json', { needsYou: { 'pr.merged': { enabled: false }, 'pr.approved': { roles: ['own', 'reviewing'] } } }) });
  const list = (await openSettings(page, 'Needs you')).locator('#settings-needs-you-list');
  await expect(list.locator('.settings-category-row .settings-row-id')).toHaveText(['your-turn', 'back-to-work', 'ready-to-merge', 'look-again', 'reminders', 'finish-up']);

  const merged = list.locator('.settings-type-row', { hasText: 'pr.merged' });
  await expect(merged.locator('.settings-tag')).toHaveText(['off', 'changed: enabled']);
  const approved = list.locator('.settings-type-row', { hasText: 'pr.approved' });
  await expect(approved.locator('.settings-tag')).toHaveText(['for your own PRs, PRs you review', 'changed: roles']);
  const closed = list.locator('.settings-type-row', { hasText: 'pr.closed' });
  await expect(closed.locator('.settings-tag')).toHaveCount(0);
  await expect(list.locator('.settings-type-row', { hasText: 'claude.asks' }).locator('.settings-tag')).toHaveText(["claude's status"]);
});

test('a type is drawn in its look, and one of Your turn’s as the status it is', async ({ app, page }) => {
  await app.boot({ settings: settingsFileWith('settings.json', { looks: { 'pr.merged': { colour: 'teal' } } }) });
  const list = (await openSettings(page, 'Needs you')).locator('#settings-needs-you-list');
  expect(await fill(list.locator('.settings-type-row', { hasText: 'pr.merged' }).locator('.nudge'))).toBe(rgb(PALETTE.teal));
  expect(await fill(list.locator('.settings-type-row', { hasText: 'pr.closed' }).locator('.nudge'))).toBe(rgb(PALETTE.mauve));
  await expect(list.locator('.settings-type-row', { hasText: 'claude.asks' }).locator('.nudge')).toHaveClass(/\bwaiting\b/);
});

test('Appearance lists the strength order in force, needs-you opened into the categories it stands for', async ({ app, page }) => {
  await app.boot({ settings: settingsFileWith('settings.json', { strength: ['waiting', 'back-to-work', 'busy', 'background', 'needs-you', 'ready', 'closed'] }) });
  const order = (await openSettings(page, 'Appearance')).locator('#settings-strength-list .settings-row-name');
  await expect(order).toHaveText(['Waiting for you', 'Back to work', 'Busy', 'Working in the background', 'Ready to merge', 'Look again', 'Reminders', 'Finish up', 'Needs you, any other reason', 'Ready', 'Not running']);
});

test('the lists follow settings.json while Settings is open', async ({ app, page }) => {
  await app.boot();
  const dialog = await openSettings(page, 'Needs you');
  const merged = dialog.locator('#settings-needs-you-list .settings-type-row', { hasText: 'pr.merged' });
  await expect(merged.locator('.settings-tag')).toHaveCount(0);
  await app.settingsOnDisk(settingsFileWith('settings.json', { needsYou: { 'pr.merged': { enabled: false } } }));
  await expect(merged.locator('.settings-tag').first()).toHaveText('off');
});
