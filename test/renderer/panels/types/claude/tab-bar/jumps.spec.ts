import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/defaults';
import { HOME, PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { row, tabLabel } from '../../../../support/window';

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

interface Flash {
  flashed: boolean;
  /** The flash's last frame, held there: a jump's wash fades into the element's own background rather than ending on another colour and snapping to its own. */
  end: string;
  own: string;
}

/**
 * Press `label` and read what its jump flashed — the heading of the section named `name`, a project's or a group's — in ONE step in the page.
 * The jump is synchronous, and the flash takes its class off by a timer after 900 ms, so reading it in steps of their own raced that timer on a loaded machine (seen as "no flash running"); nothing can run between a click and a read made in one go.
 */
const jumpAndRead = (label: Locator, kind: 'project' | 'group', name: string): Promise<Flash | 'no heading' | 'no flash running'> =>
  label.evaluate(
    (el, { kind, name }) => {
      (el as HTMLElement).click();
      const selector = kind === 'project' ? '.project > .section-heading' : '.group > .section-heading';
      const heading = [...document.querySelectorAll<HTMLElement>(selector)].find((each) => each.querySelector('.label')?.textContent === name);
      if (!heading) return 'no heading';
      const flashed = heading.classList.contains('flash');
      const animation = heading.getAnimations().find((a) => (a as CSSAnimation).animationName === 'jump-flash');
      if (!animation) return 'no flash running';
      animation.pause();
      animation.currentTime = 899;
      const end = getComputedStyle(heading).backgroundColor;
      heading.classList.remove('flash');
      return { flashed, end, own: getComputedStyle(heading).backgroundColor };
    },
    { kind, name },
  );

const projectHeading = (page: Page, name: string): Locator => page.locator('.project > .section-heading', { has: page.locator('.label', { hasText: new RegExp(`^${name}$`) }) });

test("a project's tab-bar label scrolls the sidebar to its heading and flashes it", async ({ app, page }) => {
  await app.boot(fixture);
  const heading = projectHeading(page, 'target');
  await expect(heading).not.toBeInViewport();

  const flash = await jumpAndRead(page.locator('.tab-project-label', { hasText: /^target$/ }), 'project', 'target');
  expect(flash).toEqual(expect.objectContaining({ flashed: true }));
  const { end, own } = flash as Flash;
  expect(end).toBe(own);
  await expect(heading).toBeInViewport();
});

test("a tab's click shows where its session lives: its project and group unfolded, its row scrolled into view", async ({ app, page }) => {
  await app.boot({ ...fixture, history: { [grouped.id]: [] }, uiState: { ...defaultUi(), collapsedProjects: [TARGET], collapsedGroups: ['g-work'] } });
  const itsRow = row(page, grouped.title);
  await expect(itsRow).toBeHidden();

  await tabLabel(page, grouped.title).click();
  await expect(itsRow).toBeVisible();
  await expect(itsRow).toBeInViewport();
  await expect(projectHeading(page, 'target').locator('..')).not.toHaveClass(/\bcollapsed\b/);
});

test("a group's tab-bar label unfolds its project and group, scrolls to the group's heading and flashes it", async ({ app, page }) => {
  await app.boot({ ...fixture, uiState: { ...defaultUi(), collapsedProjects: [TARGET], collapsedGroups: ['g-work'] } });
  const group = page.locator('.group', { has: page.locator('.section-heading .label', { hasText: /^Work$/ }) });
  await expect(group).toBeHidden();

  const flash = await jumpAndRead(page.locator('.tab-group-label', { hasText: /^Work$/ }), 'group', 'Work');
  expect(flash).toEqual(expect.objectContaining({ flashed: true }));
  const { end, own } = flash as Flash;
  expect(end).toBe(own);
  await expect(group.locator('> .section-heading')).toBeInViewport();
  await expect(group).not.toHaveClass(/collapsed/);
  await expect(row(page, grouped.title)).toBeVisible();
});
