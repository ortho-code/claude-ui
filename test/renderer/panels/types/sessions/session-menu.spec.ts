import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../../src/shared/defaults';
import { HOME, PROJECT, session } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { chooseProject, row, stripRow, tab, tabLabel } from '../../../support/window';

// A session's menu opens with what the session is, on every surface that has its kebab, so a tab and the strip, which say less than its row, still show its title, place, status, activity, worktree and note.
const full = session({ title: 'Fix the tab drag', worktree: 'feat-drag' });
const fixture = {
  sessions: [full],
  openSessions: [full.id],
  history: { [full.id]: [] },
  notes: { [full.id]: 'Check it on a mac\nand on linux' },
  groupState: { groups: [{ id: 'g-bugs', name: 'Bugs', repoRoot: PROJECT }], groupOf: { [full.id]: 'g-bugs' } },
};

const header = (page: Page): Locator => page.locator('.kebab-menu .menu-header');
const lines = (page: Page): Locator => header(page).locator('.menu-header-line');

for (const [surface, kebab] of [
  ['row', (page: Page) => row(page, full.title).locator('.session-kebab')],
  ['tab', (page: Page) => tab(page, full.title).locator('.tab-kebab')],
  ['strip item', (page: Page) => stripRow(page, full.title).locator('.strip-item-kebab')],
] as const) {
  test(`a session's menu on its ${surface} opens with its title, where it is filed, its status, its activity, its worktree and its note`, async ({ app, page }) => {
    await app.boot(fixture);
    // Started, since running (or a paused tab) is what puts a session in the strip, and then waiting for you.
    await tabLabel(page, full.title).click();
    await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
    expect(await app.emit('onSessionStatus', full.id, 'waiting', '', '')).toBe(1);
    const meta = await row(page, full.title).locator('.meta-text').textContent();
    await kebab(page).click();
    await expect(lines(page)).toHaveText([full.title, 'demo · Bugs · Waiting for you', meta!, 'Linked git worktree: feat-drag', 'Check it on a mac']);
    // Outside the archived view, the row's meta line and the header's are one rule.
    expect(meta).toMatch(/ · Opus 5\.5$/);
  });
}

test("a session's menu header is not an item: a click on it leaves the menu up", async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, full.title).locator('.session-kebab').click();
  await header(page).click();
  await expect(header(page)).toBeVisible();
});

test("a session whose folder is gone says why in its menu's header", async ({ app, page }) => {
  const gone = session({ title: 'Gone', cwdExists: false, repoRootExists: false });
  await app.boot({ sessions: [gone] });
  const reason = await row(page, gone.title).locator('.card-title').getAttribute('data-tooltip');
  await row(page, gone.title).locator('.session-kebab').click();
  await expect(lines(page).last()).toHaveText(reason!);
});

// Everything a press on a surface does is in the session's menu there too; what would be the surface itself is not.
const item = (page: Page, label: string): Locator => page.locator('.kebab-menu button.menu-row').filter({ hasText: new RegExp(`^${label}$`) });
const OTHER = `${HOME}/projects/other`;
const elsewhere = session({ id: '00000000-0000-4000-8000-0000000000f1', title: 'In other', cwd: OTHER, repoRoot: OTHER });

test("Open in a row's menu opens its tab, as a press on the row does", async ({ app, page }) => {
  await app.boot({ sessions: [full], history: { [full.id]: [] } });
  await row(page, full.title).locator('.session-kebab').click();
  await item(page, 'Open').click();
  await expect(tab(page, full.title)).toHaveClass(/\bactive\b/);
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
});

