import { expect, test } from '../support/harness';
import { openSettings } from '../support/settings';

// The language the app formats times and dates in, in Settings: the system's until another is saved into settings.json, which a time field follows from the next launch and the rest of the app at once (decided 2026-10-29).

test("the language is the system's until a tag is saved into settings.json, and one that is no tag is refused", async ({ app, page }) => {
  await app.boot();
  const dialog = await openSettings(page);
  const language = dialog.getByLabel('Language for times and dates');
  await expect(language).toHaveValue('');
  // The checks' browser reads its system as en-US, as Chromium reads this machine's C.
  await expect(language).toHaveAttribute('placeholder', 'en-US');
  await expect(dialog).toContainText('Time fields follow this from the next launch; the rest of the app at once.');

  // What a machine's LANG holds is no language tag.
  await language.fill('en_GB');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.locator('#settings-locale-error')).toHaveText("Give a language tag such as en-GB, or leave it empty for the system's.");
  expect(await app.calls('setSettings')).toEqual([]);

  await language.fill('en-GB');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.__claudeUiFixture.settings.json)).toEqual({ locale: 'en-GB' });
});
