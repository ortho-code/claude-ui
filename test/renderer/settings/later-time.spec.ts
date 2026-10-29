import { expect, test } from '../support/harness';
import { session, settingsFileWith } from '../support/fixture';
import { row } from '../support/window';

// The time of day a session set aside for later comes back, in Settings: 09:00 unless chosen otherwise, saved into settings.json, and what Later's dated choices come due at (decided 2026-10-29).
const one = session({ id: '00000000-0000-4000-8000-0000000000f3', title: 'Set aside' });

test('the time is 09:00 until another is saved into settings.json, and a cleared one is refused', async ({ app, page }) => {
  await app.boot();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const time = dialog.getByLabel('Time a later session comes back');
  await expect(time).toHaveValue('09:00');

  await time.fill('');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.locator('#settings-later-time-error')).toHaveText('Give a time of day.');
  expect(await app.calls('setSettings')).toEqual([]);

  await time.fill('17:30');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.__claudeUiFixture.settings.json)).toEqual({ laterTime: '17:30' });
});

test("Later's dated choices come due at the time the settings say", async ({ app, page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 29, 15, 30));
  await app.boot({ sessions: [one], settings: settingsFileWith('settings.json', { laterTime: '17:30' }) });
  await row(page, one.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu:not(.submenu) button.menu-row', { hasText: /^Later$/ }).click();
  await expect(page.locator('.kebab-menu.submenu button.menu-row')).toHaveText(['Tomorrow (Fri 30 Oct, 17:30)', 'In a week (Thu 5 Nov, 17:30)', 'Pick a date…', 'Whenever']);
});
