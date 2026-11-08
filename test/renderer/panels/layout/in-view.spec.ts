import type { Locator, Page } from '@playwright/test';
import type { NodeState } from '../../../../src/shared/panels';
import { type BridgeFixture, session } from '../../support/fixture';
import { expect, test } from '../../support/harness';
import { groupHeading, projectHeading, row, tab, tabBarGroup, tabBarProject, tabLabel } from '../../support/window';
import { here, keptChanges, LAYOUT, OTHER, railItem, there, withLayout } from './layout';

// A press that asks to see the session list brings it into view, from a folded group, from behind another panel and from another panel's full screen; following a session from a tab leaves the layout as it is.
const sidebar = (page: Page): Locator => page.locator('#sidebar');
const terminalArea = (page: Page): Locator => page.locator('#terminal-pane');
const unfoldSidebar = (page: Page): Locator => page.getByRole('button', { name: 'Unfold sidebar' });
const item = (page: Page, label: string): Locator => page.locator('.kebab-menu button.menu-row').filter({ hasText: new RegExp(`^${label}$`) });

// Enough rows above the other project that its heading starts out of sight once the list is on show, so a press that does not scroll is caught.
const filler = Array.from({ length: 40 }, (_, i) => session({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, title: `Filler ${i}` }));

const booted = (layout: unknown, nodes: Record<string, NodeState>): Partial<BridgeFixture> => ({
  ...withLayout(layout, nodes),
  sessions: [...filler, here, there],
  activeProject: null,
  openSessions: [here.id, there.id],
  activeSession: here.id,
  history: { [here.id]: [], [there.id]: [] },
  groupState: { groups: [{ id: 'g-work', name: 'Work', repoRoot: OTHER }], groupOf: { [there.id]: 'g-work' } },
});

/** The README's layout with the session list sharing the sidebar's group with a command panel. */
const SHARED = structuredClone(LAYOUT);
SHARED.root.columns[0].panels!.push({ id: 'status2', type: 'command', title: 'Status', icon: 'git', options: { command: 'git status --short' } });

test("a project's tab-bar label unfolds a folded sidebar and lands on the project", async ({ app, page }) => {
  await app.boot(booted(LAYOUT, { sidebar: { folded: true } }));
  await expect(sidebar(page)).toBeHidden();

  await tabBarProject(page, 'other').click();
  await expect(sidebar(page)).toBeVisible();
  await expect(projectHeading(page, 'other')).toBeInViewport();
  await expect.poll(() => keptChanges(app)).toEqual([{ id: 'sidebar', field: 'folded', value: null }]);
});

test("a group's tab-bar label unfolds a folded sidebar and lands on the group", async ({ app, page }) => {
  await app.boot(booted(LAYOUT, { sidebar: { folded: true } }));
  await tabBarGroup(page, 'Work').click();
  await expect(sidebar(page)).toBeVisible();
  await expect(groupHeading(page, 'Work')).toBeInViewport();
});

test("Show in list on a tab's menu unfolds a folded sidebar and lands on the row", async ({ app, page }) => {
  await app.boot(booted(LAYOUT, { sidebar: { folded: true } }));
  await tab(page, there.title).locator('.tab-kebab').click();
  await item(page, 'Show in list').click();
  await expect(sidebar(page)).toBeVisible();
  await expect(row(page, there.title)).toBeInViewport();
});

test("a project's tab-bar label brings the session list forward from behind another panel in its group", async ({ app, page }) => {
  await app.boot(booted(SHARED, { sidebar: { active: 'status2' } }));
  await expect(sidebar(page)).toBeHidden();

  await tabBarProject(page, 'other').click();
  await expect(sidebar(page)).toBeVisible();
  await expect(railItem(page, /^Sessions/)).toHaveClass(/\bshown\b/);
  await expect(projectHeading(page, 'other')).toBeInViewport();
});

test("a project's tab-bar label brings the layout back from the terminal area's full screen", async ({ app, page }) => {
  await app.boot(booted(LAYOUT, {}));
  await terminalArea(page).locator('.tabbar-end').getByRole('button', { name: 'Full screen' }).click();
  await expect(sidebar(page)).toBeHidden();

  await tabBarProject(page, 'other').click();
  await expect(sidebar(page)).toBeVisible();
  await expect(terminalArea(page).getByRole('button', { name: 'Full screen' })).toHaveAttribute('aria-pressed', 'false');
  await expect(projectHeading(page, 'other')).toBeInViewport();
});

test("a tab's click leaves a folded sidebar folded", async ({ app, page }) => {
  await app.boot(booted(LAYOUT, { sidebar: { folded: true } }));
  await tabLabel(page, there.title).click();
  await expect(tab(page, there.title)).toHaveClass(/\bactive\b/);
  await expect(unfoldSidebar(page)).toBeVisible();
  await expect(sidebar(page)).toBeHidden();
  expect(await keptChanges(app)).toEqual([]);
});

test("a tab's click with the sidebar folded has its row in view once the sidebar is unfolded", async ({ app, page }) => {
  await app.boot(booted(LAYOUT, { sidebar: { folded: true } }));
  await tabLabel(page, there.title).click();
  await expect(tab(page, there.title)).toHaveClass(/\bactive\b/);

  await unfoldSidebar(page).click();
  await expect(row(page, there.title)).toBeInViewport();
});

test("in Recent, a project's tab-bar label unfolds a folded sidebar and lands on the project's newest row", async ({ app, page }) => {
  await app.boot(booted(LAYOUT, { sidebar: { folded: true }, sessions: { view: 'recent' } }));
  await tabBarProject(page, 'other').click();
  await expect(sidebar(page)).toBeVisible();
  await expect(row(page, there.title)).toBeInViewport();
});
