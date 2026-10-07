import type { Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/defaults';
import { HOME, PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { chooseProject, rows } from '../../../../support/window';

// The list keeps where you scrolled it, across a repaint and across a restart; a new filter or another project starts it at its top, since the rows it scrolled through are gone.
const NOW = new Date('2026-09-30T12:00:00.000Z');
const OTHER = `${HOME}/projects/other`;
const many = Array.from({ length: 40 }, (_, i) =>
  session({ id: `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`, title: `Session ${String(i + 1).padStart(2, '0')}`, lastActivity: new Date(NOW.getTime() - (i + 1) * 60_000).toISOString() }),
);
const others = Array.from({ length: 40 }, (_, i) =>
  session({
    id: `00000000-0000-4000-8000-0000000002${String(i).padStart(2, '0')}`,
    title: `Other ${String(i + 1).padStart(2, '0')}`,
    cwd: OTHER,
    repoRoot: OTHER,
    lastActivity: new Date(NOW.getTime() - (i + 1) * 60_000).toISOString(),
  }),
);
const fixture = { sessions: many };
const twoProjects = { sessions: [...many, ...others], projectOrder: [PROJECT, OTHER] };

const scrolled = (page: Page): Promise<number> => page.locator('#sessions').evaluate((list) => list.scrollTop);
const scrollTo = (page: Page, top: number): Promise<void> =>
  page.locator('#sessions').evaluate((list, to) => {
    list.scrollTop = to;
  }, top);

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

test('a repaint keeps the scroll, and a new filter starts the list at its top', async ({ app, page }) => {
  await app.boot(fixture);
  await expect(rows(page)).toHaveCount(many.length);
  await scrollTo(page, 400);
  expect(await scrolled(page)).toBe(400);

  // A status drawn on a row is not a new list.
  expect(await app.emit('onSessionStatus', many[0].id, 'waiting', '', 'Notification')).toBe(1);
  await expect(rows(page).first().locator('.nudge')).toHaveClass(/\bwaiting\b/);
  expect(await scrolled(page)).toBe(400);

  // Each of these still lists every session, so the top is where the filter put it, not where a shorter list left it.
  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill('Session');
  await expect.poll(() => scrolled(page)).toBe(0);
  await scrollTo(page, 400);
  await page.locator('#date-presets [data-range="30d"]').click();
  await expect.poll(() => scrolled(page)).toBe(0);
});

test('choosing the filter that is already on is not a new filter, so a later repaint keeps the scroll', async ({ app, page }) => {
  await app.boot(fixture);
  await expect(rows(page)).toHaveCount(many.length);
  await page.locator('#filter-toggle').click();
  await page.locator('#date-presets [data-range="any"]').click();
  await scrollTo(page, 400);
  expect(await scrolled(page)).toBe(400);

  // Something the list draws, and nothing about the filter.
  expect(await app.emit('onSessionModel', many[0].id, 'claude-sonnet-5-5')).toBe(1);
  await expect(rows(page).first().locator('.card-meta')).toContainText('Sonnet 5.5');
  expect(await scrolled(page)).toBe(400);
});

test('choosing a project starts the list at its top, and so does going back to All', async ({ app, page }) => {
  await app.boot({ ...twoProjects, activeProject: null });
  await expect(rows(page)).toHaveCount(many.length + others.length);
  await scrollTo(page, 400);
  expect(await scrolled(page)).toBe(400);
  await chooseProject(page, 'other');
  await expect(rows(page)).toHaveCount(others.length);
  await expect.poll(() => scrolled(page)).toBe(0);
  await scrollTo(page, 400);
  expect(await scrolled(page)).toBe(400);
  await chooseProject(page, 'All');
  await expect(rows(page)).toHaveCount(many.length + others.length);
  await expect.poll(() => scrolled(page)).toBe(0);
});

test('a project left with no sessions falls back to All with the list at its top', async ({ app, page }) => {
  await app.boot({ ...twoProjects, activeProject: OTHER });
  await expect(rows(page)).toHaveCount(others.length);
  await scrollTo(page, 400);
  expect(await scrolled(page)).toBe(400);
  // As main would list it next, with the other project's transcripts gone.
  await app.listOnDisk(many);
  await expect(page.locator('#switcher-name')).toHaveText('All');
  await expect(rows(page)).toHaveCount(many.length);
  await expect.poll(() => scrolled(page)).toBe(0);
});

test('a new session in another project drops the list to All, at its top', async ({ app, page }) => {
  await app.boot({ ...twoProjects, activeProject: OTHER, pickFolder: PROJECT });
  await expect(rows(page)).toHaveCount(others.length);
  await scrollTo(page, 400);
  expect(await scrolled(page)).toBe(400);
  await page.locator('#new-session').click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await expect(page.locator('#switcher-name')).toHaveText('All');
  // And main keeps it, as it keeps a choice made in the switcher.
  expect(await app.calls('setActiveProject')).toEqual([[null]]);
  await expect.poll(() => scrolled(page)).toBe(0);
});

test('where the list was scrolled to is saved', async ({ app, page }) => {
  await app.boot(fixture);
  await expect(rows(page)).toHaveCount(many.length);
  await scrollTo(page, 300);
  await expect.poll(async () => (await app.saved())?.scrollTop).toBe(300);
});

test('a scroll stored last time is where the list opens', async ({ app, page }) => {
  await app.boot({ ...fixture, uiState: { ...defaultUi(), scrollTop: 300 } });
  await expect(rows(page)).toHaveCount(many.length);
  await expect.poll(() => scrolled(page)).toBe(300);
});
