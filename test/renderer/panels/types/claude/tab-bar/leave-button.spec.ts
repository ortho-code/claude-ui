import type { Locator, Page } from '@playwright/test';
import { session, settingsFileWith } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { row, stripRow, tab, tabLabel } from '../../../../support/window';

// What a tab's button does is a setting, `leaveButton`: stop a running session and then close the tab, as it did before there was a setting, or mark its session finished (decided 2026-10-28); close or finish in one press, claude asked to leave first; or no button, leaving it all to the tab's menu (decided 2026-11-03).
// The tab's button, its middle-click and its strip row button, which a needs-you mark lists it by, are one press, so all three follow it.
const one = session({ id: '00000000-0000-4000-8000-0000000000c1', title: 'Set aside' });
const choosing = (leaveButton: string): ReturnType<typeof settingsFileWith> => settingsFileWith('settings.json', { leaveButton });
const fixture = { sessions: [one], openSessions: [one.id], history: { [one.id]: [] } };
const quit = { needsYou: { [one.id]: [{ type: 'app.was-running' as const, at: 1, how: 'quit' as const }] } };

const button = (page: Page): Locator => tab(page, one.title).locator('.tab-close');
const stripButton = (page: Page): Locator => stripRow(page, one.title).locator('.strip-item-stop');

/** The tab and the row gone, and the session finished once. */
async function finished(app: App, page: Page): Promise<void> {
  await expect(tab(page, one.title)).toHaveCount(0);
  await expect(row(page, one.title)).toHaveCount(0);
  expect(await app.calls('finish')).toEqual([[[one.id]]]);
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
  expect(await app.calls('finish')).toEqual([]);
});

test("with leaveButton stop-finish, a stopped tab's button finishes its session", async ({ app, page }) => {
  await app.boot({ ...fixture, settings: choosing('stop-finish') });
  await expect(button(page)).toHaveAttribute('data-mark', 'finish');
  await expect(button(page)).toHaveAttribute('data-tooltip', 'Finished');
  await button(page).click();
  await finished(app, page);
  expect(await app.calls('startTerminal')).toEqual([]);
});

test("with leaveButton stop-finish, a middle-click on a stopped tab finishes its session", async ({ app, page }) => {
  await app.boot({ ...fixture, settings: choosing('stop-finish') });
  await tabLabel(page, one.title).click({ button: 'middle' });
  await finished(app, page);
});

test("with leaveButton stop-finish, a stopped tab's strip row button finishes its session", async ({ app, page }) => {
  await app.boot({ ...fixture, settings: choosing('stop-finish'), ...quit });
  await expect(stripButton(page)).toHaveAttribute('data-mark', 'finish');
  await stripButton(page).click();
  await finished(app, page);
});

test("with leaveButton stop-finish, a running tab's button still stops it, and keeps the tab", async ({ app, page }) => {
  await app.boot({ ...fixture, settings: choosing('stop-finish') });
  await started(app, page);
  await expect(button(page)).toHaveAttribute('data-mark', 'stop');
  await button(page).click();
  expect(await app.emit('onTerminalExit', 1, 0)).toBe(1);
  await expect(tab(page, one.title)).toHaveClass(/\bcold\b/);
  expect(await app.calls('finish')).toEqual([]);
  await expect(button(page)).toHaveAttribute('data-mark', 'finish');
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
  expect(await app.calls('finish')).toEqual([]);
});

test("with leaveButton finish, a middle-click on a running tab finishes its session once claude has left", async ({ app, page }) => {
  await app.boot({ ...fixture, settings: choosing('finish') });
  await started(app, page);
  await tabLabel(page, one.title).click({ button: 'middle' });
  await expect.poll(() => app.calls('closeTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalExit', 1, 0)).toBe(1);
  await finished(app, page);
});

test("with leaveButton finish, a running tab's strip row button finishes it in one press", async ({ app, page }) => {
  await app.boot({ ...fixture, settings: choosing('finish'), ...quit });
  await started(app, page);
  await expect(stripButton(page)).toHaveAttribute('data-mark', 'finish');
  await stripButton(page).click();
  await expect.poll(() => app.calls('closeTerminal')).toHaveLength(1);
  expect(await app.emit('onTerminalExit', 1, 0)).toBe(1);
  await finished(app, page);
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
  await expect(choice.locator('option')).toHaveText(['Stop, then close the tab', 'Stop, then mark the session finished', 'Close the tab', 'Mark the session finished', 'No button, only the menu']);
  await expect(choice).toHaveValue('stop-close');
  await choice.selectOption('none');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.__claudeUiFixture.settings.json)).toEqual({ leaveButton: 'none' });
  await expect(button(page)).toHaveCount(0);
});