test("Open in a strip row's menu takes you to its session in another project, as a press on the strip row does", async ({ app, page }) => {
  await app.boot({ sessions: [full, elsewhere], projectOrder: [PROJECT, OTHER], activeProject: null, openSessions: [full.id, elsewhere.id], history: { [full.id]: [], [elsewhere.id]: [] } });
  await tabLabel(page, elsewhere.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await chooseProject(page, 'demo');
  await stripRow(page, elsewhere.title).locator('.strip-item-kebab').click();
  await item(page, 'Open').click();
  await expect(page.locator('#switcher-name')).toHaveText('other');
  await expect(tab(page, elsewhere.title)).toHaveClass(/\bactive\b/);
});

test("a running tab's menu has no Open, since the tab is the session", async ({ app, page }) => {
  await app.boot(fixture);
  await tabLabel(page, full.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await tab(page, full.title).locator('.tab-kebab').click();
  await expect(item(page, 'Fork this session')).toBeVisible();
  await expect(item(page, 'Open')).toHaveCount(0);
});

// Selecting a cold or paused tab is what starts it, so its menu offers that too.
for (const [state, paused] of [['cold', []], ['paused', [full.id]]] as const) {
  test(`Open in a ${state} tab's menu starts its session`, async ({ app, page }) => {
    await app.boot({ ...fixture, pausedSessions: [...paused] });
    await tab(page, full.title).locator('.tab-kebab').click();
    await item(page, 'Open').click();
    await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
    await expect(tab(page, full.title)).toHaveClass(/\bactive\b/);
  });
}

test("Show in list in a strip row's menu widens the list to All and unfolds its group, leaving the tab on show where it is", async ({ app, page }) => {
  await app.boot({
    ...fixture,
    sessions: [full, elsewhere],
    projectOrder: [PROJECT, OTHER],
    activeProject: null,
    openSessions: [full.id, elsewhere.id],
    history: { [full.id]: [], [elsewhere.id]: [] },
    uiState: { ...defaultUi(), collapsedGroups: ['g-bugs'] },
  });
  await tabLabel(page, full.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await tabLabel(page, elsewhere.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  await chooseProject(page, 'other');
  await expect(row(page, full.title)).toHaveCount(0);

  await stripRow(page, full.title).locator('.strip-item-kebab').click();
  await item(page, 'Show in list').click();
  await expect(page.locator('#switcher-name')).toHaveText('All');
  await expect(row(page, full.title)).toBeVisible();
  // The tab you were in stays on show: All holds every tab.
  await expect(tab(page, elsewhere.title)).toHaveClass(/\bactive\b/);
});

test('Show in list says so when a filter leaves the session out', async ({ app, page }) => {
  await app.boot(fixture);
  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill('nothing matches this');
  await expect(row(page, full.title)).toHaveCount(0);
  await tab(page, full.title).locator('.tab-kebab').click();
  await item(page, 'Show in list').click();
  await expect(page.locator('#toast-message')).toHaveText(`"${full.title}" is left out by the filter. Clear it to see its row.`);
});

// An archived session can still have a tab, a sibling opened from another's menu for one; the list leaves it out with no filter on.
test('Show in list says an archived session is in the archived view, not that a filter left it out', async ({ app, page }) => {
  await app.boot({ ...fixture, archived: { [full.id]: Date.parse('2026-10-01T08:00:00.000Z') } });
  await expect(row(page, full.title)).toHaveCount(0);
  await tab(page, full.title).locator('.tab-kebab').click();
  await item(page, 'Show in list').click();
  await expect(page.locator('#toast-message')).toHaveText(`"${full.title}" is archived. The archived view lists it.`);
});

test("a row's menu has no Show in list, since the row is what it would show", async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, full.title).locator('.session-kebab').click();
  await expect(item(page, 'Open')).toBeVisible();
  await expect(item(page, 'Show in list')).toHaveCount(0);
});

test("Pin in list in a tab's menu pins its row, as the row's pin does, and the menu then offers Unpin", async ({ app, page }) => {
  await app.boot(fixture);
  await tab(page, full.title).locator('.tab-kebab').click();
  await item(page, 'Pin in list').click();
  await expect(row(page, full.title).locator('.pin')).toHaveAttribute('data-tooltip', 'Unpin');
  await tab(page, full.title).locator('.tab-kebab').click();
  await item(page, 'Unpin').click();
  await expect(row(page, full.title).locator('.pin')).toHaveAttribute('data-tooltip', 'Pin');
  expect(await app.calls('togglePin')).toEqual([[full.id], [full.id]]);
});

test("Mark as read in a strip row's menu marks the session read, as a click on its dot does, and the menu then offers Mark as unread", async ({ app, page }) => {
  await app.boot(fixture);
  await tabLabel(page, full.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onSessionStatus', full.id, 'waiting', '', '')).toBe(1);
  await stripRow(page, full.title).locator('.strip-item-kebab').click();
  await item(page, 'Mark as read').click();
  await expect(row(page, full.title).locator('.nudge')).toHaveClass(/\backed\b/);
  await stripRow(page, full.title).locator('.strip-item-kebab').click();
  await item(page, 'Mark as unread').click();
  await expect(row(page, full.title).locator('.nudge')).not.toHaveClass(/\backed\b/);
});

test('Mark as read is unavailable, with the reason, while the session is busy', async ({ app, page }) => {
  await app.boot(fixture);
  await tabLabel(page, full.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onSessionStatus', full.id, 'busy', '', '')).toBe(1);
  await tab(page, full.title).locator('.tab-kebab').click();
  await expect(item(page, 'Mark as read')).toHaveClass(/\bunavailable\b/);
  await expect(item(page, 'Mark as read')).toHaveAttribute('data-tooltip', 'Only a session that is idle or waiting for you can be marked read or unread');
});

// The tab's button, pressed from the session's menu: one rule for the two (`tabButtonState`), so the item says and does what the button would.
test("Stop session in a row's menu stops it as the tab's button does, and then says it is stopping", async ({ app, page }) => {
  await app.boot(fixture);
  await tabLabel(page, full.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await row(page, full.title).locator('.session-kebab').click();
  await item(page, 'Stop session').click();
  await expect(tab(page, full.title).locator('.tab-close')).toBeDisabled();
  await row(page, full.title).locator('.session-kebab').click();
  await expect(item(page, 'Stop session')).toHaveAttribute('data-tooltip', 'Stopping…');
});

test("Close tab in a row's menu closes a paused session's tab", async ({ app, page }) => {
  await app.boot({ ...fixture, pausedSessions: [full.id] });
  await row(page, full.title).locator('.session-kebab').click();
  await item(page, 'Close tab').click();
  await expect(tab(page, full.title)).toHaveCount(0);
  expect(await app.calls('startTerminal')).toEqual([]);
});

test('Close tab is unavailable, with the reason, for a session with no tab', async ({ app, page }) => {
  await app.boot({ sessions: [full] });
  await row(page, full.title).locator('.session-kebab').click();
  await expect(item(page, 'Close tab')).toHaveClass(/\bunavailable\b/);
  await expect(item(page, 'Close tab')).toHaveAttribute('data-tooltip', 'Not open in a tab');
});

test("Open is unavailable, with the reason, for a session whose folder is gone", async ({ app, page }) => {
  const gone = session({ title: 'Gone', cwdExists: false, repoRootExists: false });
  await app.boot({ sessions: [gone] });
  const reason = await row(page, gone.title).locator('.card-title').getAttribute('data-tooltip');
  await row(page, gone.title).locator('.session-kebab').click();
  await expect(item(page, 'Open')).toHaveClass(/\bunavailable\b/);
  await expect(item(page, 'Open')).toHaveAttribute('data-tooltip', reason!);
  await item(page, 'Open').click({ force: true });
  expect(await app.calls('startTerminal')).toEqual([]);
});
