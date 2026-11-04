import type { Locator, Page } from '@playwright/test';
import { PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { groupHeading, projectHeading, row } from '../../../../support/window';

// Selecting several (docs/architecture.md § Selecting several): Select sessions… in a heading's menu, or Select… in a row's, puts the list in bulk mode with those rows ticked; a press on a row then ticks it rather than opening it, a Shift+press ticks a run, a heading's box ticks every row under it, and Done or Esc in the list ends it.
const a = session({ id: '00000000-0000-4000-8000-0000000000a1', title: 'Alpha', lastActivity: '2026-09-30T10:00:00.000Z' });
const b = session({ id: '00000000-0000-4000-8000-0000000000a2', title: 'Bravo', lastActivity: '2026-09-30T09:00:00.000Z' });
const c = session({ id: '00000000-0000-4000-8000-0000000000a3', title: 'Charlie', lastActivity: '2026-09-30T08:00:00.000Z' });
const d = session({ id: '00000000-0000-4000-8000-0000000000a4', title: 'Delta', lastActivity: '2026-09-30T07:00:00.000Z' });
const groupState = { groups: [{ id: 'g-work', name: 'Work', repoRoot: PROJECT }], groupOf: { [a.id]: 'g-work', [b.id]: 'g-work' } };
const fixture = { sessions: [a, b, c, d], groupState, history: { [a.id]: [], [b.id]: [], [c.id]: [], [d.id]: [] } };

const line = (page: Page): Locator => page.locator('#bulk-line');
const box = (scope: Locator): Locator => scope.locator(':scope > .tick');
const ticked = (page: Page): Promise<string[]> => page.locator('#sessions .session:has(> .tick.on) .card-title').allTextContents();

async function headingMenu(page: Page, heading: Locator, kebab: string, item: string): Promise<Locator> {
  await heading.locator(kebab).click();
  return page.locator('.kebab-menu:not(.submenu) button.menu-row', { hasText: new RegExp(`^${item}$`) });
}

test("a group's Select sessions… ticks its rows and only them, and a press on a row then ticks it and opens nothing", async ({ app, page }) => {
  await app.boot(fixture);
  await expect(box(row(page, a.title))).toBeHidden();
  await (await headingMenu(page, groupHeading(page, 'Work'), '.group-kebab', 'Select sessions…')).click();
  await expect(line(page)).toBeVisible();
  await expect(line(page).locator('.bulk-count')).toHaveText('2 ticked');
  expect(await ticked(page)).toEqual([a.title, b.title]);
  await expect(box(groupHeading(page, 'Work'))).toHaveAttribute('aria-checked', 'true');
  await expect(box(projectHeading(page, 'demo'))).toHaveAttribute('aria-checked', 'mixed');

  await row(page, c.title).click();
  expect(await ticked(page)).toEqual([a.title, b.title, c.title]);
  await row(page, a.title).click();
  expect(await ticked(page)).toEqual([b.title, c.title]);
  expect(await app.calls('startTerminal')).toEqual([]);
});

test("a Shift+press ticks the run from the row last pressed, and a heading's box ticks or unticks every row under it", async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, a.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button.menu-row', { hasText: /^Select…$/ }).click();
  expect(await ticked(page)).toEqual([a.title]);
  await row(page, d.title).click({ modifiers: ['Shift'] });
  expect(await ticked(page)).toEqual([a.title, b.title, c.title, d.title]);

  await box(projectHeading(page, 'demo')).click();
  expect(await ticked(page)).toEqual([]);
  await box(groupHeading(page, 'Work')).click();
  expect(await ticked(page)).toEqual([a.title, b.title]);
  // The box ticks; it does not fold the group.
  await expect(row(page, a.title)).toBeVisible();
});

test('Done, and Esc in the list, end bulk mode', async ({ app, page }) => {
  await app.boot(fixture);
  await (await headingMenu(page, projectHeading(page, 'demo'), '.project-kebab', 'Select sessions…')).click();
  await expect(line(page).locator('.bulk-count')).toHaveText('4 ticked');
  await page.locator('#bulk-done').click();
  await expect(line(page)).toBeHidden();
  await expect(page.locator('#bulk-bar')).toBeHidden();
  await expect(box(row(page, a.title))).toBeHidden();

  await (await headingMenu(page, projectHeading(page, 'demo'), '.project-kebab', 'Select sessions…')).click();
  await row(page, a.title).click();
  await page.keyboard.press('Escape');
  await expect(line(page)).toBeHidden();
  // Out of bulk mode a press opens the session again.
  await row(page, c.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
});

test('Esc typed in a terminal is claude\'s, and leaves bulk mode on', async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, c.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await (await headingMenu(page, groupHeading(page, 'Work'), '.group-kebab', 'Select sessions…')).click();
  await page.locator('.xterm-helper-textarea').first().focus();
  await page.keyboard.press('Escape');
  await expect(line(page)).toBeVisible();
});

test('a search that hides a ticked row takes it out of the count, so the bar never acts on a row out of sight', async ({ app, page }) => {
  await app.boot(fixture);
  await (await headingMenu(page, groupHeading(page, 'Work'), '.group-kebab', 'Select sessions…')).click();
  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill('Alpha');
  await expect(line(page).locator('.bulk-count')).toHaveText('1 ticked');
  await page.locator('#bulk-bar [data-act="archive"]').click();
  await expect.poll(() => app.calls('archive')).toEqual([[[a.id]]]);
});

test('the archived view offers no Select, and turning it on ends bulk mode', async ({ app, page }) => {
  await app.boot({ ...fixture, archived: { [d.id]: 1 } });
  await (await headingMenu(page, groupHeading(page, 'Work'), '.group-kebab', 'Select sessions…')).click();
  await page.locator('#filter-toggle').click();
  await page.locator('#archived-filter').click();
  await expect(line(page)).toBeHidden();
  const item = await headingMenu(page, projectHeading(page, 'demo'), '.project-kebab', 'Select sessions…');
  await expect(item).toHaveAttribute('data-tooltip', 'Not in the archived view');
});
