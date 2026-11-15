import type { Locator, Page } from '@playwright/test';
import { HOME, PROJECT, session } from '../support/fixture';
import { expect, test } from '../support/harness';
import { projectHeading, row, switcherEntry } from '../support/window';

// A menu, the switcher's list and a notification have room to grow, so what they say wraps rather than being cut, a menu item's label too (docs/architecture/ui-conventions.md § UI conventions).
// The names here are far longer than any line has room for, with spaces and without, since a name without a break point is the one that runs out of its box.
const LONG_TITLE =
  'Investigate why the review panel shows a stale approval after GitHub dismisses it on a force-push to the branch, and add a check that fails on it before anything else in the panel changes';
const LONG_GROUP = 'Everything about the review panel: stale approvals, force-push dismissals, the follow-ups they need and the checks for them';
const UNBROKEN_GROUP = 'release_2026_11_15_hotfix_for_stale_approval_after_force_push';
const UNBROKEN_PROJECT = `${HOME}/projects/woodwing_studio_server_integration_tests_and_fixtures`;

/** What of `boxes` is cut: wider or taller inside than its box shows, by the text each holds. */
const cut = (boxes: Locator): Promise<string[]> =>
  boxes.evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight).map((el) => el.textContent));

/** How many lines `box` shows, counted by where its text's own line boxes start. */
const linesShown = (box: Locator): Promise<number> =>
  box.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const bottom = el.getBoundingClientRect().bottom;
    return new Set([...range.getClientRects()].filter((rect) => rect.top < bottom - 1).map((rect) => Math.round(rect.top))).size;
  });

test("a session's menu shows its whole name, wrapped, in a menu still 300px wide, and no header line needs a tooltip", async ({ app, page }) => {
  const long = session({ title: LONG_TITLE });
  await app.boot({ sessions: [long] });
  await row(page, LONG_TITLE).locator('.session-kebab').click();
  expect(Math.round((await page.locator('.kebab-menu').boundingBox())!.width)).toBe(300);
  const lines = page.locator('.kebab-menu .menu-header .menu-header-line');
  await expect(lines.first()).toHaveText(LONG_TITLE);
  expect(await cut(lines)).toEqual([]);
  expect(await linesShown(lines.first())).toBeGreaterThan(1);
  await expect(page.locator('.kebab-menu .menu-header [data-tooltip]')).toHaveCount(0);
});

test("a menu item's label wraps in full, a name without a break point breaking inside the menu", async ({ app, page }) => {
  const inLong = session({ id: '00000000-0000-4000-8000-0000000000c1', title: 'In the long group' });
  const inUnbroken = session({ id: '00000000-0000-4000-8000-0000000000c2', title: 'In the unbroken group' });
  await app.boot({
    sessions: [inLong, inUnbroken],
    groupState: {
      groups: [
        { id: 'g-long', name: LONG_GROUP, repoRoot: PROJECT },
        { id: 'g-unbroken', name: UNBROKEN_GROUP, repoRoot: PROJECT },
      ],
      groupOf: { [inLong.id]: 'g-long', [inUnbroken.id]: 'g-unbroken' },
    },
  });
  await projectHeading(page, 'demo').locator('.project-groups').click();
  const menu = page.locator('.kebab-menu');
  const labels = menu.locator('.menu-row .menu-item-label');
  const long = labels.filter({ hasText: LONG_GROUP });
  const unbroken = labels.filter({ hasText: UNBROKEN_GROUP });
  // Neither is cut, nor runs out of the menu's side, and each takes the lines it needs.
  expect(await cut(labels)).toEqual([]);
  expect(await menu.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await linesShown(unbroken)).toBeGreaterThan(1);
  expect(await linesShown(long)).toBeGreaterThan(2);
});

test("the switcher's list shows a project's whole name, wrapped", async ({ app, page }) => {
  const here = session({ id: '00000000-0000-4000-8000-0000000000e1', title: 'Over here' });
  const there = session({ id: '00000000-0000-4000-8000-0000000000e2', title: 'Over there', cwd: UNBROKEN_PROJECT, repoRoot: UNBROKEN_PROJECT });
  await app.boot({ sessions: [here, there], projectOrder: [PROJECT, UNBROKEN_PROJECT] });
  await page.locator('#switcher-current').click();
  const name = switcherEntry(page, 'woodwing_studio_server_integration_tests_and_fixtures').locator('.switcher-item-name');
  await expect(name).toBeVisible();
  expect(await cut(name)).toEqual([]);
  expect(await linesShown(name)).toBeGreaterThan(1);
});

test("a notification shows the session's whole name, wrapped", async ({ app, page }) => {
  const OTHER = `${HOME}/projects/other`;
  const here = session({ id: '00000000-0000-4000-8000-0000000000d1', title: 'Over here' });
  const there = session({ id: '00000000-0000-4000-8000-0000000000d2', title: LONG_TITLE, cwd: OTHER, repoRoot: OTHER });
  await app.boot({
    sessions: [here, there],
    projectOrder: [PROJECT, OTHER],
    activeProject: PROJECT,
    openSessions: [here.id, there.id],
    activeSession: here.id,
    history: { [here.id]: [], [there.id]: [] },
  });
  expect(await app.emit('onSessionStatus', there.id, 'waiting', '', '')).toBe(1);
  const title = toastTitle(page);
  await expect(title).toHaveText(LONG_TITLE);
  expect(await cut(title)).toEqual([]);
  expect(await linesShown(title)).toBeGreaterThan(1);
});

const toastTitle = (page: Page): Locator => page.locator('#notifications .notif .notif-title');
