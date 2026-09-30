import type { Locator, Page } from '@playwright/test';
import { projectGoneReason, unstartableReason } from '../../../../../src/renderer/logic';
import { HOME, PROJECT, session } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';

// A project whose folder is gone is marked on every surface that names it, and nothing else about it changes: decisions 1-9 of the dead-project work (4c0e3d3 and the three before it).
const GONE = `${HOME}/projects/gone`;
const live = session({ id: '00000000-0000-4000-8000-00000000000a', title: 'A live session' });
const dead = session({ id: '00000000-0000-4000-8000-00000000000b', title: 'A session in a gone folder', cwd: GONE, repoRoot: GONE, cwdExists: false, repoRootExists: false });
// Transcripts with nothing in them: a tab on show has its history read, and neither session's history is what is checked here.
const both = { sessions: [live, dead], projectOrder: [PROJECT, GONE], history: { [live.id]: [], [dead.id]: [] } };

const heading = (page: Page, name: string): Locator => page.locator('.project > .section-heading', { has: page.locator('.label', { hasText: new RegExp(`^${name}$`) }) });
const tabLabel = (page: Page, name: string): Locator => page.locator('.tab-project-label', { hasText: new RegExp(`^${name}$`) });
const switcherEntry = (page: Page, name: string): Locator => page.locator('.switcher-item', { has: page.locator('.switcher-item-name', { hasText: new RegExp(`^${name}$`) }) });

test('in All, a dead project is marked on its heading, its tab-bar label and its switcher entry, and a live one is not', async ({ app, page }) => {
  await app.boot({ ...both, activeProject: null, openSessions: [live.id, dead.id] });

  // The heading swaps its own folder for the crossed-out one and says why; a live heading's tooltip stays its path.
  await expect(heading(page, 'gone').locator('.label')).toHaveClass(/project-gone/);
  await expect(heading(page, 'gone').locator('.heading-icon')).toHaveClass(/project-gone/);
  await expect(heading(page, 'gone').locator('.label')).toHaveAttribute('data-tooltip', projectGoneReason(GONE));
  await expect(heading(page, 'demo').locator('.label')).not.toHaveClass(/project-gone/);
  await expect(heading(page, 'demo').locator('.label')).toHaveAttribute('data-tooltip', PROJECT);

  await expect(tabLabel(page, 'gone').locator('.gone-mark')).toHaveClass(/project-gone/);
  await expect(tabLabel(page, 'gone')).toHaveAttribute('data-tooltip', projectGoneReason(GONE));
  await expect(tabLabel(page, 'demo').locator('.gone-mark')).toBeHidden();

  await page.locator('#switcher-current').click();
  await expect(switcherEntry(page, 'gone').locator('.gone-mark')).toHaveClass(/project-gone/);
  await expect(switcherEntry(page, 'gone')).toHaveAttribute('data-tooltip', projectGoneReason(GONE));
  await expect(switcherEntry(page, 'demo').locator('.gone-mark')).toBeHidden();
  await expect(switcherEntry(page, 'demo')).toHaveAttribute('data-tooltip', PROJECT);
});

test("a dead session's tab is dimmed with its reason, and choosing it says why instead of starting it", async ({ app, page }) => {
  await app.boot({ ...both, activeProject: null, openSessions: [live.id, dead.id] });
  const tab = page.locator('.tab', { has: page.locator('.tab-label', { hasText: dead.title }) });
  await expect(tab).toHaveClass(/unstartable/);
  await expect(tab.locator('.tab-label')).toHaveAttribute('data-tooltip', unstartableReason(dead)!);
  await expect(page.locator('.tab', { has: page.locator('.tab-label', { hasText: live.title }) })).not.toHaveClass(/unstartable/);

  await tab.locator('.tab-label').click();
  await expect(page.locator('#term-placeholder')).toContainText(unstartableReason(dead)!);
  expect(await app.calls('startTerminal')).toEqual([]);
});

test('scoped to a dead project with no tab, the title is marked and the pane says the project cannot run', async ({ app, page }) => {
  await app.boot({ ...both, activeProject: GONE });
  await expect(page.locator('#switcher-name')).toHaveText('gone');
  await expect(page.locator('#switcher-gone')).toBeVisible();
  await expect(page.locator('#switcher-gone')).toHaveAttribute('data-tooltip', projectGoneReason(GONE));
  // Not "pick a session": nothing in it can be opened, so pointing at its sessions would send you to a click that is refused.
  await expect(page.locator('#term-placeholder')).toHaveText(projectGoneReason(GONE));
});

test('scoped to a live project, nothing is marked and the pane points at its sessions', async ({ app, page }) => {
  await app.boot({ ...both, activeProject: PROJECT });
  await expect(page.locator('#switcher-name')).toHaveText('demo');
  await expect(page.locator('#switcher-gone')).toBeHidden();
  await expect(heading(page, 'demo').locator('.label')).not.toHaveClass(/project-gone/);
  await expect(page.locator('#term-placeholder')).toHaveText('Pick a session in the sidebar to open it.');
});
