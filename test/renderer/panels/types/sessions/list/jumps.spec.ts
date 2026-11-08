import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/defaults';
import { HOME, PROJECT, session } from '../../../../support/fixture';
import { expect, test, type App } from '../../../../support/harness';
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

// A filter has folds of its own, which a jump opens as it opens yours.
test('the jump menu works while a filter is on, and a pick unfolds a group folded under the filter', async ({ app, page }) => {
  await app.boot(fixture);
  await page.locator('#filter-toggle').click();
  // Matches a row in each group and the loose one, so every place is still drawn.
  await page.locator('#search').fill('a');
  await groupHeading(page, 'Alpha').click();
  await expect(group(page, 'Alpha')).toHaveClass(/\bcollapsed\b/);
  await expect(jumpButton(page, 'demo')).toBeEnabled();
  await expect(jumpButton(page, 'demo')).toHaveAttribute('data-tooltip', 'Jump to a group');

  await jumpButton(page, 'demo').click();
  await page.locator('.kebab-menu button', { hasText: 'Alpha' }).click();
  await expect(group(page, 'Alpha')).not.toHaveClass(/\bcollapsed\b/);
  await expect(row(page, inAlpha.title)).toBeInViewport();
});

/** Picks `name` in the demo project's jump menu. */
async function jumpTo(page: Page, name: string): Promise<void> {
  await jumpButton(page, 'demo').click();
  await page.locator('.kebab-menu button', { hasText: name }).click();
}

/** Asserts the jump landed Beta's heading right under the project heading, with its first row in view below it. */
async function expectAtBetasTop(page: Page): Promise<void> {
  const projectBottom = await projectHeading(page, 'demo').evaluate((heading) => heading.getBoundingClientRect().bottom);
  const headingBox = await groupHeading(page, 'Beta').evaluate((heading) => heading.getBoundingClientRect().toJSON() as DOMRect);
  expect(Math.abs(headingBox.top - projectBottom)).toBeLessThanOrEqual(1);
  const first = row(page, inBeta[0].title);
  await expect(first).toBeInViewport();
  const firstTop = await first.evaluate((each) => each.getBoundingClientRect().top);
  expect(firstTop).toBeGreaterThanOrEqual(headingBox.bottom - 1);
}

// A group's heading is sticky, so where it is drawn is not where its group starts: from inside the group it is already pinned, and from below the group it is pinned at the group's end.
test("a jump from inside a group lands at the group's top", async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, inBeta[15].title).evaluate((each) => each.scrollIntoView({ block: 'start' }));
  await expect(row(page, inBeta[0].title)).not.toBeInViewport();

  await jumpTo(page, 'Beta');
  await expectAtBetasTop(page);
});

test("a jump from below a group lands at the group's top", async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, loose.title).evaluate((each) => each.scrollIntoView({ block: 'start' }));
  await expect(row(page, inBeta[0].title)).not.toBeInViewport();

  await jumpTo(page, 'Beta');
  await expectAtBetasTop(page);
});

/** Boots with Alpha's session running out of sight, since the session on show lights no dot of its group's. */
async function bootWithAlphaRunning(app: App, page: Page): Promise<void> {
  await app.boot({ ...fixture, history: { [inAlpha.id]: [], [loose.id]: [] } });
  for (const [i, s] of [inAlpha, loose].entries()) {
    await row(page, s.title).click();
    await expect.poll(() => app.calls('startTerminal')).toHaveLength(i + 1);
  }
}

/** Alpha's dot in the open jump menu. */
const alphasDot = (page: Page): Locator => page.locator('.kebab-menu button', { hasText: 'Alpha' }).locator('.nudge');

// A status change repaints the rows' dots without drawing the list again.
test("a jump menu opened after a status change shows that status's dot", async ({ app, page }) => {
  await bootWithAlphaRunning(app, page);
  await jumpButton(page, 'demo').click();
  await expect(alphasDot(page)).not.toHaveClass(/\bwaiting\b/);
  await jumpButton(page, 'demo').click();

  expect(await app.emit('onSessionStatus', inAlpha.id, 'waiting', '', 'Notification')).toBe(1);
  await jumpButton(page, 'demo').click();
  await expect(alphasDot(page)).toHaveClass(/\bwaiting\b/);
});

test("an open jump menu's dots follow a status that changes while it is up", async ({ app, page }) => {
  await bootWithAlphaRunning(app, page);
  await jumpButton(page, 'demo').click();
  await expect(alphasDot(page)).not.toHaveClass(/\bwaiting\b/);

  expect(await app.emit('onSessionStatus', inAlpha.id, 'waiting', '', 'Notification')).toBe(1);
  await expect(alphasDot(page)).toHaveClass(/\bwaiting\b/);
});
