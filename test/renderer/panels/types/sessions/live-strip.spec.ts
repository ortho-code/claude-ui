import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../../src/shared/defaults';
import type { SessionSummary } from '../../../../../src/shared/types';
import { HOME, PROJECT, session } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { lookOf, token } from '../../../support/looks';
import { clickAcross } from '../../../support/press';
import { chooseProject, projectHeading, row, strip, stripHeading, stripHidden, stripJump, stripLines, stripNames, stripRow, tab, tabLabel, tabs } from '../../../support/window';

// The strip lists what is RUNNING, and what you paused, in tab order: projects in the order you set, and within one its loose tabs and then its groups in registry order, which is the tab bar's own order (`orderAsTabs`, one implementation for both).
// It keeps still: a session writing a message or waiting moves no row, which recency- or attention-ordering did (6f04c95).
const OTHER = `${HOME}/projects/other`;
const THIRD = `${HOME}/projects/third`;
const loose = session({ id: '00000000-0000-4000-8000-0000000000e1', title: 'Loose in demo' });
const inFirst = session({ id: '00000000-0000-4000-8000-0000000000e2', title: 'In First' });
const inSecond = session({ id: '00000000-0000-4000-8000-0000000000e3', title: 'In Second' });
const elsewhere = session({ id: '00000000-0000-4000-8000-0000000000e4', title: 'In other', cwd: OTHER, repoRoot: OTHER });
const all = [loose, inFirst, inSecond, elsewhere];

