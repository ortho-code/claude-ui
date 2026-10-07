import { defaultUi } from '../../../../../src/shared/defaults';
import type { SessionSummary } from '../../../../../src/shared/types';
import { HOME, PROJECT, session } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { chooseProject, row, strip, stripJump, stripLines, stripNames, tab, tabLabel, tabs } from '../../../support/window';

// The strip lists what is RUNNING, in tab order: projects in the order you set, and within one its loose tabs and then its groups in registry order, which is the tab bar's own order (`orderAsTabs`, one implementation for both).
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

test('a strip folded last time comes back folded', async ({ app, page }) => {
  await app.boot({ sessions: [loose], openSessions: [loose.id], history: { [loose.id]: [] }, uiState: { ...defaultUi(), stripExpanded: false } });
  await tabLabel(page, loose.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await expect(page.locator('#live-strip')).toBeVisible();
  await expect(strip(page)).toBeHidden();
  await expect(page.locator('#strip-toggle')).toHaveAttribute('aria-expanded', 'false');
});
