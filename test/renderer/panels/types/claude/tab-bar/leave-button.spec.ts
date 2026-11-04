import type { Locator, Page } from '@playwright/test';
import { session, settingsFileWith } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { row, stripRow, tab, tabLabel } from '../../../../support/window';

// What a tab's button does is a setting, `leaveButton`: stop a running session and then close the tab, as it did before there was a setting, or archive its session (decided 2026-10-28); close or archive in one press, claude asked to leave first; or no button, leaving it all to the tab's menu (decided 2026-11-03).
// The tab's button, its middle-click and its strip row button, which a needs-you mark lists it by, are one press, so all three follow it.
const one = session({ id: '00000000-0000-4000-8000-0000000000c1', title: 'Set aside' });
const choosing = (leaveButton: string): ReturnType<typeof settingsFileWith> => settingsFileWith('settings.json', { leaveButton });
const fixture = { sessions: [one], openSessions: [one.id], history: { [one.id]: [] } };
const quit = { needsYou: { [one.id]: [{ reason: 'quit' as const, at: 1 }] } };

const button = (page: Page): Locator => tab(page, one.title).locator('.tab-close');
const stripButton = (page: Page): Locator => stripRow(page, one.title).locator('.strip-item-stop');

/** The tab and the row gone, and the session archived once. */
async function archived(app: App, page: Page): Promise<void> {
  await expect(tab(page, one.title)).toHaveCount(0);
  await expect(row(page, one.title)).toHaveCount(0);
  expect(await app.calls('archive')).toEqual([[[one.id]]]);
}

/** Start the tab's session, by selecting it. */
async function started(app: App, page: Page): Promise<void> {
  await tabLabel(page, one.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
}

test("a stopped tab's button closes it unless the settings say otherwise", async ({ app, page }) => {
  await app.boot(fixture);
  await expect(button(page)).toHaveAttribute('data-mark', 'close');
  await expect(button(page)).toHaveAttribute('data-tooltip', 'Close tab');
  await button(page).click();
  await expect(tab(page, one.title)).toHaveCount(0);
  expect(await app.calls('archive')).toEqual([]);
});

test("with leaveButton stop-archive, a stopped tab's button archives its session", async ({ app, page }) => {
  await app.boot({ ...fixture, settings: choosing('stop-archive') });
  await expect(button(page)).toHaveAttribute('data-mark', 'archive');
  await expect(button(page)).toHaveAttribute('data-tooltip', 'Archive');
  await button(page).click();
  await archived(app, page);
  expect(await app.calls('startTerminal')).toEqual([]);
});

test("with leaveButton stop-archive, a middle-click on a stopped tab archives its session", async ({ app, page }) => {
  await app.boot({ ...fixture, settings: choosing('stop-archive') });
  await tabLabel(page, one.title).click({ button: 'middle' });
  await archived(app, page);
});

test("with leaveButton stop-archive, a stopped tab's strip row button archives its session", async ({ app, page }) => {
  await app.boot({ ...fixture, settings: choosing('stop-archive'), ...quit });
  await expect(stripButton(page)).toHaveAttribute('data-mark', 'archive');
  await stripButton(page).click();
  await archived(app, page);
});

test("with leaveButton stop-archive, a running tab's button still stops it, and keeps the tab", async ({ app, page }) => {
  await app.boot({ ...fixture, settings: choosing('stop-archive') });
  await started(app, page);
  await expect(button(page)).toHaveAttribute('data-mark', 'stop');
  await button(page).click();
  expect(await app.emit('onTerminalExit', 1, 0)).toBe(1);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  expect(await app.calls('archive')).toEqual([]);
  await expect(button(page)).toHaveAttribute('data-mark', 'archive');
});

test("with leaveButton close, a running tab's button asks claude to leave and closes the tab once it has", async ({ app, page }) => {
  await app.boot({ ...fixture, settings: choosing('close') });
  await started(app, page);
  await expect(button(page)).toHaveAttribute('data-mark', 'close');
  await button(page).click();
  await expect.poll(() => app.calls('closeTerminal')).toHaveLength(1);
  await expect(tab(page, one.title)).toHaveCount(1);
  expect(await app.emit('onTerminalExit', 1, 0)).toBe(1);
  await expect(tab(page, one.title)).toHaveCount(0);
  expect(await app.calls('archive')).toEqual([]);
});

test("with leaveButton archive, a middle-click on a running tab archives its session once claude has left", async ({ app, page }) => {
  await app.boot({ ...fixture, settings: choosing('archive') });
  await started(app, page);
  await tabLabel(page, one.title).click({ button: 'middle' });
  await expect.poll(() => app.calls('closeTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalExit', 1, 0)).toBe(1);
  await archived(app, page);
});

test("with leaveButton archive, a running tab's strip row button archives it in one press", async ({ app, page }) => {
  await app.boot({ ...fixture, settings: choosing('archive'), ...quit });
  await started(app, page);
  await expect(stripButton(page)).toHaveAttribute('data-mark', 'archive');
  await stripButton(page).click();
  await expect.poll(() => app.calls('closeTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalExit', 1, 0)).toBe(1);
  await archived(app, page);
});

test('with leaveButton none, a tab and its strip row have no button, its kebab ends them, and a middle-click does nothing', async ({ app, page }) => {
  await app.boot({ ...fixture, settings: choosing('none'), ...quit });
  await expect(tab(page, one.title).locator('.tab-kebab')).toBeVisible();
  await expect(button(page)).toHaveCount(0);
  await expect(tab(page, one.title).locator('.tab-kebab')).not.toHaveClass(/\babuts\b/);
  await expect(stripRow(page, one.title).locator('.strip-item-kebab')).toBeVisible();
  await expect(stripButton(page)).toBeHidden();
  await expect(stripRow(page, one.title).locator('.strip-item-kebab')).not.toHaveClass(/\babuts\b/);
  await started(app, page);
  await tabLabel(page, one.title).click({ button: 'middle' });
  await expect(tab(page, one.title)).toHaveCount(1);
  expect(await app.calls('closeTerminal')).toEqual([]);
});

test('a change to the setting redraws the button at once', async ({ app, page }) => {
  await app.boot(fixture);
  await expect(button(page)).toHaveAttribute('data-mark', 'close');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  const choice = dialog.getByRole('combobox', { name: 'Leave button' });
  await expect(choice.locator('option')).toHaveText(['Stop, then close the tab', 'Stop, then archive the session', 'Close the tab', 'Archive the session', 'No button, only the menu']);
  await expect(choice).toHaveValue('stop-close');
  await choice.selectOption('none');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.__claudeUiFixture.settings.json)).toEqual({ leaveButton: 'none' });
  await expect(button(page)).toHaveCount(0);
});