test('the live strip lists running sessions in the order you set, and keeps still while they work', async ({ app, page }) => {
  await app.boot({
    sessions: all,
    projectOrder: [PROJECT, OTHER],
    activeProject: null,
    // Opened other-project first, and the later group before the earlier one, as in the tab bar's check.
    openSessions: [elsewhere.id, inFirst.id, inSecond.id, loose.id],
    groupState: {
      groups: [
        { id: 'g-second', name: 'Second', repoRoot: PROJECT },
        { id: 'g-first', name: 'First', repoRoot: PROJECT },
      ],
      groupOf: { [inFirst.id]: 'g-first', [inSecond.id]: 'g-second' },
    },
    // A tab on show has its history read; what it holds is not what is checked here.
    history: Object.fromEntries(all.map((s) => [s.id, []])),
  });
  await expect(page.locator('#live-strip')).toBeHidden();

  // Running is what puts a session in the strip, so start every tab, in the order they were opened.
  for (const s of [elsewhere, inFirst, inSecond, loose]) await tabLabel(page, s.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(4);

  const expected = ['demo', loose.title, inSecond.title, inFirst.title, 'other', elsewhere.title];
  await expect.poll(() => stripLines(page).allTextContents()).toEqual(expected);

  // Work arriving in any order moves nothing.
  for (const [s, status] of [[inFirst, 'busy'], [elsewhere, 'waiting'], [loose, 'idle'], [inFirst, 'waiting']] as const) {
    expect(await app.emit('onSessionStatus', s.id, status, '', '')).toBe(1);
  }
  await expect(page.locator('#strip-label')).toHaveText('3 of 4 need you');
  expect(await stripLines(page).allTextContents()).toEqual(expected);
});

// The strip is how you get back to a running session in another project: a row takes you to its project, its tab and its row.
test('a strip row jumps to its session in another project: the project, the tab on show, the row', async ({ app, page }) => {
  await app.boot({ sessions: [loose, elsewhere], projectOrder: [PROJECT, OTHER], activeProject: null, openSessions: [loose.id, elsewhere.id], history: { [loose.id]: [], [elsewhere.id]: [] } });
  await tabLabel(page, elsewhere.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  // Scoped to the other project, where its tab is out of sight.
  await chooseProject(page, 'demo');
  await expect(tabLabel(page, elsewhere.title)).toHaveCount(0);

  await stripJump(page, elsewhere.title).click();
  await expect(page.locator('#switcher-name')).toHaveText('other');
  await expect(tab(page, elsewhere.title)).toHaveClass(/\bactive\b/);
  await expect(row(page, elsewhere.title)).toHaveClass(/\bactive-session\b/);
  // Already running: nothing started again.
  expect(await app.calls('startTerminal')).toHaveLength(1);
});

// The strip is cross-project, so the row you are already in looks like any other unless it says so: it is marked, whichever project it sits under, and only while its tab is on show.
test('the strip marks the session on show, and the mark follows the tab you pick', async ({ app, page }) => {
  const idle = session({ id: '00000000-0000-4000-8000-0000000000e5', title: 'In third', cwd: THIRD, repoRoot: THIRD });
  await app.boot({
    sessions: [loose, elsewhere, idle],
    projectOrder: [PROJECT, OTHER, THIRD],
    activeProject: null,
    openSessions: [loose.id, elsewhere.id],
    history: { [loose.id]: [], [elsewhere.id]: [] },
  });
  for (const s of [loose, elsewhere]) await tabLabel(page, s.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  const marked = async (on: SessionSummary, off: SessionSummary): Promise<void> => {
    await expect(stripJump(page, on.title)).toHaveAttribute('aria-current', 'true');
    await expect(stripJump(page, off.title)).not.toHaveAttribute('aria-current');
  };
  await marked(elsewhere, loose);

  // A tab picked in the bar moves the mark, and so does a row of the strip.
  await tabLabel(page, loose.title).click();
  await marked(loose, elsewhere);
  await stripJump(page, elsewhere.title).click();
  await marked(elsewhere, loose);

  // A project with no tab open leaves nothing on show, so nothing in the strip is marked, though both still run.
  await chooseProject(page, 'third');
  await expect(stripNames(page)).toHaveText([loose.title, elsewhere.title]);
  await expect(strip(page).locator('[aria-current]')).toHaveCount(0);
});

// A click is a press and a release on the same element, and the strip is drawn again whenever a running session's status changes, which is when it is used: a press that a change lands in the middle of still counts, on either half of the row.
test('a press on a strip row still counts when a status arrives before the release', async ({ app, page }) => {
  const other = session({ id: '00000000-0000-4000-8000-0000000000e6', title: 'Other in demo' });
  await app.boot({ sessions: [loose, other], openSessions: [loose.id, other.id], history: { [loose.id]: [], [other.id]: [] } });
  for (const s of [loose, other]) await tabLabel(page, s.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  // Each a status the session does not have yet, so each draws the strip again: the same one twice changes nothing.
  const status = (title: string, id: string, state: string) => async (): Promise<void> => {
    expect(await app.emit('onSessionStatus', id, state, '', '')).toBe(1);
    await expect(stripJump(page, title).locator('.nudge')).toHaveClass(new RegExp(`\\b${state}\\b`));
  };

  // A row reached with the keyboard keeps the focus too.
  await stripJump(page, other.title).focus();
  await status(other.title, other.id, 'busy')();
  await expect(stripJump(page, other.title)).toBeFocused();

  await clickAcross(page, stripJump(page, loose.title), status(loose.title, loose.id, 'busy'));
  await expect(stripJump(page, loose.title)).toHaveAttribute('aria-current', 'true');

  // Waiting by then, so the stop asks with the extra Ctrl-C a turn needs.
  await clickAcross(page, stripRow(page, other.title).locator('.strip-item-stop'), status(other.title, other.id, 'waiting'));
  expect(await app.calls('closeTerminal')).toEqual([[2, true]]);
  // The stop is a button beside the jump, not inside it: stopping a session does not take you to it.
  await expect(stripJump(page, loose.title)).toHaveAttribute('aria-current', 'true');
});

// Stopping from the strip is the way to stop a session in another project without leaving the one you are in: it stops, never closes, and the row leaves the strip once nothing runs there.
test("the strip's stop button stops the session, keeps its tab cold, and the row leaves the strip", async ({ app, page }) => {
  await app.boot({ sessions: [loose], openSessions: [loose.id], history: { [loose.id]: [] } });
  await tabLabel(page, loose.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const stop = strip(page).locator('.strip-item-stop');

  await stop.click();
  expect(await app.calls('closeTerminal')).toEqual([[1, false]]);
  // On its way out, on both of its buttons: the strip's and the tab's.
  await expect(stop).toBeDisabled();
  await expect(tabs(page).locator('.tab-close')).toBeDisabled();

  await app.emit('onTerminalExit', 1, 0);
  await expect(tab(page, loose.title)).toHaveClass(/\bcold\b/);
  await expect(page.locator('#live-strip')).toBeHidden();
});

// Unavailable rather than natively disabled (`setUnavailable`), so the keyboard reaches it to hear why, as the pointer does on hover.
// The clock is held so the stop cannot turn into a force, a second after the press, while the tooltip takes its moment to appear.
test("the strip's stop says why it cannot act while its session is leaving, takes the keyboard's focus, and a press on it does nothing", async ({ app, page }) => {
  await page.clock.install();
  await app.boot({ sessions: [loose], openSessions: [loose.id], history: { [loose.id]: [] } });
  await tabLabel(page, loose.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const stop = strip(page).locator('.strip-item-stop');
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);

  await stop.click();
  await expect(stop).toBeDisabled();
  // Off it and back: the press put the pointer there already, and its click took down the tooltip it was waiting to show.
  await page.mouse.move(0, 0);
  await stop.hover();
  await page.clock.runFor(500);
  await expect(page.locator('#tooltip')).toHaveText('Stopping…');
  await stop.focus();
  await expect(stop).toBeFocused();
  await page.keyboard.press('Enter');
  await stop.click({ force: true });
  expect(await app.calls('closeTerminal')).toEqual([[1, false]]);
  expect(await app.calls('killTerminal')).toEqual([]);
  // Nothing else moved either: the session's tab is still the one on show.
  await expect(tab(page, loose.title)).toHaveClass(/\bactive\b/);
});

// A session asked to leave may be asking something in a tab you are not looking at: the strip keeps it, says so, and forces it when pressed again.
test("the strip's stop becomes a force when the session has not left, as the tab's does", async ({ app, page }) => {
  await app.boot({ sessions: [loose], openSessions: [loose.id], history: { [loose.id]: [] } });
  await tabLabel(page, loose.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const stop = strip(page).locator('.strip-item-stop');

  await stop.click();
  await expect(stop).toBeEnabled();
  await expect(stop).toHaveAttribute('data-tooltip', /^Force stop: claude has not left yet/);
  await expect(tabs(page).locator('.tab-close')).toHaveAttribute('data-tooltip', /^Force stop/);
  await stop.click();
  expect(await app.calls('killTerminal')).toEqual([[1]]);
  await expect(stop).toBeDisabled();
  await expect(page.locator('#live-strip')).toBeVisible();
});

// A tab you paused is work in hand, so the strip lists it with what runs: in its own place in tab order, its dot paused, counted apart on the line and never as wanting you.
test('a paused tab is listed in its place among the running ones, its dot paused, and the line counts it apart', async ({ app, page }) => {
  await app.boot({
    sessions: [loose, inFirst, elsewhere],
    projectOrder: [PROJECT, OTHER],
    activeProject: null,
    openSessions: [loose.id, inFirst.id, elsewhere.id],
    pausedSessions: [inFirst.id],
    history: { [loose.id]: [], [inFirst.id]: [], [elsewhere.id]: [] },
  });
  await expect(page.locator('#strip-label')).toHaveText('1 paused');
  for (const s of [loose, elsewhere]) await tabLabel(page, s.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);

  await expect.poll(() => stripLines(page).allTextContents()).toEqual(['demo', loose.title, inFirst.title, 'other', elsewhere.title]);
  await expect(stripRow(page, inFirst.title).locator('.nudge')).toHaveClass(/\bpaused\b/);
  await expect(page.locator('#strip-label')).toHaveText('2 live · 1 paused');
  expect(await app.emit('onSessionStatus', loose.id, 'waiting', '', 'Notification')).toBe(1);
  await expect(page.locator('#strip-label')).toHaveText('1 of 2 need you · 1 paused');
});

test('the strip shows at launch with only paused tabs, and its line never counts a paused session as wanting you', async ({ app, page }) => {
  // A status left from before the pause, as a file can hold one.
  await app.boot({ sessions: [loose], openSessions: [loose.id], pausedSessions: [loose.id], statuses: { [loose.id]: 'waiting' }, history: { [loose.id]: [] } });
  await expect(page.locator('#live-strip')).toBeVisible();
  await expect(stripNames(page)).toHaveText([loose.title]);
  await expect(page.locator('#strip-label')).toHaveText('1 paused');
  expect(await app.calls('startTerminal')).toEqual([]);
});

// The row's button is its tab's: a paused tab has nothing to stop, so it closes, as the tab's own button does.
test("a paused row's button closes its tab, and the row leaves the strip", async ({ app, page }) => {
  await app.boot({ sessions: [loose], openSessions: [loose.id], pausedSessions: [loose.id], history: { [loose.id]: [] } });
  const button = strip(page).locator('.strip-item-stop');
  await expect(button).toHaveAttribute('data-tooltip', 'Close tab');
  await button.click();
  await expect(tab(page, loose.title)).toHaveCount(0);
  await expect(page.locator('#live-strip')).toBeHidden();
  expect(await app.calls('startTerminal')).toEqual([]);
});

test('a paused row leaves the strip when its session is stopped, and a click on it resumes the session', async ({ app, page }) => {
  await app.boot({ sessions: [loose, inFirst], openSessions: [loose.id, inFirst.id], pausedSessions: [loose.id, inFirst.id], history: { [loose.id]: [], [inFirst.id]: [] } });
  await row(page, loose.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button', { hasText: /^Stop session$/ }).click();
  await expect(stripNames(page)).toHaveText([inFirst.title]);

  await stripJump(page, inFirst.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  // Running now, and no longer paused: still listed, as what runs.
  await expect(page.locator('#strip-label')).toHaveText('1 live');
  await expect(stripRow(page, inFirst.title).locator('.nudge')).not.toHaveClass(/\bpaused\b/);
});

// A row's kebab holds its session's menu, the session row's own, so a session in another project is managed from here, Pause included.
test("a strip row's kebab opens its session's menu, and pausing from it keeps the row, paused", async ({ app, page }) => {
  await app.boot({ sessions: [loose], openSessions: [loose.id], history: { [loose.id]: [] } });
  await tabLabel(page, loose.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);

  await stripRow(page, loose.title).locator('.strip-item-kebab').click();
  await expect(page.locator('.kebab-menu button', { hasText: 'Archive' })).toBeVisible();
  await page.locator('.kebab-menu button', { hasText: /^Pause$/ }).click();
  expect(await app.calls('closeTerminal')).toEqual([[1, false]]);
  await app.emit('onTerminalExit', 1, 0);
  await expect(stripRow(page, loose.title).locator('.nudge')).toHaveClass(/\bpaused\b/);
  await expect(page.locator('#strip-label')).toHaveText('1 paused');
});

test("a strip row not on show keeps its hover look while its menu is up, and its kebab sits right against its button, as on the tab", async ({ app, page }) => {
  await app.boot({ sessions: [loose], openSessions: [loose.id], pausedSessions: [loose.id], history: { [loose.id]: [] } });
  const stripItem = stripRow(page, loose.title);
  const kebab = stripItem.locator('.strip-item-kebab');
  const kebabBox = (await kebab.boundingBox())!;
  const buttonBox = (await stripItem.locator('.strip-item-stop').boundingBox())!;
  expect(Math.round(buttonBox.x - (kebabBox.x + kebabBox.width))).toBe(0);

  await kebab.click();
  await page.locator('.kebab-menu button').first().hover();
  expect((await lookOf(stripItem)).background).toBe(await token(page, '--surface-hover'));
});

test("a paused tab's project whose folder is gone is marked on its strip heading, as wherever a project is named", async ({ app, page }) => {
  const GONE = `${HOME}/projects/gone`;
  const dead = session({ id: '00000000-0000-4000-8000-0000000000e9', title: 'In a gone folder', cwd: GONE, repoRoot: GONE, cwdExists: false, repoRootExists: false });
  await app.boot({ sessions: [loose, dead], projectOrder: [PROJECT, GONE], activeProject: null, openSessions: [loose.id, dead.id], pausedSessions: [loose.id, dead.id], history: { [loose.id]: [], [dead.id]: [] } });
  const heading = (name: string): Locator => strip(page).locator('.strip-project', { hasText: name });
  await expect(heading('gone').locator('.gone-mark')).toHaveClass(/project-gone/);
  await expect(heading('gone').locator('.gone-mark')).toBeVisible();
  await expect(heading('demo').locator('.gone-mark')).toBeHidden();
});


// The strip folds to its one line and opens again from that line, and stays the way it was left, across a restart too.
test('the strip folds from its line and opens again, and the fold is kept', async ({ app, page }) => {
  await app.boot({ sessions: [loose], openSessions: [loose.id], history: { [loose.id]: [] } });
  await tabLabel(page, loose.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const toggle = page.locator('#strip-toggle');
  const list = strip(page);
  await expect(list).toBeVisible();

  await toggle.click();
  await expect(list).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(async () => (await app.saved())?.stripExpanded).toBe(false);

  await toggle.click();
  await expect(list).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(async () => (await app.saved())?.stripExpanded).toBe(true);
});

// A project you want out of sight for a while leaves the strip from the eye on its heading, is counted on a Hidden line at its foot, and comes back when picked from that line's menu.
// Its sessions are not listed anywhere in the strip while it is hidden: a fold showing them was taken for the strip's own.
test("a project's eye hides it from the strip, counted on the Hidden line, and picking it from that line's menu shows it again", async ({ app, page }) => {
  await app.boot({ sessions: [loose, elsewhere], projectOrder: [PROJECT, OTHER], activeProject: null, openSessions: [loose.id, elsewhere.id], pausedSessions: [loose.id, elsewhere.id], history: { [loose.id]: [], [elsewhere.id]: [] } });
  await expect(stripHidden(page)).toHaveCount(0);
  await stripHeading(page, 'other').hover();
  const eye = stripHeading(page, 'other').locator('.strip-eye');
  await expect(eye).toHaveAttribute('aria-label', 'Hide from the live strip');

  await eye.click();
  await expect(stripLines(page)).toHaveText(['demo', loose.title]);
  await expect(strip(page).locator('.strip-item', { hasText: elsewhere.title })).toHaveCount(0);
  await expect(stripHidden(page)).toHaveText('1 project hidden');
  // What it hides is still counted on the strip's own line.
  await expect(page.locator('#strip-label')).toHaveText('2 paused');
  await expect.poll(async () => (await app.saved())?.stripHiddenProjects).toEqual([OTHER]);

  await stripHidden(page).click();
  const item = page.locator('.kebab-menu .menu-row');
  await expect(item.locator('.menu-item-label')).toHaveText(['other']);
  await expect(item.locator('.menu-item-count')).toHaveText(['1']);
  // The line holds its hover look while its menu is up, as the icon buttons that open a menu do.
  await item.hover();
  expect((await lookOf(stripHidden(page))).background).toBe(await token(page, '--surface-hover'));

  await item.click();
  await expect(stripLines(page)).toHaveText(['demo', loose.title, 'other', elsewhere.title]);
  await expect(stripHidden(page)).toHaveCount(0);
  await expect.poll(async () => (await app.saved())?.stripHiddenProjects).toEqual([]);
});

test("a listed project's eye shows only while its heading is pointed at, or the keyboard reaches it", async ({ app, page }) => {
  await app.boot({ sessions: [loose], openSessions: [loose.id], pausedSessions: [loose.id], history: { [loose.id]: [] } });
  const eye = stripHeading(page, 'demo').locator('.strip-eye');
  await expect(eye).toHaveCSS('opacity', '0');
  await stripHeading(page, 'demo').hover();
  await expect(eye).toHaveCSS('opacity', '1');
  await page.mouse.move(0, 0);
  await expect(eye).toHaveCSS('opacity', '0');

  // Back from the row under it, with the keyboard: Tab does not step over it.
  await stripJump(page, loose.title).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(eye).toBeFocused();
  await expect(eye).toHaveCSS('opacity', '1');
});

// Hidden is not silenced: whatever its projects ask of you shows on its line, as each one's does in the switcher.
test("the Hidden line carries its projects' roll-up, so a session waiting there still reaches you", async ({ app, page }) => {
  await app.boot({ sessions: [loose, elsewhere], projectOrder: [PROJECT, OTHER], activeProject: null, openSessions: [loose.id, elsewhere.id], history: { [loose.id]: [], [elsewhere.id]: [] } });
  for (const s of [elsewhere, loose]) await tabLabel(page, s.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  await stripHeading(page, 'other').hover();
  await stripHeading(page, 'other').locator('.strip-eye').click();
  await expect(page.locator('#strip-hidden-badge')).toBeHidden();

  expect(await app.emit('onSessionStatus', elsewhere.id, 'waiting', '', 'Notification')).toBe(1);
  await expect(page.locator('#strip-hidden-badge')).toHaveClass(/\bwaiting\b/);
  await expect(page.locator('#strip-hidden-badge')).toBeVisible();
  // And on its entry in the menu, which says which project it is.
  await stripHidden(page).click();
  await expect(page.locator('.kebab-menu .menu-row', { hasText: 'other' }).locator('.nudge')).toHaveClass(/\bwaiting\b/);
});

// What a restart brings back paused is what the hide is for: the launch restoring the tabs, the one on show among them, is not an open, and nor is a project switch selecting its tab.
const hiddenAtLaunch = {
  sessions: [loose, elsewhere],
  projectOrder: [PROJECT, OTHER],
  activeProject: null,
  openSessions: [loose.id, elsewhere.id],
  pausedSessions: [loose.id, elsewhere.id],
  activeSession: elsewhere.id,
  history: { [loose.id]: [], [elsewhere.id]: [] },
  uiState: { ...defaultUi(), stripHiddenProjects: [OTHER] },
};

test('a project hidden last time comes back hidden, and switching to it leaves it so', async ({ app, page }) => {
  await app.boot(hiddenAtLaunch);
  await expect(tab(page, elsewhere.title)).toHaveClass(/\bactive\b/);
  await expect(stripLines(page)).toHaveText(['demo', loose.title]);
  await expect(stripHidden(page)).toHaveText('1 project hidden');

  await chooseProject(page, 'other');
  await expect(page.locator('#switcher-name')).toHaveText('other');
  await expect(stripLines(page)).toHaveText(['demo', loose.title]);
  await expect(stripHidden(page)).toBeVisible();
  expect(await app.calls('startTerminal')).toEqual([]);
});

// Going back to work in a hidden project, wherever you do it from, is the end of wanting it out of sight.
const opens: [string, (page: Page) => Promise<void>][] = [
  ['its row in the list', (page) => row(page, elsewhere.title).click()],
  ['its tab', (page) => tabLabel(page, elsewhere.title).click()],
  ["the pane's Resume", (page) => page.locator('.pane-placeholder button', { hasText: 'Resume' }).click()],
  ['a new session in it', (page) => projectHeading(page, 'other').locator('.project-add').click()],
];
for (const [how, open] of opens) {
  test(`opening a session of a hidden project shows it in the strip again: ${how}`, async ({ app, page }) => {
    await app.boot(hiddenAtLaunch);
    await expect(stripHidden(page)).toBeVisible();
    await open(page);
    await expect(stripHidden(page)).toHaveCount(0);
    await expect(stripHeading(page, 'other')).toBeVisible();
    await expect.poll(async () => (await app.saved())?.stripHiddenProjects).toEqual([]);
  });
}

// The eye's box is taller than the heading's line of text, and taken alone it made every heading 3px taller, eye shown or not.
test("a strip heading is as tall with its eye as without it", async ({ app, page }) => {
  await app.boot({ sessions: [loose], openSessions: [loose.id], pausedSessions: [loose.id], history: { [loose.id]: [] } });
  const heading = stripHeading(page, 'demo');
  const withEye = (await heading.boundingBox())!.height;
  await page.addStyleTag({ content: '.strip-eye { display: none !important; }' });
  expect((await heading.boundingBox())!.height).toBe(withEye);
});

test('a strip folded last time comes back folded', async ({ app, page }) => {
  await app.boot({ sessions: [loose], openSessions: [loose.id], history: { [loose.id]: [] }, uiState: { ...defaultUi(), stripExpanded: false } });
  await tabLabel(page, loose.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await expect(page.locator('#live-strip')).toBeVisible();
  await expect(strip(page)).toBeHidden();
  await expect(page.locator('#strip-toggle')).toHaveAttribute('aria-expanded', 'false');
});
