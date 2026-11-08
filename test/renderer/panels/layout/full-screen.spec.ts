import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../support/harness';
import { row } from '../../support/window';
import { session } from '../../support/fixture';
import { here, keptChanges, LAYOUT, railItem, runs, withLayout } from './layout';

const sidebar = (page: Page): Locator => page.locator('#sidebar');
const terminalArea = (page: Page): Locator => page.locator('#terminal-pane');
const statusPanel = (page: Page): Locator => page.locator('.panel-content', { has: page.locator('.panel-header', { hasText: 'Status' }) });
const fullScreenIn = (scope: Locator): Locator => scope.getByRole('button', { name: 'Full screen' });
const backIn = (scope: Locator): Locator => scope.getByRole('button', { name: 'Back to the layout' });

test('a panel’s button fills the window with it, and the same button brings the layout back as it was, keeping nothing', async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT, { drawer: { folded: true } }));
  await expect(railItem(page, /^Status/)).toHaveClass(/\bshown\b/);

  await fullScreenIn(statusPanel(page)).click();
  await expect(statusPanel(page)).toBeVisible();
  await expect(sidebar(page)).toBeHidden();
  await expect(terminalArea(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Unfold drawer' })).toBeHidden();
  // The panel alone, without its group's rail to switch or fold from.
  await expect(page.locator('.panel-rail')).toBeHidden();
  await expect(backIn(statusPanel(page))).toHaveAttribute('aria-pressed', 'true');

  await backIn(statusPanel(page)).click();
  await expect(sidebar(page)).toBeVisible();
  await expect(terminalArea(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unfold drawer' })).toBeVisible();
  await expect(railItem(page, /^Status/)).toHaveClass(/\bshown\b/);
  await expect(fullScreenIn(statusPanel(page))).toHaveAttribute('aria-pressed', 'false');
  expect(await keptChanges(app)).toEqual([]);
});

test('a panel the layout adds while another fills the window waits behind it, and runs once the layout is back', async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT));
  await fullScreenIn(statusPanel(page)).click();
  await expect(sidebar(page)).toBeHidden();

  const added = structuredClone(LAYOUT);
  added.root.columns.push({ id: 'extra_group', size: '200px', collapsible: false, panels: [{ id: 'extra', type: 'command', title: 'Extra', icon: 'check', options: { command: 'make extra' } }] });
  await app.emit('onLayoutChanged', withLayout(added).layout);
  await expect(page.locator('.panel-header', { hasText: 'Extra' })).toHaveCount(1);
  await expect(page.locator('.panel-header', { hasText: 'Extra' })).toBeHidden();
  expect(await runs(app, 'extra')).toEqual([]);

  await backIn(statusPanel(page)).click();
  await expect.poll(() => runs(app, 'extra')).toHaveLength(1);
});

test('the session list fills the window from a button among its header’s actions', async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT));
  await fullScreenIn(sidebar(page).locator('.header-actions')).click();
  await expect(sidebar(page)).toBeVisible();
  await expect(terminalArea(page)).toBeHidden();
  await expect(statusPanel(page)).toBeHidden();

  await backIn(sidebar(page)).click();
  await expect(terminalArea(page)).toBeVisible();
  await expect(statusPanel(page)).toBeVisible();
});

test('the terminal area fills the window from a button at the end of its tab bar', async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT));
  await fullScreenIn(terminalArea(page).locator('.tabbar-end')).click();
  await expect(terminalArea(page)).toBeVisible();
  await expect(sidebar(page)).toBeHidden();
  await expect(statusPanel(page)).toBeHidden();

  await backIn(terminalArea(page)).click();
  await expect(sidebar(page)).toBeVisible();
});

test('opening a session from the session list filling the window brings the layout back, so its tab is in view', async ({ app, page }) => {
  await app.boot({ ...withLayout(LAYOUT), history: { [here.id]: [] } });
  await fullScreenIn(sidebar(page)).click();
  await expect(terminalArea(page)).toBeHidden();

  await row(page, here.title).click();
  await expect(terminalArea(page)).toBeVisible();
  await expect(fullScreenIn(sidebar(page))).toHaveAttribute('aria-pressed', 'false');
});

test('a toast’s click on a tab not on show brings the layout back while the session list fills the window, so the tab is in view', async ({ app, page }) => {
  const second = session({ id: '00000000-0000-4000-8000-0000000000d2', title: 'Second here' });
  await app.boot({ ...withLayout(LAYOUT), sessions: [here, second], openSessions: [here.id, second.id], activeSession: here.id, history: { [here.id]: [], [second.id]: [] } });
  await fullScreenIn(sidebar(page)).click();
  await expect(terminalArea(page)).toBeHidden();

  expect(await app.emit('onSessionStatus', second.id, 'waiting', '', '')).toBe(1);
  await page.locator('#notifications .notif', { hasText: second.title }).click();
  await expect(terminalArea(page)).toBeVisible();
  await expect(terminalArea(page).locator('.tab', { hasText: second.title })).toHaveClass(/\bactive\b/);
});

test('switching tabs in the terminal area filling the window keeps it full screen', async ({ app, page }) => {
  const second = session({ id: '00000000-0000-4000-8000-0000000000d2', title: 'Second here' });
  await app.boot({ ...withLayout(LAYOUT), sessions: [here, second], openSessions: [here.id, second.id], activeSession: here.id, history: { [here.id]: [], [second.id]: [] } });
  await fullScreenIn(terminalArea(page)).click();
  await expect(sidebar(page)).toBeHidden();

  await terminalArea(page).locator('.tab', { hasText: second.title }).click();
  await expect(terminalArea(page).locator('.tab', { hasText: second.title })).toHaveClass(/\bactive\b/);
  await expect(sidebar(page)).toBeHidden();
  await expect(backIn(terminalArea(page))).toBeVisible();
});

test('a panel taken out of the layout while it fills the window brings the layout back', async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT));
  await fullScreenIn(statusPanel(page)).click();
  await expect(sidebar(page)).toBeHidden();

  const without = { ...LAYOUT, root: { ...LAYOUT.root, columns: LAYOUT.root.columns.map((column) => (column.id === 'right' ? { ...column, panels: column.panels?.filter((panel) => panel.id !== 'status') } : column)) } };
  await app.emit('onLayoutChanged', withLayout(without).layout);
  await expect(sidebar(page)).toBeVisible();
  await expect(terminalArea(page)).toBeVisible();
  // Its group's other panel takes its place, and is on show, so it runs.
  await expect.poll(() => runs(app, 'checks')).toHaveLength(1);
});
