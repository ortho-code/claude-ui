import { expect, test } from '../support/harness';
import { session, settingsFileWith } from '../support/fixture';
import { row } from '../support/window';

// The set-aside choices and their time of day in Settings: today's three and 09:00 unless chosen otherwise, saved into settings.json, a choice that does not read named under its field, and what Later's dated choices come due at (decided 2026-10-29, the choices settable 2026-11-05).
const one = session({ id: '00000000-0000-4000-8000-0000000000f3', title: 'Set aside' });

test('the time is 09:00 until another is saved into settings.json, and a cleared one is refused', async ({ app, page }) => {
  await app.boot();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const time = dialog.getByLabel('Time of day for a choice without one');
  await expect(time).toHaveValue('09:00');

  await time.fill('');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.locator('#settings-set-aside-time-error')).toHaveText('Give a time of day.');
  expect(await app.calls('setSettings')).toEqual([]);

  await time.fill('17:30');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.__claudeUiFixture.settings.json)).toEqual({ setAsideTime: '17:30' });
});

test("Later's dated choices come due at the time the settings say", async ({ app, page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 29, 15, 30));
  await app.boot({ sessions: [one], settings: settingsFileWith('settings.json', { setAsideTime: '17:30' }) });
  await row(page, one.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu:not(.submenu) button.menu-row', { hasText: /^Later$/ }).click();
  await expect(page.locator('.kebab-menu.submenu button.menu-row')).toHaveText(['Tomorrow (Fri 30 Oct, 17:30)', 'In 1 week (Thu 5 Nov, 17:30)', 'Pick a date…', 'Whenever']);
});

test('the choices show as written, a wrong one is refused under the field, and saved ones are what Later offers at once', async ({ app, page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 29, 15, 30));
  await app.boot({ sessions: [one] });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const choices = dialog.getByLabel('Choices for Later');
  await expect(choices).toHaveValue('tomorrow, in 1w, whenever');

  await choices.fill('tomorrow, nxt monday');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.locator('#settings-set-aside-error')).toHaveText(
    '"nxt monday" is not a choice the app reads: write "whenever", "in 30m", "in 2h", "in 3d 14:00", "in 1w", "tomorrow 09:00" or "next monday 09:00", a time only where a day is.',
  );
  expect(await app.calls('setSettings')).toEqual([]);

  await choices.fill('next monday 08:00,  in 2h ,whenever');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.__claudeUiFixture.settings.json)).toEqual({ setAside: ['next monday 08:00', 'in 2h', 'whenever'] });

  await row(page, one.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu:not(.submenu) button.menu-row', { hasText: /^Later$/ }).click();
  await expect(page.locator('.kebab-menu.submenu button.menu-row')).toHaveText(['In 2 hours (Thu 29 Oct, 17:30)', 'Next Monday (Mon 2 Nov, 08:00)', 'Pick a date…', 'Whenever']);
});

test("a list in the file with a choice that does not read is not used, and says why under the field, today's three in force", async ({ app, page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 29, 15, 30));
  await app.boot({ sessions: [one], settings: settingsFileWith('settings.json', { setAside: ['in 2h', 'in 2x'] }) });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.locator('#settings-set-aside-problems')).toHaveText(
    'The choices in settings.json are not used: "in 2x" is not a choice the app reads: write "whenever", "in 30m", "in 2h", "in 3d 14:00", "in 1w", "tomorrow 09:00" or "next monday 09:00", a time only where a day is.',
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await row(page, one.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu:not(.submenu) button.menu-row', { hasText: /^Later$/ }).click();
  await expect(page.locator('.kebab-menu.submenu button.menu-row')).toHaveText(['Tomorrow (Fri 30 Oct, 09:00)', 'In 1 week (Thu 5 Nov, 09:00)', 'Pick a date…', 'Whenever']);
});
