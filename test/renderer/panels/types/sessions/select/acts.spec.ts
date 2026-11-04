import type { Locator, Page } from '@playwright/test';
import { HOME, PROJECT, session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { hoveredAndOpen } from '../../../../support/looks';
import { groupHeading, projectHeading, row, tab, tabs } from '../../../../support/window';

// The bar of selecting several acts on every ticked row on show, each act through the write a session's menu makes, given every key at once (docs/architecture.md § Selecting several).
// Archive, Later and Close tab each raise one toast for the batch, whose Undo puts every one back as it was.
const a = session({ id: '00000000-0000-4000-8000-0000000000c1', title: 'Alpha', lastActivity: '2026-09-30T10:00:00.000Z' });
const b = session({ id: '00000000-0000-4000-8000-0000000000c2', title: 'Bravo', lastActivity: '2026-09-30T09:00:00.000Z' });
const c = session({ id: '00000000-0000-4000-8000-0000000000c3', title: 'Charlie', lastActivity: '2026-09-30T08:00:00.000Z' });
const OTHER = `${HOME}/projects/other`;
const elsewhere = session({ id: '00000000-0000-4000-8000-0000000000c4', title: 'Elsewhere', cwd: OTHER, repoRoot: OTHER, lastActivity: '2026-09-30T07:00:00.000Z' });
const groupState = { groups: [{ id: 'g-work', name: 'Work', repoRoot: PROJECT }, { id: 'g-later', name: 'Later on', repoRoot: PROJECT }], groupOf: { [a.id]: 'g-work', [b.id]: 'g-work' } };
const fixture = { sessions: [a, b, c, elsewhere], groupState, history: { [a.id]: [], [b.id]: [], [c.id]: [], [elsewhere.id]: [] } };

const act = (page: Page, name: string): Locator => page.locator(`#bulk-bar [data-act="${name}"]`);
const toast = (page: Page): Locator => page.locator('#toast-message');
const undo = (page: Page): Locator => page.locator('#toast-action');

async function selectGroup(page: Page, name: string): Promise<void> {
  await groupHeading(page, name).locator('.group-kebab').click();
  await page.locator('.kebab-menu:not(.submenu) button.menu-row', { hasText: /^Select sessions…$/ }).click();
}

/** Start a session's row and let claude print, so its tab is live: the stand-in numbers ptys from 1. */
async function startLive(page: Page, app: App, title: string, pty: number): Promise<void> {
  await row(page, title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(pty);
  expect(await app.emit('onTerminalData', pty, 'claude is here')).toBe(1);
}

test('Archive archives every ticked session in one write, with one toast whose Undo brings each back with its later mark', async ({ app, page }) => {
  await app.boot({ ...fixture, later: { [a.id]: { due: null, at: 5 } } });
  await selectGroup(page, 'Work');
  await act(page, 'archive').click();
  await expect(toast(page)).toHaveText('Archived 2 sessions');
  expect(await app.calls('archive')).toEqual([[[a.id, b.id]]]);
  await expect(row(page, a.title)).toHaveCount(0);
  await expect(row(page, b.title)).toHaveCount(0);

  await undo(page).click();
  await expect(row(page, a.title)).toHaveCount(1);
  await expect(row(page, b.title)).toHaveCount(1);
  expect(await app.calls('unarchive')).toEqual([[[a.id, b.id]]]);
  await expect(row(page, a.title).locator('.later-mark')).toBeVisible();
  await expect(row(page, b.title).locator('.later-mark')).toBeHidden();
});

test("Later marks every ticked session in one write, and Undo puts back the mark one had before and none on the other", async ({ app, page }) => {
  await app.boot({ ...fixture, later: { [a.id]: { due: null, at: 5 } } });
  await selectGroup(page, 'Work');
  await act(page, 'later').click();
  await page.locator('.kebab-menu button.menu-row', { hasText: /^Tomorrow/ }).click();
  const [[ids, due]] = (await app.calls('markLater')) as [string[], number][];
  expect(ids).toEqual([a.id, b.id]);
  expect(due).toBeGreaterThan(0);
  await expect(toast(page)).toHaveText(/^Set 2 sessions aside for later, until /);

  await undo(page).click();
  await expect(row(page, a.title).locator('.later-mark')).toBeVisible();
  await expect(row(page, b.title).locator('.later-mark')).toBeHidden();
  expect(await app.calls('clearLater')).toEqual([[[b.id]]]);
});

test('Move to group moves every ticked session in one write, and is unavailable with sessions of two projects ticked', async ({ app, page }) => {
  // All, so the other project's session is in the list too.
  await app.boot({ ...fixture, activeProject: null });
  await selectGroup(page, 'Work');
  await row(page, c.title).click();
  await act(page, 'move').click();
  await page.locator('.kebab-menu button.menu-row', { hasText: /^Later on$/ }).click();
  await expect.poll(() => app.calls('moveSessionsToGroup')).toEqual([[[a.id, b.id, c.id], 'g-later']]);

  await row(page, elsewhere.title).click();
  await expect(act(page, 'move')).toHaveAttribute('data-tooltip', 'The ticked sessions are in more than one project');
  // Unavailable by `aria-disabled`, so the press is forced through to show it does nothing.
  await act(page, 'move').click({ force: true });
  await expect(page.locator('.kebab-menu')).toHaveCount(0);
});

test('Stop stops every ticked session that runs, and leaves one already stopping unforced', async ({ app, page }) => {
  await app.boot(fixture);
  await startLive(page, app, a.title, 1);
  await startLive(page, app, b.title, 2);
  await startLive(page, app, c.title, 3);
  // Alpha is already asked to stop, from its own menu.
  await row(page, a.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button.menu-row', { hasText: /^Stop session$/ }).click();
  await expect.poll(async () => (await app.calls('closeTerminal')).map(([id]) => id)).toEqual([1]);

  await projectHeading(page, 'demo').locator('.project-kebab').click();
  await page.locator('.kebab-menu:not(.submenu) button.menu-row', { hasText: /^Select sessions…$/ }).click();
  await act(page, 'stop').click();
  await expect.poll(async () => (await app.calls('closeTerminal')).map(([id]) => id)).toEqual([1, 2, 3]);
  expect(await app.calls('killTerminal')).toEqual([]);
});

test('Close tab closes every ticked tab, and one Undo brings the cold ones back', async ({ app, page }) => {
  await app.boot({ ...fixture, openSessions: [a.id, b.id, c.id] });
  await expect(tabs(page)).toHaveCount(3);
  await selectGroup(page, 'Work');
  await act(page, 'close').click();
  await expect(toast(page)).toHaveText('Closed 2 tabs');
  await expect(tabs(page)).toHaveCount(1);
  await expect(tab(page, c.title)).toHaveCount(1);
  await undo(page).click();
  await expect(tabs(page)).toHaveCount(3);
});

// Any control that opens a menu keeps its hover look while the menu is up (docs/architecture.md § UI conventions).
test("Later and Move to group keep their hover look while the menu they opened is up", async ({ app, page }) => {
  await app.boot(fixture);
  await selectGroup(page, 'Work');
  for (const name of ['later', 'move']) {
    const { hovered, open } = await hoveredAndOpen(page, act(page, name));
    expect(open).toEqual(hovered);
  }
});

test('Esc in a dialog an act opened closes the dialog and leaves bulk mode on', async ({ app, page }) => {
  await app.boot(fixture);
  await selectGroup(page, 'Work');
  await act(page, 'later').click();
  await page.locator('.kebab-menu button.menu-row', { hasText: /^Pick a date…$/ }).click();
  await expect(page.locator('#day-overlay')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#day-overlay')).toBeHidden();
  await expect(page.locator('#bulk-line')).toBeVisible();
});

test('Archive and Close tab are unavailable while every ticked session has a tab starting, since neither would do anything', async ({ app, page }) => {
  await app.boot(fixture);
  await app.hold('startTerminal');
  await row(page, c.title).click();
  await row(page, c.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button.menu-row', { hasText: /^Select…$/ }).click();
  await expect(act(page, 'archive')).toHaveAttribute('data-tooltip', 'Every ticked session is starting');
  await expect(act(page, 'close')).toHaveAttribute('data-tooltip', 'None of the ticked sessions has a tab to close now');
});

test('an act with nothing to act on is unavailable and says why', async ({ app, page }) => {
  await app.boot(fixture);
  await selectGroup(page, 'Work');
  await expect(act(page, 'stop')).toHaveAttribute('data-tooltip', 'None of the ticked sessions runs, or each is stopping already');
  await expect(act(page, 'close')).toHaveAttribute('data-tooltip', 'None of the ticked sessions has a tab');
  await row(page, a.title).click();
  await row(page, b.title).click();
  await expect(act(page, 'archive')).toHaveAttribute('data-tooltip', 'Nothing is ticked');
  await act(page, 'archive').click({ force: true });
  expect(await app.calls('archive')).toEqual([]);
});
