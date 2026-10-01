import type { Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/defaults';
import type { UiState } from '../../../../../../src/shared/types';
import { HOME, PROJECT, session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { group, groupHeading, groupHeadings, projectHeading, row, tabBarGroupRow, tabBarGroups, tabBarProjectRow, tabLabelsIn, titlesIn } from '../../../../support/window';

// A group is made, renamed, moved and deleted from the list, and the tab bar, which clusters tabs by group, follows every change at once (the one-behaviour rule in CLAUDE.md).
const OTHER = `${HOME}/projects/other`;
const loose = session({ id: '00000000-0000-4000-8000-0000000000e1', title: 'Loose session' });
const inAlpha = session({ id: '00000000-0000-4000-8000-0000000000e2', title: 'In Alpha' });
const inBeta = session({ id: '00000000-0000-4000-8000-0000000000e3', title: 'In Beta' });
const elsewhere = session({ id: '00000000-0000-4000-8000-0000000000e4', title: 'Over there', cwd: OTHER, repoRoot: OTHER });
const sessions = [loose, inAlpha, inBeta, elsewhere];
const fixture = {
  sessions,
  projectOrder: [PROJECT, OTHER],
  activeProject: null,
  openSessions: sessions.map((s) => s.id),
  history: Object.fromEntries(sessions.map((s) => [s.id, []])),
  groupState: {
    groups: [
      { id: 'g-beta', name: 'Beta', repoRoot: PROJECT },
      { id: 'g-alpha', name: 'Alpha', repoRoot: PROJECT },
    ],
    groupOf: { [inAlpha.id]: 'g-alpha', [inBeta.id]: 'g-beta' },
  },
};

const groupMenu = async (page: Page, name: string, label: string): Promise<void> => {
  await groupHeading(page, name).locator('.group-kebab').click();
  await page.locator('.kebab-menu button', { hasText: label }).click();
};
const answerPrompt = async (page: Page, text: string): Promise<void> => {
  await expect(page.locator('#rename-overlay')).toBeVisible();
  await page.locator('#rename-input').fill(text);
  await page.locator('#rename-ok').click();
  await expect(page.locator('#rename-overlay')).toBeHidden();
};

test('a group made from a row takes the row, and its tab moves into the group\'s row in the tab bar', async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, loose.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button', { hasText: 'Move to group' }).click();
  await page.locator('.kebab-menu.submenu button', { hasText: 'New group…' }).click();
  await answerPrompt(page, 'Gamma');

  // At the top of its project, holding the row it was made from.
  await expect(groupHeadings(page)).toHaveText(['Gamma', 'Beta', 'Alpha']);
  await expect(titlesIn(group(page, 'Gamma'))).toHaveText([loose.title]);
  await expect(tabBarGroups(page)).toHaveText(['Gamma', 'Beta', 'Alpha']);
  await expect(tabLabelsIn(tabBarGroupRow(page, 'Gamma'))).toHaveText([loose.title]);
  expect(await app.calls('createGroup')).toEqual([['Gamma', PROJECT, loose.id]]);
});

test('moving, renaming and deleting a group shows in the list and the tab bar together', async ({ app, page }) => {
  await app.boot(fixture);
  await expect(groupHeadings(page)).toHaveText(['Beta', 'Alpha']);
  await expect(tabBarGroups(page)).toHaveText(['Beta', 'Alpha']);

  await groupMenu(page, 'Alpha', 'Move to top');
  await expect(groupHeadings(page)).toHaveText(['Alpha', 'Beta']);
  await expect(tabBarGroups(page)).toHaveText(['Alpha', 'Beta']);

  await groupMenu(page, 'Alpha', 'Rename…');
  await answerPrompt(page, 'Delta');
  await expect(groupHeadings(page)).toHaveText(['Delta', 'Beta']);
  await expect(tabBarGroups(page)).toHaveText(['Delta', 'Beta']);

  // Its session goes back under the project, and its tab back into the project's own row.
  await groupMenu(page, 'Delta', 'Delete group');
  await expect(groupHeadings(page)).toHaveText(['Beta']);
  await expect(tabBarGroups(page)).toHaveText(['Beta']);
  await expect(tabLabelsIn(tabBarProjectRow(page, 'demo'))).toHaveText([loose.title, inAlpha.title]);
  expect(await app.calls('moveGroup')).toEqual([['g-alpha', 'top']]);
  expect(await app.calls('renameGroup')).toEqual([['g-alpha', 'Delta']]);
  expect(await app.calls('deleteGroup')).toEqual([['g-alpha']]);
});

test('a stored fold of a group that is gone is forgotten, and the fold of one that is there kept', async ({ app, page }) => {
  const uiState: UiState = { ...defaultUi(), collapsedGroups: ['g-gone', 'g-alpha'] };
  await app.boot({ ...fixture, uiState });
  await expect(group(page, 'Alpha')).toHaveClass(/\bcollapsed\b/);

  // Any change to the sidebar writes its folds; what it writes no longer names the group that is gone.
  await projectHeading(page, 'other').click();
  await expect.poll(async () => (await saved(app))?.collapsedGroups).toEqual(['g-alpha']);
  expect((await app.calls('setUiState')).some(([ui]) => (ui as UiState).collapsedGroups.includes('g-gone'))).toBe(false);
});

/** What the window last asked main to keep of the sidebar: saved on a debounce, so read with a poll. */
const saved = async (app: App): Promise<UiState | undefined> => (await app.calls('setUiState')).at(-1)?.[0] as UiState | undefined;
