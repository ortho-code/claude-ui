import type { Locator, Page } from '@playwright/test';
import type { TerminalLaunch } from '../../../../../src/shared/types';
import { PROJECT, session } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { groupHeading, projectHeading } from '../../../support/window';

// A heading's menu holds the ways to start a session there, as its "+" and caret do, and the project's reaches every one of its groups, a filter's hidden ones too (docs/architecture.md § A session's menu holds everything about it).
// The creating items come first, together: New session, New worktree session…, then on a project New session in group ▸ and New group…; then the heading's own; then on a project Jump to group, the heading's jump button as an item; the moves last of all.
// An item that cannot be taken is there, unavailable and saying why: the worktree one outside a git repository, both where the project's folder is gone.
const one = session({ title: 'In the repo' });
const groups = { groups: [{ id: 'g-work', name: 'Work', repoRoot: PROJECT }, { id: 'g-empty', name: 'Empty one', repoRoot: PROJECT }], groupOf: { [one.id]: 'g-work' } };
const fixture = { sessions: [one], groupState: groups, history: { [one.id]: [] } };

/** The open menu's rows and rules, top level only, a rule as "─". */
const menuLines = (page: Page): Promise<string[]> =>
  page.locator('.kebab-menu:not(.submenu)').locator('.menu-row, .menu-separator').evaluateAll((els) => els.map((el) => (el.classList.contains('menu-separator') ? '─' : el.textContent.trim())));
const item = (page: Page, label: string, scope = '.kebab-menu:not(.submenu)'): Locator => page.locator(`${scope} button.menu-row`).filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });


test("a project's menu holds the ways to start a session there, together, before its own items", async ({ page, app }) => {
  await app.boot(fixture);
  await projectHeading(page, 'demo').locator('.project-kebab').click();
  // Its one project has nowhere to move.
  expect(await menuLines(page)).toEqual(['New session', 'New worktree session…', 'New session in group', 'New group…', '─', 'Rename…', 'Copy path', '─', 'Jump to group']);
  await item(page, 'New session').click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const [[cwd]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  expect(cwd).toBe(PROJECT);
  expect(await app.calls('moveSessionToGroup')).toEqual([]);
});

test("a group's menu holds the ways to start a session in it, before its own items", async ({ page, app }) => {
  await app.boot(fixture);
  await groupHeading(page, 'Work').locator('.group-kebab').click();
  expect(await menuLines(page)).toEqual(['New session', 'New worktree session…', '─', 'Rename…', 'Delete group', '─', 'Move down', 'Move to bottom']);
  await item(page, 'New session').click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const [[cwd, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  expect(cwd).toBe(PROJECT);
  expect(await app.calls('moveSessionToGroup')).toEqual([[launch.sessionId, 'g-work']]);
});

test("a project's New session in group reaches every group it has, one a filter hides too", async ({ page, app }) => {
  await app.boot(fixture);
  // The filter leaves `one` and so the project, and hides the group with nothing in it.
  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill('In the repo');
  await expect(groupHeading(page, 'Empty one')).toHaveCount(0);
  await projectHeading(page, 'demo').locator('.project-kebab').click();
  await item(page, 'New session in group').hover();
  await expect(page.locator('.kebab-menu.submenu button.menu-row')).toHaveText(['Work', 'Empty one']);
  await item(page, 'Empty one', '.kebab-menu.submenu').click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  expect(await app.calls('moveSessionToGroup')).toEqual([[launch.sessionId, 'g-empty']]);
});

test('outside a git repository the caret stays, and the worktree item says why it is unavailable, in the dropdown and the menus alike', async ({ page, app }) => {
  const plain = session({ title: 'Not in a repo', isRepo: false });
  await app.boot({ ...fixture, sessions: [plain], groupState: { ...groups, groupOf: { [plain.id]: 'g-work' } }, history: { [plain.id]: [] } });
  for (const opener of [
    projectHeading(page, 'demo').locator('.project-add-caret'),
    projectHeading(page, 'demo').locator('.project-kebab'),
    groupHeading(page, 'Work').locator('.group-add-caret'),
    groupHeading(page, 'Work').locator('.group-kebab'),
  ]) {
    await opener.click();
    await expect(item(page, 'New worktree session…')).toHaveClass(/\bunavailable\b/);
    await expect(item(page, 'New worktree session…')).toHaveAttribute('data-tooltip', 'Not a git repository');
    await expect(item(page, 'New session')).not.toHaveClass(/\bunavailable\b/);
    await page.keyboard.press('Escape');
  }
});

test("where the project's folder is gone, the ways to start a session are in its menus, unavailable with the reason", async ({ page, app }) => {
  const gone = session({ title: 'Folder gone', cwdExists: false, repoRootExists: false });
  await app.boot({ ...fixture, sessions: [gone], groupState: { ...groups, groupOf: { [gone.id]: 'g-work' } }, history: { [gone.id]: [] } });
  const reason = `This project's folder is gone, so nothing in it can run: ${PROJECT}`;
  for (const opener of [projectHeading(page, 'demo').locator('.project-kebab'), groupHeading(page, 'Work').locator('.group-kebab')]) {
    await opener.click();
    for (const label of ['New session', 'New worktree session…']) await expect(item(page, label)).toHaveAttribute('data-tooltip', reason);
    await page.keyboard.press('Escape');
  }
  await projectHeading(page, 'demo').locator('.project-kebab').click();
  await expect(item(page, 'New session in group')).toHaveAttribute('data-tooltip', reason);
});

// Whether a project is a git repository is a fact about its folder, so every session the app knows there answers it, not only the ones a filter shows.
test('a filter that shows only a session git could not place leaves the worktree item available', async ({ page, app }) => {
  const placed = session({ id: '00000000-0000-4000-8000-0000000000e1', title: 'Placed by git' });
  const unplaced = session({ id: '00000000-0000-4000-8000-0000000000e2', title: 'Git timed out', isRepo: false });
  await app.boot({ sessions: [placed, unplaced], history: { [placed.id]: [], [unplaced.id]: [] } });
  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill('Git timed out');
  await projectHeading(page, 'demo').locator('.project-add-caret').click();
  await expect(item(page, 'New worktree session…')).not.toHaveClass(/\bunavailable\b/);
});

test("a project's Jump to group holds what its heading's jump button does, and goes there", async ({ page, app }) => {
  await app.boot(fixture);
  await projectHeading(page, 'demo').locator('.project-groups').click();
  const fromButton = await page.locator('.kebab-menu .menu-row .menu-item-label').allTextContents();
  await page.keyboard.press('Escape');
  await projectHeading(page, 'demo').locator('.project-kebab').click();
  await item(page, 'Jump to group').hover();
  await expect(page.locator('.kebab-menu.submenu .menu-row .menu-item-label')).toHaveText(fromButton);
  expect(fromButton).toEqual(['Work', 'Empty one']);
  await page.locator('.kebab-menu.submenu .menu-row').filter({ hasText: 'Empty one' }).click();
  await expect(groupHeading(page, 'Empty one')).toHaveClass(/\bflash\b/);
});

// The button is left out below two places to go, for the room on the heading; the item stays, saying why.
test("with one place to jump to, a project's Jump to group is unavailable and says why", async ({ page, app }) => {
  await app.boot({ ...fixture, groupState: { groups: [groups.groups[0]], groupOf: groups.groupOf } });
  await expect(projectHeading(page, 'demo').locator('.project-groups')).toBeHidden();
  await projectHeading(page, 'demo').locator('.project-kebab').click();
  await expect(item(page, 'Jump to group')).toHaveAttribute('data-tooltip', 'Nowhere else to jump to in this project');
});
