import type { Locator, Page } from '@playwright/test';
import { HOME, PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { chooseProject, groupHeading, projectHeading } from '../../../../support/window';

// A project's and a group's options offer the moves that would move it, and never one that would do nothing: the first has no way up, the last no way down, a lone one none, and none while a filter or a project view could hide a neighbour it would move past.
const OTHER = `${HOME}/projects/other`;
const THIRD = `${HOME}/projects/third`;
const inFirst = session({ id: '00000000-0000-4000-8000-0000000000d1', title: 'In First' });
const inMiddle = session({ id: '00000000-0000-4000-8000-0000000000d2', title: 'In Middle' });
const inLast = session({ id: '00000000-0000-4000-8000-0000000000d3', title: 'In Last' });
const inLone = session({ id: '00000000-0000-4000-8000-0000000000d4', title: 'In Lone', cwd: OTHER, repoRoot: OTHER });
const inThird = session({ id: '00000000-0000-4000-8000-0000000000d5', title: 'In third, loose', cwd: THIRD, repoRoot: THIRD });
const fixture = {
  sessions: [inFirst, inMiddle, inLast, inLone, inThird],
  projectOrder: [PROJECT, OTHER, THIRD],
  activeProject: null,
  groupState: {
    groups: [
      { id: 'g-first', name: 'First', repoRoot: PROJECT },
      { id: 'g-middle', name: 'Middle', repoRoot: PROJECT },
      { id: 'g-last', name: 'Last', repoRoot: PROJECT },
      { id: 'g-lone', name: 'Lone', repoRoot: OTHER },
    ],
    groupOf: { [inFirst.id]: 'g-first', [inMiddle.id]: 'g-middle', [inLast.id]: 'g-last', [inLone.id]: 'g-lone' },
  },
};

const GROUP_OWN = ['Rename…', 'Delete group'];
const PROJECT_OWN = ['Rename…', 'Copy path', '—', 'New group…'];
const ALL_MOVES = ['Move to top', 'Move up', 'Move down', 'Move to bottom'];

/** Open the options behind `kebab` and read them as they are listed, a rule as "—". */
async function optionsOf(page: Page, kebab: Locator): Promise<string[]> {
  await kebab.click();
  return page.locator('.kebab-menu:not(.submenu)').evaluate((menu) => [...menu.children].map((child) => (child.classList.contains('menu-separator') ? '—' : child.textContent)));
}
const groupOptions = (page: Page, name: string): Promise<string[]> => optionsOf(page, groupHeading(page, name).locator('.group-kebab'));
const projectOptions = (page: Page, name: string): Promise<string[]> => optionsOf(page, projectHeading(page, name).locator('.project-kebab'));

test("a group's options move it only where it can go", async ({ app, page }) => {
  await app.boot(fixture);
  expect(await groupOptions(page, 'First')).toEqual(['Move down', 'Move to bottom', '—', ...GROUP_OWN]);
  expect(await groupOptions(page, 'Middle')).toEqual([...ALL_MOVES, '—', ...GROUP_OWN]);
  expect(await groupOptions(page, 'Last')).toEqual(['Move to top', 'Move up', '—', ...GROUP_OWN]);
  expect(await groupOptions(page, 'Lone')).toEqual(GROUP_OWN);
});

test("a project's options move it only where it can go", async ({ app, page }) => {
  await app.boot(fixture);
  expect(await projectOptions(page, 'demo')).toEqual(['Move down', 'Move to bottom', '—', ...PROJECT_OWN]);
  expect(await projectOptions(page, 'other')).toEqual([...ALL_MOVES, '—', ...PROJECT_OWN]);
  expect(await projectOptions(page, 'third')).toEqual(['Move to top', 'Move up', '—', ...PROJECT_OWN]);
});

test('while a filter is on, neither a group nor a project offers a move', async ({ app, page }) => {
  await app.boot(fixture);
  await page.locator('#filter-toggle').click();
  // Matches every row, so every group and project is still drawn.
  await page.locator('#search').fill('in');
  expect(await groupOptions(page, 'Middle')).toEqual(GROUP_OWN);
  expect(await projectOptions(page, 'other')).toEqual(PROJECT_OWN);
});

test('in a project, its heading offers no move, and its groups still do', async ({ app, page }) => {
  await app.boot(fixture);
  await chooseProject(page, 'other');
  expect(await projectOptions(page, 'other')).toEqual(PROJECT_OWN);
  await chooseProject(page, 'demo');
  expect(await groupOptions(page, 'Middle')).toEqual([...ALL_MOVES, '—', ...GROUP_OWN]);
});
