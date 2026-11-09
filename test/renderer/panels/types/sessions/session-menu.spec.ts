import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../../src/shared/config/defaults';
import { HOME, PROJECT, session } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { row, tab, tabLabel } from '../../../support/window';

// A session's menu opens with what the session is, on every surface that has its kebab, so a tab, which says less than its row, still shows its title, place, status, activity, worktree and note.
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
] as const) {
  test(`a session's menu on its ${surface} opens with its title, where it is filed, its status, its activity, its worktree and its note`, async ({ app, page }) => {
    await app.boot(fixture);
    // Started, and then waiting for you.
    await tabLabel(page, full.title).click();
    await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
    expect(await app.emit('onSessionStatus', full.id, 'waiting', '', '')).toBe(1);
    const meta = await row(page, full.title).locator('.meta-text').textContent();
    await kebab(page).click();
    await expect(lines(page)).toHaveText([full.title, 'demo · Bugs', 'Waiting for you', meta!, 'Linked git worktree: feat-drag', 'Check it on a mac']);
    // Outside the finished view, the row's meta line and the header's are one rule.
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

// A menu is at most 300px wide: the header's first line, the session's name, stays one line, cut, with its whole text as its tooltip, and the lines under it wrap, a path inside them too, so what they say is all there.
test("a session's menu header cuts a long name and wraps the lines under it", async ({ app, page }) => {
  // A folder name wider than the menu with nowhere to break, not even a hyphen, so the path itself has to break.
  const cwd = `${HOME}/projects/afolderwhosenamehasnowheretobreakandiswiderthanthemenuitsin`;
  const long = session({ title: 'A session with a name far too long to fit on one line of its menu', cwd, cwdExists: false, repoRootExists: false });
  await app.boot({ sessions: [long] });
  await row(page, long.title).locator('.session-kebab').click();
  const cut = await lines(page).evaluateAll((all) => all.map((line) => line.scrollWidth > line.clientWidth));
  expect(cut[0]).toBe(true);
  await expect(lines(page).first()).toHaveAttribute('data-tooltip', long.title);
  expect(cut.slice(1)).toEqual(cut.slice(1).map(() => false));
  // The reason why it cannot run, naming that folder, is longer than the menu is wide.
  const reason = lines(page).last();
  expect(await reason.evaluate((line) => line.getBoundingClientRect().height)).toBeGreaterThan(await lines(page).nth(1).evaluate((line) => line.getBoundingClientRect().height));
});

// Everything a press on a surface does is in the session's menu there too; what would be the surface itself is not.
const item = (page: Page, label: string): Locator => page.locator('.kebab-menu button.menu-row').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });

test("Open in a row's menu opens its tab, as a press on the row does", async ({ app, page }) => {
  await app.boot({ sessions: [full], history: { [full.id]: [] } });
  await row(page, full.title).locator('.session-kebab').click();
  await item(page, 'Open').click();
  await expect(tab(page, full.title)).toHaveClass(/\bactive\b/);
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
});

test("a running tab's menu has no Open, since the tab is the session", async ({ app, page }) => {
  await app.boot(fixture);
  await tabLabel(page, full.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await tab(page, full.title).locator('.tab-kebab').click();
  await expect(item(page, 'Fork this session')).toBeVisible();
  await expect(item(page, 'Open')).toHaveCount(0);
});

// Selecting a cold tab is what starts it, so its menu offers that too, set aside or not, since the set-aside mark leaves the tab as it is.
const setAside = { [full.id]: { due: null, at: 1 } };
for (const [state, setAsideMarks] of [['cold', {}], ['set-aside cold', setAside]] as const) {
  test(`Open in a ${state} tab's menu starts its session`, async ({ app, page }) => {
    await app.boot({ ...fixture, setAside: setAsideMarks });
    await tab(page, full.title).locator('.tab-kebab').click();
    await item(page, 'Open').click();
    await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
    await expect(tab(page, full.title)).toHaveClass(/\bactive\b/);
  });
}

test('Show in list says so when a filter leaves the session out', async ({ app, page }) => {
  await app.boot(fixture);
  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill('nothing matches this');
  await expect(row(page, full.title)).toHaveCount(0);
  await tab(page, full.title).locator('.tab-kebab').click();
  await item(page, 'Show in list').click();
  await expect(page.locator('#toast-message')).toHaveText(`"${full.title}" is left out by the filter. Clear it to see its row.`);
});

// A finished sibling stays in the list of siblings, unavailable and saying why: finished is put away, not opened.
test("a finished sibling in a session's menu is unavailable, saying it is finished", async ({ app, page }) => {
  const kept = session({ id: '00000000-0000-4000-8000-0000000000f2', title: 'Kept sibling', isSibling: true, siblingIds: ['00000000-0000-4000-8000-0000000000f3'] });
  const put = session({ id: '00000000-0000-4000-8000-0000000000f3', title: 'Archived sibling', isSibling: true, siblingIds: [kept.id] });
  await app.boot({ sessions: [kept, put], finished: { [put.id]: Date.parse('2026-10-01T08:00:00.000Z') } });
  await row(page, kept.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button.menu-row', { hasText: 'Siblings (1)' }).hover();
  const sibling = page.locator('.kebab-menu.submenu button.menu-row', { hasText: put.title });
  await expect(sibling).toHaveClass(/\bunavailable\b/);
  await expect(sibling).toHaveAttribute('data-tooltip', 'Finished: make it unfinished from the finished sessions to open it');
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

test("Mark as read in a tab's menu marks the session read, as a click on its dot does, and the menu then offers Mark as unread", async ({ app, page }) => {
  await app.boot(fixture);
  await tabLabel(page, full.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  expect(await app.emit('onSessionStatus', full.id, 'waiting', '', '')).toBe(1);
  await tab(page, full.title).locator('.tab-kebab').click();
  await item(page, 'Mark as read').click();
  await expect(row(page, full.title).locator('.nudge')).toHaveClass(/\backed\b/);
  await tab(page, full.title).locator('.tab-kebab').click();
  await item(page, 'Mark as unread').click();
  await expect(row(page, full.title).locator('.nudge')).not.toHaveClass(/\backed\b/);
});

// The dot is a control only where its click marks something, by the rule the menu's item follows, so a dot never looks pressable for nothing.
test("a session's dot is a control only while it is ready or waiting, on its row and its tab alike", async ({ app, page }) => {
  await app.boot(fixture);
  await tabLabel(page, full.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  for (const [status, control] of [['busy', false], ['ready', true], ['waiting', true], ['closed', false]] as const) {
    expect(await app.emit('onSessionStatus', full.id, status, '', '')).toBe(1);
    for (const dot of [row(page, full.title).locator('.nudge'), tab(page, full.title).locator('.nudge')]) {
      if (control) await expect(dot).toHaveClass(/\bclickable\b/);
      else await expect(dot).not.toHaveClass(/\bclickable\b/);
    }
  }
});

// Even one whose claude left a status behind, as one that ended without saying so does.
test("a finished row's dot is no control, whatever status it still shows", async ({ app, page }) => {
  await app.boot({ ...finishedView, statuses: { [full.id]: 'waiting' } });
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
  await expect(item(page, 'Mark as read')).toHaveAttribute('data-tooltip', 'Only a session that is ready, waiting for you or marked as needing you can be marked read or unread');
});

// The tab's button is a shortcut to one of the menu's leave items: one rule for the two (`leaveAction`), so the item says and does what the button would.
test("Stop session in a row's menu stops it as the tab's button does, and then offers the force, unavailable while it says it is stopping", async ({ app, page }) => {
  await app.boot(fixture);
  await tabLabel(page, full.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await row(page, full.title).locator('.session-kebab').click();
  await item(page, 'Stop session').click();
  await expect(tab(page, full.title).locator('.tab-close')).toBeDisabled();
  await row(page, full.title).locator('.session-kebab').click();
  await expect(item(page, 'Force stop')).toHaveAttribute('data-tooltip', 'Stopping…');
  await expect(item(page, 'Stop session')).toHaveCount(0);
});

// The stand-in numbers the ptys it starts from 1, and the default layout starts no shell, so the session's claude is 1.
const FIRST = 1;

/** Start the fixture's session from its tab, and open its row's menu. */
async function runningMenu(app: App, page: Page): Promise<void> {
  await app.boot(fixture);
  await tabLabel(page, full.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await row(page, full.title).locator('.session-kebab').click();
}

// Stop session, Close tab and Finished each do one thing, whatever that takes (decided 2026-10-28): no item in the menu is two of them.
test("a running session's menu has Stop session, Close tab and Finished, each available", async ({ app, page }) => {
  await runningMenu(app, page);
  for (const label of ['Stop session', 'Close tab', 'Finished']) await expect(item(page, label)).not.toHaveClass(/\bunavailable\b/);
});

test("Close tab in a running session's menu asks claude to leave, keeps the tab until it has gone, and finishes nothing", async ({ app, page }) => {
  await runningMenu(app, page);
  await item(page, 'Close tab').click();
  expect(await app.calls('closeTerminal')).toEqual([[FIRST, false]]);
  const button = tab(page, full.title).locator('.tab-close');
  await expect(button).toHaveAttribute('data-tooltip', 'Closing…');
  await expect(button).toHaveAttribute('data-mark', 'close');
  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await expect(tab(page, full.title)).toHaveCount(0);
  await expect(row(page, full.title)).toHaveCount(1);
  expect(await app.calls('finish')).toEqual([]);
});

test("a cold tab's menu has nothing to stop, and closes and finishes it", async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, full.title).locator('.session-kebab').click();
  await expect(item(page, 'Stop session')).toHaveClass(/\bunavailable\b/);
  await expect(item(page, 'Stop session')).toHaveAttribute('data-tooltip', 'Not running');
  await expect(item(page, 'Close tab')).not.toHaveClass(/\bunavailable\b/);
  await expect(item(page, 'Finished')).not.toHaveClass(/\bunavailable\b/);
});

// The item of what was asked becomes its force, named for it, and the tab's button is that force too, so the button stays the press that ends claude.
test("a close claude has not left is forced by Force close, which the tab's button is too", async ({ app, page }) => {
  await runningMenu(app, page);
  await item(page, 'Close tab').click();
  const button = tab(page, full.title).locator('.tab-close');
  await expect(button).toHaveAttribute('data-mark', 'force-close');
  await expect(button).toHaveAttribute('data-tooltip', /^Force close: claude has not left yet/);
  await row(page, full.title).locator('.session-kebab').click();
  await expect(item(page, 'Close tab')).toHaveCount(0);
  await item(page, 'Force close').click();
  expect(await app.calls('killTerminal')).toEqual([[FIRST]]);
  expect(await app.emit('onTerminalExit', FIRST, 143)).toBe(1);
  await expect(tab(page, full.title)).toHaveCount(0);
});

// Another item pressed while claude leaves changes what its exit does, and asks claude nothing more, since a second pair of presses ends what it asks on its way out unanswered.
test('Stop session on a close under way keeps the tab at the exit, and sends claude nothing more', async ({ app, page }) => {
  await runningMenu(app, page);
  await item(page, 'Close tab').click();
  await row(page, full.title).locator('.session-kebab').click();
  await item(page, 'Stop session').click();
  expect(await app.calls('closeTerminal')).toEqual([[FIRST, false]]);
  await expect(tab(page, full.title).locator('.tab-close')).toHaveAttribute('data-tooltip', 'Stopping…');
  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await expect(tab(page, full.title)).toHaveClass(/\bcold\b/);
});

test('Close tab on a stop under way removes the tab at the exit, and sends claude nothing more', async ({ app, page }) => {
  await runningMenu(app, page);
  await item(page, 'Stop session').click();
  await row(page, full.title).locator('.session-kebab').click();
  await item(page, 'Close tab').click();
  expect(await app.calls('closeTerminal')).toEqual([[FIRST, false]]);
  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await expect(tab(page, full.title)).toHaveCount(0);
  expect(await app.calls('finish')).toEqual([]);
});

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
test("a session's menu open while its stop waits for claude turns into a stopped tab's once claude has gone", async ({ app, page }) => {
  await app.boot(fixture);
  await tabLabel(page, full.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await row(page, full.title).locator('.session-kebab').click();
  await item(page, 'Stop session').click();
  await expect(tab(page, full.title).locator('.tab-close')).toBeEnabled();
  await row(page, full.title).locator('.session-kebab').click();
  await expect(item(page, 'Force stop')).toBeVisible();

  expect(await app.emit('onTerminalExit', FIRST, 0)).toBe(1);
  await expect(item(page, 'Stop session')).toHaveAttribute('data-tooltip', 'Not running');
  await expect(item(page, 'Close tab')).toBeVisible();
  await expect(item(page, 'Force stop')).toHaveCount(0);
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

test("Close tab in a row's menu closes a session's cold tab, set aside or not", async ({ app, page }) => {
  await app.boot({ ...fixture, setAside });
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

// One open but not running is put away with its tab at once; a running one's finish waits for its claude (claude/terminals/finish.spec.ts).
for (const [state, setAsideMarks] of [['cold', {}], ['cold and set aside', setAside]] as const) {
  test(`Finished on a session whose tab is ${state} finishes it and closes the tab`, async ({ app, page }) => {
    await app.boot({ ...fixture, setAside: setAsideMarks });
    await tab(page, full.title).locator('.tab-kebab').click();
    await item(page, 'Finished').click();
    await expect(tab(page, full.title)).toHaveCount(0);
    await expect(row(page, full.title)).toHaveCount(0);
    expect(await app.calls('finish')).toEqual([[[full.id]]]);
    expect(await app.calls('startTerminal')).toEqual([]);
  });
}

// The finished view's rows carry the kebab too, holding what the row's marks reach but its dot, its id, and the view's two buttons.
const finishedView = { sessions: [full], finished: { [full.id]: Date.parse('2026-10-01T08:00:00.000Z') }, uiState: { ...defaultUi(), filters: { ...defaultUi().filters, finished: true } } };

test("a finished session's menu holds its note, its id, Unfinished and Delete, Select… on its row, and nothing that starts or files it", async ({ app, page }) => {
  await app.boot(finishedView);
  await row(page, full.title).locator('.session-kebab').click();
  await expect(page.locator('.kebab-menu button.menu-row')).toHaveText(['Add note…', 'Copy session id (00000000)', 'Unfinished', 'Delete session…', 'Select…']);
  // When it was finished, as its row says it, below when it was last active.
  const finished = await row(page, full.title).locator('.meta-text').textContent();
  await expect(lines(page).nth(3)).toHaveText(finished!);
  expect(finished).toMatch(/^finished /);
});

test("Unfinished in a finished session's menu takes it out of the finished view, as the row's button does", async ({ app, page }) => {
  await app.boot(finishedView);
  await row(page, full.title).locator('.session-kebab').click();
  await item(page, 'Unfinished').click();
  await expect(row(page, full.title)).toHaveCount(0);
  expect(await app.calls('unfinish')).toEqual([[[full.id]]]);
});

test("Delete session in a finished session's menu asks first, as the row's button does", async ({ app, page }) => {
  await app.boot(finishedView);
  await row(page, full.title).locator('.session-kebab').click();
  await item(page, 'Delete session…').click();
  await expect(page.locator('#confirm-message')).toHaveText(`Delete "${full.title}"?`);
  await page.locator('#confirm-cancel').click();
  await expect(row(page, full.title)).toBeVisible();
  expect(await app.calls('deleteSession')).toEqual([]);
});

test("a finished row's trailing controls sit 4px apart, delete second from the right", async ({ app, page }) => {
  await app.boot(finishedView);
  const box = async (selector: string): Promise<{ x: number; width: number }> => (await row(page, full.title).locator(selector).boundingBox())!;
  const [unfinish, del, kebab] = [await box('.unfinish-btn'), await box('.delete-btn'), await box('.session-kebab')];
  expect(Math.round(del.x - (unfinish.x + unfinish.width))).toBe(4);
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
