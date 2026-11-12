import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/harness';
import { session, settingsFileWith } from '../support/fixture';
import { openSettings } from '../support/settings';
import { row } from '../support/window';

// The set-aside choices and their time of day in Settings: today's three and 09:00 unless chosen otherwise, saved into settings.json, a choice that does not read named under its field, and what Set aside…'s dated choices come due at (decided 2026-10-29, the choices settable 2026-11-05).
const one = session({ id: '00000000-0000-4000-8000-0000000000f3', title: 'Set aside' });

/** Open Set aside… from the session's row and answer its choices. */
async function choicesOffered(page: Page): Promise<Locator> {
  await row(page, one.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu:not(.submenu) button.menu-row', { hasText: /^Set aside…$/ }).click();
  return page.locator('#set-aside-choices button');
}

test('the time is 09:00 until another is saved into settings.json, and a cleared one is refused', async ({ app, page }) => {
  await app.boot();
  const dialog = await openSettings(page, 'Sessions');
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

test('what setting a running session aside does offers its three choices in words, stopping claude and closing the tab until another is saved into settings.json', async ({ app, page }) => {
  await app.boot();
  let dialog = await openSettings(page, 'Sessions');
  const choice = (): Locator => dialog.getByRole('combobox', { name: 'When a running session is set aside' });
  await expect(choice().locator('option')).toHaveText(['Stop claude and close the tab', 'Stop claude, keep the tab', 'Keep claude running']);
  await expect(choice()).toHaveValue('stop-close');

  await choice().selectOption('keep');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.__claudeUiFixture.settings.json)).toEqual({ setAsideRunning: 'keep' });
  dialog = await openSettings(page, 'Sessions');
  await expect(choice()).toHaveValue('keep');
});

test('news while set aside offers its two choices in words, showing it now until another is saved into settings.json', async ({ app, page }) => {
  await app.boot();
  let dialog = await openSettings(page, 'Sessions');
  const choice = (): Locator => dialog.getByRole('combobox', { name: 'News while set aside' });
  await expect(choice().locator('option')).toHaveText(['Show it now', 'Wait for its day']);
  await expect(choice()).toHaveValue('show');

  await choice().selectOption('wait');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.__claudeUiFixture.settings.json)).toEqual({ setAsideNews: 'wait' });
  dialog = await openSettings(page, 'Sessions');
  await expect(choice()).toHaveValue('wait');
});

test("Set aside…'s dated choices come due at the time the settings say, and Pick a date…'s time starts at it", async ({ app, page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 29, 15, 30));
  await app.boot({ sessions: [one], settings: settingsFileWith('settings.json', { setAsideTime: '17:30' }) });
  await expect(await choicesOffered(page)).toHaveText(['Tomorrow (vr 30 okt, 17:30)', 'In 1 week (do 5 nov, 17:30)', 'Pick a date…', 'Whenever']);
  await expect(page.locator('#set-aside-time')).toHaveValue('17:30');
});

test('the choices show as written, a wrong one is refused under the field, and saved ones are what Set aside… offers at once', async ({ app, page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 29, 15, 30));
  await app.boot({ sessions: [one] });
  const dialog = await openSettings(page, 'Sessions');
  const choices = dialog.getByLabel('Set aside: the choices');
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

  await expect(await choicesOffered(page)).toHaveText(['In 2 hours (do 29 okt, 17:30)', 'Next Monday (ma 2 nov, 08:00)', 'Pick a date…', 'Whenever']);
});

test("a list in the file with a choice that does not read is not used, and says why under the field, today's three in force", async ({ app, page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 29, 15, 30));
  await app.boot({ sessions: [one], settings: settingsFileWith('settings.json', { setAside: ['in 2h', 'in 2x'] }) });
  const dialog = await openSettings(page, 'Sessions');
  await expect(dialog.locator('#settings-set-aside-problems')).toHaveText(
    'The choices in settings.json are not used: "in 2x" is not a choice the app reads: write "whenever", "in 30m", "in 2h", "in 3d 14:00", "in 1w", "tomorrow 09:00" or "next monday 09:00", a time only where a day is.',
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await expect(await choicesOffered(page)).toHaveText(['Tomorrow (vr 30 okt, 09:00)', 'In 1 week (do 5 nov, 09:00)', 'Pick a date…', 'Whenever']);
});
