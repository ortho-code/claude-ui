import type { Locator, Page } from '@playwright/test';
import { HOME, PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';

// Selecting a project is a statement about what you are looking at, so every surface honours it (docs/architecture.md § UI conventions): the list, the tab bar, and the tab on show, which is the one you were last in there, selected and not started (§ Tab lifecycle).
const OTHER = `${HOME}/projects/other`;
const here = session({ id: '00000000-0000-4000-8000-0000000000c1', title: 'Over here' });
const there = session({ id: '00000000-0000-4000-8000-0000000000c2', title: 'Over there', cwd: OTHER, repoRoot: OTHER });
const fixture = {
  sessions: [here, there],
  projectOrder: [PROJECT, OTHER],
  activeProject: null,
  openSessions: [here.id, there.id],
  activeSessionByProject: { [OTHER]: there.id },
  history: { [here.id]: [], [there.id]: [] },
};

const headings = (page: Page): Locator => page.locator('#sessions .project > .section-heading .label');
const tabs = (page: Page): Locator => page.locator('#tabbar .tab-label');
const entry = (page: Page, name: string): Locator => page.locator('.switcher-item', { has: page.locator('.switcher-item-name', { hasText: new RegExp(`^${name}$`) }) });

test("selecting a project scopes the list and the tab bar to it and selects the tab you were last in there, without starting it; All undoes it", async ({ app, page }) => {
  await app.boot(fixture);
  await expect(page.locator('#switcher-name')).toHaveText('All');
  await expect(headings(page)).toHaveText(['demo', 'other']);
  await expect(tabs(page)).toHaveText([here.title, there.title]);

  await page.locator('#switcher-current').click();
  await entry(page, 'other').click();
  await expect(page.locator('#switcher-popover')).toBeHidden();
  await expect(page.locator('#switcher-name')).toHaveText('other');
  await expect(headings(page)).toHaveText(['other']);
  await expect(tabs(page)).toHaveText([there.title]);
  await expect(page.locator('.tab', { hasText: there.title })).toHaveClass(/\bactive\b/);
  await expect(page.locator('#term-placeholder')).toContainText(`“${there.title}” isn’t running.`);
  expect(await app.calls('startTerminal')).toEqual([]);
  expect((await app.calls('setActiveProject')).at(-1)).toEqual([OTHER]);

  await page.locator('#switcher-current').click();
  await entry(page, 'All').click();
  await expect(page.locator('#switcher-name')).toHaveText('All');
  await expect(headings(page)).toHaveText(['demo', 'other']);
  await expect(tabs(page)).toHaveText([here.title, there.title]);
  expect((await app.calls('setActiveProject')).at(-1)).toEqual([null]);
});

test('the switcher lists every project with its count, whatever the list is filtered to', async ({ app, page }) => {
  await app.boot({ ...fixture, openSessions: [] });
  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill(here.title);
  await expect(headings(page)).toHaveText(['demo']);

  await page.locator('#switcher-current').click();
  await expect(page.locator('.switcher-item .switcher-item-name')).toHaveText(['All', 'demo', 'other']);
  await expect(page.locator('.switcher-item .switcher-item-count')).toHaveText(['2', '1', '1']);
});

test('the switcher shuts on its own button and on a click outside it, choosing nothing', async ({ app, page }) => {
  await app.boot({ ...fixture, openSessions: [] });
  const popover = page.locator('#switcher-popover');
  await page.locator('#switcher-current').click();
  await expect(popover).toBeVisible();
  await expect(page.locator('#switcher-current')).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#switcher-current').click();
  await expect(popover).toBeHidden();

  await page.locator('#switcher-current').click();
  await expect(popover).toBeVisible();
  await page.locator('#term-placeholder').click();
  await expect(popover).toBeHidden();
  await expect(page.locator('#switcher-current')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#switcher-name')).toHaveText('All');
});
