import type { Locator, Page } from '@playwright/test';
import { HOME, PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { headings, projectHeading, switcherNames, tabBarProjects, tabLabel } from '../../../../support/window';

// A project's name and place are yours to set from its heading, and every surface that shows projects follows at once: the list, the switcher and the tab bar (the one-behaviour rule in CLAUDE.md).
const OTHER = `${HOME}/projects/other`;
const inDemo = session({ id: '00000000-0000-4000-8000-0000000000d1', title: 'In demo' });
const inOther = session({ id: '00000000-0000-4000-8000-0000000000d2', title: 'In other', cwd: OTHER, repoRoot: OTHER });
const fixture = {
  sessions: [inDemo, inOther],
  projectOrder: [PROJECT, OTHER],
  activeProject: null,
  openSessions: [inDemo.id, inOther.id],
  history: { [inDemo.id]: [], [inOther.id]: [] },
};

/** The switcher's projects, All left out. */
const switcherItems = (page: Page): Locator => switcherNames(page).filter({ hasNotText: /^All$/ });
const projectMenu = async (page: Page, name: string, label: string): Promise<void> => {
  await projectHeading(page, name).locator('.project-kebab').click();
  await page.locator('.kebab-menu button', { hasText: label }).click();
};

test('moving a project moves it in the list, the switcher and the tab bar together', async ({ app, page }) => {
  await app.boot(fixture);
  await expect(headings(page)).toHaveText(['demo', 'other']);
  await expect(switcherItems(page)).toHaveText(['demo', 'other']);
  await expect(tabBarProjects(page)).toHaveText(['demo', 'other']);

  await projectMenu(page, 'other', 'Move up');
  await expect(headings(page)).toHaveText(['other', 'demo']);
  await expect(switcherItems(page)).toHaveText(['other', 'demo']);
  await expect(tabBarProjects(page)).toHaveText(['other', 'demo']);
  expect(await app.calls('moveProject')).toEqual([[OTHER, 'up']]);
});

test('renaming a project renames it in the list, the switcher, the tab bar and its tabs, and its folder\'s name clears the rename', async ({ app, page }) => {
  await app.boot(fixture);
  const rename = async (name: string): Promise<void> => {
    await expect(page.locator('#rename-overlay')).toBeVisible();
    await page.locator('#rename-input').fill(name);
    await page.locator('#rename-ok').click();
    await expect(page.locator('#rename-overlay')).toBeHidden();
  };

  await projectMenu(page, 'demo', 'Rename…');
  await rename('Demo app');
  await expect(headings(page)).toHaveText(['Demo app', 'other']);
  await expect(switcherItems(page)).toHaveText(['Demo app', 'other']);
  await expect(tabBarProjects(page)).toHaveText(['Demo app', 'other']);
  await expect(tabLabel(page, inDemo.title)).toHaveAttribute('data-tooltip', `Demo app · ${inDemo.title}`);

  await projectMenu(page, 'Demo app', 'Rename…');
  await rename('demo');
  await expect(headings(page)).toHaveText(['demo', 'other']);
  await expect(tabBarProjects(page)).toHaveText(['demo', 'other']);
  expect(await app.calls('setProjectName')).toEqual([[PROJECT, 'Demo app'], [PROJECT, '']]);
});
