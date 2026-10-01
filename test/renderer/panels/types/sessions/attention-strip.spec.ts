import type { Page } from '@playwright/test';
import { defaultUi } from '../../../../../src/shared/defaults';
import type { UiState } from '../../../../../src/shared/types';
import { HOME, PROJECT, session } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { row, tab, tabLabel, tabs } from '../../../support/window';

// The strip lists what is RUNNING, in tab order: projects in the order you set, and within one its loose tabs and then its groups in registry order, which is the tab bar's own order (`orderAsTabs`, one implementation for both).
// It keeps still: a session writing a message or waiting moves no row, which recency- or attention-ordering did (6f04c95).
const OTHER = `${HOME}/projects/other`;
const loose = session({ id: '00000000-0000-4000-8000-0000000000e1', title: 'Loose in demo' });
const inFirst = session({ id: '00000000-0000-4000-8000-0000000000e2', title: 'In First' });
const inSecond = session({ id: '00000000-0000-4000-8000-0000000000e3', title: 'In Second' });
const elsewhere = session({ id: '00000000-0000-4000-8000-0000000000e4', title: 'In other', cwd: OTHER, repoRoot: OTHER });
const all = [loose, inFirst, inSecond, elsewhere];

/** The strip as it reads: each project's name, then its rows. */
const strip = (page: Page): Promise<string[]> =>
  page.locator('#footer-list > .footer-project, #footer-list > .footer-item .footer-item-name').allTextContents();

test('the attention strip lists running sessions in the order you set, and keeps still while they work', async ({ app, page }) => {
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
  await expect(page.locator('#sidebar-footer')).toBeHidden();

  // Running is what puts a session in the strip, so start every tab, in the order they were opened.
  for (const s of [elsewhere, inFirst, inSecond, loose]) await tabLabel(page, s.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(4);

  const expected = ['demo', loose.title, inSecond.title, inFirst.title, 'other', elsewhere.title];
  await expect.poll(() => strip(page)).toEqual(expected);

  // Work arriving in any order moves nothing.
  for (const [s, status] of [[inFirst, 'busy'], [elsewhere, 'waiting'], [loose, 'idle'], [inFirst, 'waiting']] as const) {
    expect(await app.emit('onSessionStatus', s.id, status, '')).toBe(1);
  }
  await expect(page.locator('#footer-label')).toHaveText('3 of 4 need you');
  expect(await strip(page)).toEqual(expected);
});

// The strip is how you get back to a running session in another project: a row takes you to its project, its tab and its row.
test('a strip row jumps to its session in another project: the project, the tab on show, the row', async ({ app, page }) => {
  await app.boot({ sessions: [loose, elsewhere], projectOrder: [PROJECT, OTHER], activeProject: null, openSessions: [loose.id, elsewhere.id], history: { [loose.id]: [], [elsewhere.id]: [] } });
  await tabLabel(page, elsewhere.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  // Scoped to the other project, where its tab is out of sight.
  await page.locator('#switcher-current').click();
  await page.locator('.switcher-item', { has: page.locator('.switcher-item-name', { hasText: /^demo$/ }) }).click();
  await expect(tabLabel(page, elsewhere.title)).toHaveCount(0);

  await page.locator('#footer-list .footer-item-jump', { hasText: elsewhere.title }).click();
  await expect(page.locator('#switcher-name')).toHaveText('other');
  await expect(tab(page, elsewhere.title)).toHaveClass(/\bactive\b/);
  await expect(row(page, elsewhere.title)).toHaveClass(/\bactive-session\b/);
  // Already running: nothing started again.
  expect(await app.calls('startTerminal')).toHaveLength(1);
});

// Stopping from the strip is the way to stop a session in another project without leaving the one you are in: it stops, never closes, and the row leaves the strip once nothing runs there.
test("the strip's stop button stops the session, keeps its tab cold, and the row leaves the strip", async ({ app, page }) => {
  await app.boot({ sessions: [loose], openSessions: [loose.id], history: { [loose.id]: [] } });
  await tabLabel(page, loose.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const stop = page.locator('#footer-list .footer-item-stop');

  await stop.click();
  expect(await app.calls('closeTerminal')).toEqual([[1]]);
  // On its way out, on both of its buttons: the strip's and the tab's.
  await expect(stop).toBeDisabled();
  await expect(tabs(page).locator('.tab-close')).toBeDisabled();

  await app.emit('onTerminalExit', 1, 0);
  await expect(tab(page, loose.title)).toHaveClass(/\bcold\b/);
  await expect(page.locator('#sidebar-footer')).toBeHidden();
});

/** Whether the strip was last stored expanded: the view is saved on a debounce, so read with a poll. */
const savedExpanded = async (app: App): Promise<boolean | undefined> => ((await app.calls('setUiState')).at(-1)?.[0] as UiState | undefined)?.footerExpanded;

// The strip folds to its one line and opens again from that line, and stays the way it was left, across a restart too.
test('the strip folds from its line and opens again, and the fold is kept', async ({ app, page }) => {
  await app.boot({ sessions: [loose], openSessions: [loose.id], history: { [loose.id]: [] } });
  await tabLabel(page, loose.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const toggle = page.locator('#footer-toggle');
  const list = page.locator('#footer-list');
  await expect(list).toBeVisible();

  await toggle.click();
  await expect(list).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect.poll(() => savedExpanded(app)).toBe(false);

  await toggle.click();
  await expect(list).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => savedExpanded(app)).toBe(true);
});

test('a strip folded last time comes back folded', async ({ app, page }) => {
  await app.boot({ sessions: [loose], openSessions: [loose.id], history: { [loose.id]: [] }, uiState: { ...defaultUi(), footerExpanded: false } });
  await tabLabel(page, loose.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await expect(page.locator('#sidebar-footer')).toBeVisible();
  await expect(page.locator('#footer-list')).toBeHidden();
  await expect(page.locator('#footer-toggle')).toHaveAttribute('aria-expanded', 'false');
});
