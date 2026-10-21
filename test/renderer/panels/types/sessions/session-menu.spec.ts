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
const item = (page: Page, label: string): Locator => page.locator('.kebab-menu button.menu-row').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
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

// An archived sibling stays in the list of siblings, unavailable and saying why: archived is put away, not opened.
test("an archived sibling in a session's menu is unavailable, saying it is archived", async ({ app, page }) => {
  const kept = session({ id: '00000000-0000-4000-8000-0000000000f2', title: 'Kept sibling', isSibling: true, siblingIds: ['00000000-0000-4000-8000-0000000000f3'] });
  const put = session({ id: '00000000-0000-4000-8000-0000000000f3', title: 'Archived sibling', isSibling: true, siblingIds: [kept.id] });
  await app.boot({ sessions: [kept, put], archived: { [put.id]: Date.parse('2026-10-01T08:00:00.000Z') } });
  await row(page, kept.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button.menu-row', { hasText: 'Siblings (1)' }).hover();
  const sibling = page.locator('.kebab-menu.submenu button.menu-row', { hasText: put.title });
  await expect(sibling).toHaveClass(/\bunavailable\b/);
  await expect(sibling).toHaveAttribute('data-tooltip', 'Archived: unarchive it in the archived view to open it');
  await sibling.click({ force: true });
  expect(await app.calls('startTerminal')).toEqual([]);
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

// The dot is a control only where its click marks something, by the rule the menu's item follows, so a dot never looks pressable for nothing.
test("a session's dot is a control only while it is idle or waiting, on its row and its tab alike", async ({ app, page }) => {
  await app.boot(fixture);
  await tabLabel(page, full.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  for (const [status, control] of [['busy', false], ['idle', true], ['waiting', true], ['closed', false]] as const) {
    expect(await app.emit('onSessionStatus', full.id, status, '', '')).toBe(1);
    for (const dot of [row(page, full.title).locator('.nudge'), tab(page, full.title).locator('.nudge')]) {
      if (control) await expect(dot).toHaveClass(/\bclickable\b/);
      else await expect(dot).not.toHaveClass(/\bclickable\b/);
    }
  }
});

// Even one whose claude left a status behind, as one that ended without saying so does.
test("an archived row's dot is no control, whatever status it still shows", async ({ app, page }) => {
  await app.boot({ ...archivedView, statuses: { [full.id]: 'waiting' } });
  const dot = row(page, full.title).locator('.nudge');
  await expect(dot).toHaveClass(/\bwaiting\b/);
  await expect(dot).not.toHaveClass(/\bclickable\b/);
  await dot.click();
  await expect(dot).not.toHaveClass(/\backed\b/);
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

// The stand-in numbers the ptys it starts from 1, and the default layout starts no shell, so the session's claude is 1.
const FIRST = 1;

// A press can land on an item drawn before the tab moved on, in the moment before the menu follows: the item does what it said or nothing, where the button it stands for would by then close the tab.
test("the tab button's item pressed after its tab moved on does what it said or nothing: a Force stop once claude has gone leaves the tab", async ({ app, page }) => {
  await app.boot(fixture);
  await tabLabel(page, full.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const close = tab(page, full.title).locator('.tab-close');
  await close.click();
  await expect(close).toBeEnabled();
  await row(page, full.title).locator('.session-kebab').click();
  // Held on to as it was drawn, since the open menu follows the tab once it moves.
  await item(page, 'Force stop').evaluate((button) => {
    (window as unknown as { held: Element }).held = button;
  });
  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await expect(tab(page, full.title)).toHaveClass(/\bcold\b/);

  await page.evaluate(() => (window as unknown as { held: Element }).held.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await expect(tab(page, full.title)).toHaveCount(1);
  expect(await app.calls('killTerminal')).toEqual([]);
});

// An open menu follows its session, as the tab and its button do, so what it offers is what can be done now.
test("a session's menu open while its pause waits for claude turns into a paused tab's once claude has gone", async ({ app, page }) => {
  await app.boot(fixture);
  await tabLabel(page, full.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await row(page, full.title).locator('.session-kebab').click();
  await item(page, 'Pause').click();
  await expect(tab(page, full.title).locator('.tab-close')).toBeEnabled();
  await row(page, full.title).locator('.session-kebab').click();
  await expect(item(page, 'Force stop')).toBeVisible();

  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await expect(item(page, 'Stop session')).not.toHaveClass(/\bunavailable\b/);
  await expect(item(page, 'Close tab')).toBeVisible();
  await expect(item(page, 'Force stop')).toHaveCount(0);
  await expect(item(page, 'Pause')).toHaveCount(0);
});

// A redraw replaces every row, an open submenu's parent among them, so the submenu is opened again under the new one: the pointer may be inside it, and something the menu shows can change without anything you did, such as a relative time ticking over.
test("an open submenu stays open when its menu is drawn again", async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, full.title).locator('.session-kebab').click();
  await item(page, 'Move to group').click();
  const submenu = page.locator('.kebab-menu.submenu');
  await expect(submenu).toBeVisible();
  // Inside the submenu, off its parent, so nothing under the pointer opens it again by itself.
  await submenu.locator('button.menu-row').first().hover();
  expect(await app.emit('onSessionStatus', full.id, 'busy', '', '')).toBe(1);
  await expect(header(page)).toContainText('Busy');
  await expect(submenu).toBeVisible();
  // Its own, opened from the new row.
  await expect(item(page, 'Move to group')).toHaveClass(/\bmenu-open\b/);
});

// Following the session is not redrawing at every change, which would replace every row under the pointer: a change that leaves the menu's items as they were leaves the menu as it is drawn.
test("an open menu is left as it is drawn by a change that does not touch what it lists", async ({ app, page }) => {
  const other = session({ id: '00000000-0000-4000-8000-000000000002', title: 'Another session' });
  await app.boot({ ...fixture, sessions: [full, other] });
  await row(page, full.title).locator('.session-kebab').click();
  // Held on to, since a redraw replaces it rather than changing it.
  await item(page, 'Move to group').evaluate((button) => {
    (window as unknown as { held: Element }).held = button;
  });
  expect(await app.emit('onSessionStatus', other.id, 'busy', '', '')).toBe(1);
  await expect(row(page, other.title).locator('.nudge')).toHaveClass(/\bbusy\b/);
  expect(await page.evaluate(() => (window as unknown as { held: Element }).held.isConnected)).toBe(true);
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

// Archiving says a session is finished, so a running one is stopped first; one open but not running is put away with its tab.
test('Archive is unavailable while the session runs, and says to stop it first', async ({ app, page }) => {
  await app.boot(fixture);
  await tabLabel(page, full.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await row(page, full.title).locator('.session-kebab').click();
  await expect(item(page, 'Archive')).toHaveClass(/\bunavailable\b/);
  await expect(item(page, 'Archive')).toHaveAttribute('data-tooltip', 'Stop the session first');
  await item(page, 'Archive').click({ force: true });
  expect(await app.calls('toggleArchive')).toEqual([]);
});

for (const [state, paused] of [['cold', []], ['paused', [full.id]]] as const) {
  test(`Archive on a session whose tab is ${state} archives it and closes the tab`, async ({ app, page }) => {
    await app.boot({ ...fixture, pausedSessions: [...paused] });
    await tab(page, full.title).locator('.tab-kebab').click();
    await item(page, 'Archive').click();
    await expect(tab(page, full.title)).toHaveCount(0);
    await expect(row(page, full.title)).toHaveCount(0);
    expect(await app.calls('toggleArchive')).toEqual([[full.id]]);
    expect(await app.calls('startTerminal')).toEqual([]);
  });
}

// The archived view's rows carry the kebab too, holding what the row's marks reach but its dot, its id, and the view's two buttons.
const archivedView = { sessions: [full], archived: { [full.id]: Date.parse('2026-10-01T08:00:00.000Z') }, uiState: { ...defaultUi(), filters: { ...defaultUi().filters, archived: true } } };

test("an archived session's menu holds its note, its id, Unarchive and Delete, and nothing that starts or files it", async ({ app, page }) => {
  await app.boot(archivedView);
  await row(page, full.title).locator('.session-kebab').click();
  await expect(page.locator('.kebab-menu button.menu-row')).toHaveText(['Add note…', 'Copy session id (00000000)', 'Unarchive', 'Delete session…']);
  // When it was archived, as its row says it, below when it was last active.
  const archived = await row(page, full.title).locator('.meta-text').textContent();
  await expect(lines(page).nth(3)).toHaveText(archived!);
  expect(archived).toMatch(/^archived /);
});

test("Unarchive in an archived session's menu takes it out of the archived view, as the row's button does", async ({ app, page }) => {
  await app.boot(archivedView);
  await row(page, full.title).locator('.session-kebab').click();
  await item(page, 'Unarchive').click();
  await expect(row(page, full.title)).toHaveCount(0);
  expect(await app.calls('toggleArchive')).toEqual([[full.id]]);
});

test("Delete session in an archived session's menu asks first, as the row's button does", async ({ app, page }) => {
  await app.boot(archivedView);
  await row(page, full.title).locator('.session-kebab').click();
  await item(page, 'Delete session…').click();
  await expect(page.locator('#confirm-message')).toHaveText(`Delete "${full.title}"?`);
  await page.locator('#confirm-cancel').click();
  await expect(row(page, full.title)).toBeVisible();
  expect(await app.calls('deleteSession')).toEqual([]);
});

test("an archived row's trailing controls sit 4px apart, delete second from the right", async ({ app, page }) => {
  await app.boot(archivedView);
  const box = async (selector: string): Promise<{ x: number; width: number }> => (await row(page, full.title).locator(selector).boundingBox())!;
  const [unarchive, del, kebab] = [await box('.unarchive-btn'), await box('.delete-btn'), await box('.session-kebab')];
  expect(Math.round(del.x - (unarchive.x + unarchive.width))).toBe(4);
  expect(Math.round(kebab.x - (del.x + del.width))).toBe(4);
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
