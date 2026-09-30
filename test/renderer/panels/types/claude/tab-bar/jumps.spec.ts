import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/defaults';
import { HOME, PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';

// A tab-bar label is a jump: a project's to its heading, a group's to the group's heading, unfolding on the way, and both flash where they land (4182dd9, e646936).
const TARGET = `${HOME}/projects/target`;
// Enough rows above the target that its heading starts out of sight, so a jump that does not scroll is caught.
const filler = Array.from({ length: 40 }, (_, i) => session({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, title: `Filler ${i}` }));
const loose = session({ id: '00000000-0000-4000-8000-0000000000c1', title: 'Loose in target', cwd: TARGET, repoRoot: TARGET });
const grouped = session({ id: '00000000-0000-4000-8000-0000000000c2', title: 'Grouped in target', cwd: TARGET, repoRoot: TARGET });
const fixture = {
  sessions: [...filler, loose, grouped],
  projectOrder: [PROJECT, TARGET],
  activeProject: null,
  openSessions: [loose.id, grouped.id],
  groupState: { groups: [{ id: 'g-work', name: 'Work', repoRoot: TARGET }], groupOf: { [grouped.id]: 'g-work' } },
};

/** The flash's last frame, held there: a jump's wash fades into the element's own background rather than ending on another colour and snapping to its own. */
const nearFlashEnd = (target: Locator): Promise<string> =>
  target.evaluate((el) => {
    const animation = el.getAnimations().find((a) => (a as CSSAnimation).animationName === 'jump-flash');
    if (!animation) return 'no flash running';
    animation.pause();
    animation.currentTime = 899;
    return getComputedStyle(el).backgroundColor;
  });

const projectHeading = (page: Page, name: string): Locator => page.locator('.project > .section-heading', { has: page.locator('.label', { hasText: new RegExp(`^${name}$`) }) });

test("a project's tab-bar label scrolls the sidebar to its heading and flashes it", async ({ app, page }) => {
  await app.boot(fixture);
  const heading = projectHeading(page, 'target');
  await expect(heading).not.toBeInViewport();
  const own = await heading.evaluate((el) => getComputedStyle(el).backgroundColor);

  await page.locator('.tab-project-label', { hasText: /^target$/ }).click();
  await expect(heading).toBeInViewport();
  await expect(heading).toHaveClass(/\bflash\b/);
  expect(await nearFlashEnd(heading)).toBe(own);
});

test("a group's tab-bar label unfolds its project and group, scrolls to the group's heading and flashes it", async ({ app, page }) => {
  await app.boot({ ...fixture, uiState: { ...defaultUi(), collapsedProjects: [TARGET], collapsedGroups: ['g-work'] } });
  const group = page.locator('.group', { has: page.locator('.section-heading .label', { hasText: /^Work$/ }) });
  await expect(group).toBeHidden();

  await page.locator('.tab-group-label', { hasText: /^Work$/ }).click();
  const heading = group.locator('> .section-heading');
  await expect(heading).toBeInViewport();
  await expect(group).not.toHaveClass(/collapsed/);
  await expect(page.locator('.session', { hasText: grouped.title })).toBeVisible();
  await expect(heading).toHaveClass(/\bflash\b/);
  const own = await heading.evaluate((el) => {
    el.classList.remove('flash');
    return getComputedStyle(el).backgroundColor;
  });
  await heading.evaluate((el) => el.classList.add('flash'));
  expect(await nearFlashEnd(heading)).toBe(own);
});
