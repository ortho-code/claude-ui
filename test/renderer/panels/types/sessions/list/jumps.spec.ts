import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/defaults';
import { HOME, PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { group, groupHeading, projectHeading, row } from '../../../../support/window';

// A project's heading jumps to one of its groups, or to where its loose rows start, from a menu (docs/architecture.md § UI conventions); the jump's flash is the tab bar's group jump's too, and is checked there (tab-bar/jumps.spec.ts).
const OTHER = `${HOME}/projects/other`;
const THIRD = `${HOME}/projects/third`;
// Enough rows in the first group that what follows it starts out of sight.
const inBeta = Array.from({ length: 30 }, (_, i) => session({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, title: `Beta work ${i}` }));
const inAlpha = session({ id: '00000000-0000-4000-8000-0000000000b1', title: 'In Alpha' });
const loose = session({ id: '00000000-0000-4000-8000-0000000000b2', title: 'A loose one' });
const onlyLoose = session({ id: '00000000-0000-4000-8000-0000000000b3', title: 'Loose elsewhere', cwd: OTHER, repoRoot: OTHER });
const alone = session({ id: '00000000-0000-4000-8000-0000000000b4', title: 'In Solo', cwd: THIRD, repoRoot: THIRD });
const fixture = {
  sessions: [...inBeta, inAlpha, loose, onlyLoose, alone],
  projectOrder: [PROJECT, OTHER, THIRD],
  activeProject: null,
  groupState: {
    groups: [
      { id: 'g-beta', name: 'Beta', repoRoot: PROJECT },
      { id: 'g-alpha', name: 'Alpha', repoRoot: PROJECT },
      { id: 'g-solo', name: 'Solo', repoRoot: THIRD },
    ],
    groupOf: { ...Object.fromEntries(inBeta.map((s) => [s.id, 'g-beta'])), [inAlpha.id]: 'g-alpha', [alone.id]: 'g-solo' },
  },
};

/** The project heading's button that opens its jump menu. */
const jumpButton = (page: Page, name: string): Locator => projectHeading(page, name).locator('.project-groups');

/** The open menu as it reads: each entry's name and count, a rule as "—". */
const menuLines = (page: Page): Promise<string[]> =>
  page.locator('.kebab-menu').evaluate((menu) =>
    [...menu.children].map((child) =>
      child.classList.contains('menu-separator') ? '—' : `${child.querySelector('.menu-item-label')?.textContent} ${child.querySelector('.menu-item-count')?.textContent}`,
    ),
  );

test("a project's jump menu lists its groups in their order, then its loose rows after a rule, each with its count", async ({ app, page }) => {
  await app.boot(fixture);
  await jumpButton(page, 'demo').click();
  expect(await menuLines(page)).toEqual(['Beta 30', 'Alpha 1', '—', 'Ungrouped 1']);
});

test('a pick in the jump menu takes the list there, unfolding a folded group on the way', async ({ app, page }) => {
  await app.boot({ ...fixture, uiState: { ...defaultUi(), collapsedGroups: ['g-alpha'] } });
  await expect(groupHeading(page, 'Alpha')).not.toBeInViewport();

  await jumpButton(page, 'demo').click();
  await page.locator('.kebab-menu button', { hasText: 'Alpha' }).click();
  await expect(groupHeading(page, 'Alpha')).toBeInViewport();
  await expect(group(page, 'Alpha')).not.toHaveClass(/\bcollapsed\b/);
  await expect(row(page, inAlpha.title)).toBeVisible();

  await page.locator('#sessions').evaluate((list) => (list.scrollTop = 0));
  await expect(row(page, loose.title)).not.toBeInViewport();
  await jumpButton(page, 'demo').click();
  await page.locator('.kebab-menu button', { hasText: 'Ungrouped' }).click();
  await expect(row(page, loose.title)).toBeInViewport();
});

test('a project with fewer than two places to jump to has no jump menu', async ({ app, page }) => {
  await app.boot(fixture);
  await expect(jumpButton(page, 'demo')).toBeVisible();
  // Only loose rows, and only one group: one place each.
  await expect(jumpButton(page, 'other')).toBeHidden();
  await expect(jumpButton(page, 'third')).toBeHidden();
});

test('the jump menu is unavailable while a filter is on', async ({ app, page }) => {
  await app.boot(fixture);
  await page.locator('#filter-toggle').click();
  // Matches a row in each group and the loose one, so every place is still drawn.
  await page.locator('#search').fill('a');
  await expect(jumpButton(page, 'demo')).toBeVisible();
  await expect(jumpButton(page, 'demo')).toBeDisabled();
});
