import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/defaults';
import type { UiState } from '../../../../../../src/shared/types';
import { HOME, PROJECT, session } from '../../../../support/fixture';
import { type App, expect, test } from '../../../../support/harness';
import { chooseProject, group, groupHeading, groupHeadings, headings, project, projectHeading, row, titles } from '../../../../support/window';

// The list is projects in the order you set, each holding its groups in registry order and then its loose rows, with pins floated inside their own section (docs/architecture.md § App-side metadata and session groups).
// Folds are kept, and come in two kinds (§ Reopening the way you left it): the ones you made, stored, and the ones made while a filter is on, which last as long as the filter.
const OTHER = `${HOME}/projects/other`;
const newer = session({ id: '00000000-0000-4000-8000-0000000000a1', title: 'Loose newer' });
const inAlpha = session({ id: '00000000-0000-4000-8000-0000000000a2', title: 'In Alpha' });
const elsewhere = session({ id: '00000000-0000-4000-8000-0000000000a3', title: 'Over there', cwd: OTHER, repoRoot: OTHER });
const older = session({ id: '00000000-0000-4000-8000-0000000000a4', title: 'Loose older, pinned' });
const inBeta = session({ id: '00000000-0000-4000-8000-0000000000a5', title: 'In Beta' });
const fixture = {
  // The listing's own order, which is recency.
  sessions: [newer, inAlpha, elsewhere, older, inBeta],
  // Not the order the listing meets them in.
  projectOrder: [OTHER, PROJECT],
  activeProject: null,
  pinned: [older.id],
  groupState: {
    // Registry order, which is not alphabetical.
    groups: [
      { id: 'g-beta', name: 'Beta', repoRoot: PROJECT },
      { id: 'g-alpha', name: 'Alpha', repoRoot: PROJECT },
    ],
    groupOf: { [inAlpha.id]: 'g-alpha', [inBeta.id]: 'g-beta' },
  },
};
const withUi = (ui: Partial<UiState>): { uiState: UiState } => ({ uiState: { ...defaultUi(), ...ui } });

/** The list as it reads, top to bottom: headings and rows. */
const list = (page: Page): Locator => headings(page).or(groupHeadings(page)).or(titles(page));
/** What the window last asked main to keep of the sidebar: saved on a debounce, so read with a poll. */
const saved = async (app: App): Promise<UiState | undefined> => (await app.calls('setUiState')).at(-1)?.[0] as UiState | undefined;

test('projects sit in the order you set, groups in registry order before the loose rows, and a pin floats in its own section', async ({ app, page }) => {
  await app.boot(fixture);
  await expect(list(page)).toHaveText(['other', elsewhere.title, 'demo', 'Beta', inBeta.title, 'Alpha', inAlpha.title, older.title, newer.title]);
});

test('folding a project or a group is kept', async ({ app, page }) => {
  await app.boot(fixture);
  await projectHeading(page, 'demo').click();
  await expect(project(page, 'demo')).toHaveClass(/\bcollapsed\b/);
  await expect(row(page, newer.title)).toBeHidden();
  await expect.poll(async () => (await saved(app))?.collapsedProjects).toEqual([PROJECT]);

  await projectHeading(page, 'demo').click();
  await groupHeading(page, 'Alpha').click();
  await expect(group(page, 'Alpha')).toHaveClass(/\bcollapsed\b/);
  await expect.poll(async () => (await saved(app))?.collapsedGroups).toEqual(['g-alpha']);
});

test('a fold stored last time is folded at launch', async ({ app, page }) => {
  await app.boot({ ...fixture, ...withUi({ collapsedProjects: [OTHER], collapsedGroups: ['g-beta'] }) });
  await expect(project(page, 'other')).toHaveClass(/\bcollapsed\b/);
  await expect(group(page, 'Beta')).toHaveClass(/\bcollapsed\b/);
  await expect(group(page, 'Alpha')).not.toHaveClass(/\bcollapsed\b/);
});

test('in All, collapse-all folds every project and its groups with it, and expands them again', async ({ app, page }) => {
  await app.boot(fixture);
  const toggle = page.locator('#collapse-toggle');
  await expect(toggle).toHaveAttribute('aria-label', 'Collapse all');
  await toggle.click();
  await expect(project(page, 'other')).toHaveClass(/\bcollapsed\b/);
  await expect(project(page, 'demo')).toHaveClass(/\bcollapsed\b/);
  await expect(toggle).toHaveAttribute('aria-label', 'Expand all');

  // Opening one project afterwards shows its groups as headings, folded, rather than every row at once.
  await projectHeading(page, 'demo').click();
  await expect(group(page, 'Beta')).toHaveClass(/\bcollapsed\b/);
  await expect(group(page, 'Alpha')).toHaveClass(/\bcollapsed\b/);
  await expect(toggle).toHaveAttribute('aria-label', 'Collapse all');

  await toggle.click();
  await toggle.click();
  await expect(project(page, 'other')).not.toHaveClass(/\bcollapsed\b/);
  await expect(project(page, 'demo')).not.toHaveClass(/\bcollapsed\b/);
});

test('a project folded in All opens when you choose it, and stays open when you go back to All', async ({ app, page }) => {
  await app.boot({ ...fixture, ...withUi({ collapsedProjects: [OTHER] }) });
  await expect(project(page, 'other')).toHaveClass(/\bcollapsed\b/);

  await chooseProject(page, 'other');
  await expect(row(page, elsewhere.title)).toBeVisible();
  await chooseProject(page, 'All');
  await expect(project(page, 'other')).not.toHaveClass(/\bcollapsed\b/);
  await expect.poll(async () => (await saved(app))?.collapsedProjects).toEqual([]);
});

test("in a project, the heading cannot fold and collapse-all folds that project's groups", async ({ app, page }) => {
  await app.boot({ ...fixture, activeProject: PROJECT });
  await expect(project(page, 'demo')).toHaveClass(/\bno-collapse\b/);
  await projectHeading(page, 'demo').click();
  await expect(project(page, 'demo')).not.toHaveClass(/\bcollapsed\b/);

  await page.locator('#collapse-toggle').click();
  await expect(group(page, 'Beta')).toHaveClass(/\bcollapsed\b/);
  await expect(group(page, 'Alpha')).toHaveClass(/\bcollapsed\b/);
  await expect(project(page, 'demo')).not.toHaveClass(/\bcollapsed\b/);
});

test('a filter opens every fold, a fold made under it lasts as long as the filter, and your own folds come back after', async ({ app, page }) => {
  await app.boot({ ...fixture, ...withUi({ collapsedGroups: ['g-alpha'] }) });
  await expect(group(page, 'Alpha')).toHaveClass(/\bcollapsed\b/);

  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill('alpha');
  // Open, so the match inside it is not hidden from you.
  await expect(group(page, 'Alpha')).not.toHaveClass(/\bcollapsed\b/);
  await expect(row(page, inAlpha.title)).toBeVisible();

  // A way through the results, not a statement about the sidebar.
  await projectHeading(page, 'demo').click();
  await expect(project(page, 'demo')).toHaveClass(/\bcollapsed\b/);

  await page.locator('#search').fill('');
  await expect(project(page, 'demo')).not.toHaveClass(/\bcollapsed\b/);
  await expect(group(page, 'Alpha')).toHaveClass(/\bcollapsed\b/);
  await expect.poll(async () => {
    const ui = await saved(app);
    return [ui?.collapsedProjects, ui?.collapsedGroups, ui?.filterCollapsedProjects];
  }).toEqual([[], ['g-alpha'], []]);
});
