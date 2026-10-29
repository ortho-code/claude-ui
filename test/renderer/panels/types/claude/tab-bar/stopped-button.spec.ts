import type { Locator, Page } from '@playwright/test';
import { session, settingsFileWith } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { row, stripRow, tab, tabLabel } from '../../../../support/window';

// What a stopped tab's button does is a setting, `stoppedTabButton`: close the tab, as it did before there was a setting, or archive its session; a running tab's button is left as it is (decided 2026-10-28).
// The tab's button, its middle-click and a stopped tab's strip row button, which a needs-you mark lists it by, are one press, so all three follow it.
const one = session({ id: '00000000-0000-4000-8000-0000000000c1', title: 'Set aside' });
const archiving = settingsFileWith('settings.json', { stoppedTabButton: 'archive' });
const fixture = { sessions: [one], openSessions: [one.id], history: { [one.id]: [] } };

const button = (page: Page): Locator => tab(page, one.title).locator('.tab-close');

/** The tab and the row gone, and the session archived once. */
async function archived(app: App, page: Page): Promise<void> {
  await expect(tab(page, one.title)).toHaveCount(0);
  await expect(row(page, one.title)).toHaveCount(0);
  expect(await app.calls('archive')).toEqual([[one.id]]);
  expect(await app.calls('startTerminal')).toEqual([]);
}

test("a stopped tab's button closes it unless the settings say otherwise", async ({ app, page }) => {
  await app.boot(fixture);
  await expect(button(page)).toHaveAttribute('data-mark', 'close');
  await expect(button(page)).toHaveAttribute('data-tooltip', 'Close tab');
  await button(page).click();
  await expect(tab(page, one.title)).toHaveCount(0);
  expect(await app.calls('archive')).toEqual([]);
});

test("with stoppedTabButton archive, a stopped tab's button archives its session", async ({ app, page }) => {
  await app.boot({ ...fixture, settings: archiving });
  await expect(button(page)).toHaveAttribute('data-mark', 'archive');
  await expect(button(page)).toHaveAttribute('data-tooltip', 'Archive');
  await button(page).click();
  await archived(app, page);
});

test("with stoppedTabButton archive, a middle-click on a stopped tab archives its session", async ({ app, page }) => {
  await app.boot({ ...fixture, settings: archiving });
  await tabLabel(page, one.title).click({ button: 'middle' });
  await archived(app, page);
});

test("with stoppedTabButton archive, a stopped tab's strip row button archives its session", async ({ app, page }) => {
  await app.boot({ ...fixture, settings: archiving, needsYou: { [one.id]: { reason: 'quit', at: 1 } } });
  const stop = stripRow(page, one.title).locator('.strip-item-stop');
  await expect(stop).toHaveAttribute('data-mark', 'archive');
  await stop.click();
  await archived(app, page);
});

test("with stoppedTabButton archive, a running tab's button still stops it, and keeps the tab", async ({ app, page }) => {
  await app.boot({ ...fixture, settings: archiving });
  await tabLabel(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await expect(button(page)).toHaveAttribute('data-mark', 'stop');
  await button(page).click();
  expect(await app.emit('onTerminalExit', 1, 0)).toBe(1);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  expect(await app.calls('archive')).toEqual([]);
  await expect(button(page)).toHaveAttribute('data-mark', 'archive');
});

test("a change to the setting redraws the button at once", async ({ app, page }) => {
  await app.boot(fixture);
  await expect(button(page)).toHaveAttribute('data-mark', 'close');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const choice = dialog.getByRole('combobox', { name: 'Button on a stopped tab' });
  await expect(choice.locator('option')).toHaveText(['Close the tab', 'Archive the session']);
  await expect(choice).toHaveValue('close');
  await choice.selectOption('archive');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.__claudeUiFixture.settings.json)).toEqual({ stoppedTabButton: 'archive' });
  await expect(button(page)).toHaveAttribute('data-mark', 'archive');
});
