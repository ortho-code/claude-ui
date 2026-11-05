import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/defaults';
import { HOME, PROJECT, session } from '../../../../support/fixture';
import { expect, test, type App } from '../../../../support/harness';
import { keptChanges, withLayout } from '../../../layout/layout';
import { chooseProject, row, rows, tabBarGroup, tabBarProject } from '../../../../support/window';

// Recent (docs/architecture.md § Recent): every session in the switcher's scope, flat, last worked on first, pins not floated, each row led by its group and in All its project; the choice is the sessions panel's view, kept on this machine.
const OTHER = `${HOME}/projects/other`;
const MINUTE = 60_000;
const NOW = Date.parse('2026-09-30T09:00:00.000Z');
const ago = (minutes: number): string => new Date(NOW - minutes * MINUTE).toISOString();
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pinnedOld = session({ id: id(1), title: 'Pinned old', lastActivity: ago(90) });
const grouped = session({ id: id(2), title: 'In a group', lastActivity: ago(30) });
const loose = session({ id: id(3), title: 'Loose', lastActivity: ago(60) });
const elsewhere = session({ id: id(4), title: 'Elsewhere', cwd: OTHER, repoRoot: OTHER, lastActivity: ago(10) });
const fixture = {
  sessions: [elsewhere, grouped, loose, pinnedOld],
  projectOrder: [PROJECT, OTHER],
  activeProject: PROJECT,
  pinned: [pinnedOld.id],
  groupState: { groups: [{ id: 'g-work', name: 'Work', repoRoot: PROJECT }], groupOf: { [grouped.id]: 'g-work' } },
};

const switchButton = (page: Page, name: 'Grouped' | 'Recent'): Locator => page.locator('#list-row .panel-view', { hasText: name });
const order = (page: Page): Promise<string[]> => rows(page).locator('.card-title').allTextContents();
const meta = (page: Page, title: string): Locator => row(page, title).locator('.meta-text');

async function boot(app: App, page: Page, more: object = {}): Promise<void> {
  await page.clock.install({ time: NOW });
  await app.boot({ ...fixture, ...more });
}

test('the switch shows Grouped on show; Recent draws every session in scope flat, newest first, pins not floated, each row led by its group', async ({ app, page }) => {
  await boot(app, page);
  await expect(switchButton(page, 'Grouped')).toHaveAttribute('aria-pressed', 'true');
  // Grouped: the group's rows first, then the loose ones, the pin floated among those.
  await expect.poll(() => order(page)).toEqual([grouped.title, pinnedOld.title, loose.title]);

  await switchButton(page, 'Recent').click();
  await expect(switchButton(page, 'Recent')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => order(page)).toEqual([grouped.title, loose.title, pinnedOld.title]);
  await expect(page.locator('#sessions .section-heading')).toHaveCount(0);
  await expect(meta(page, grouped.title)).toHaveText('Work · 30 min ago · Opus 5.5');
  await expect(meta(page, loose.title)).toHaveText('1 h ago · Opus 5.5');
});

test('in All, Recent leads each row with its project too, and the choice holds across a switch of project', async ({ app, page }) => {
  await boot(app, page, { activeProject: null });
  await switchButton(page, 'Recent').click();
  await expect.poll(() => order(page)).toEqual([elsewhere.title, grouped.title, loose.title, pinnedOld.title]);
  await expect(meta(page, elsewhere.title)).toHaveText('other · 10 min ago · Opus 5.5');
  await expect(meta(page, grouped.title)).toHaveText('demo › Work · 30 min ago · Opus 5.5');

  await chooseProject(page, 'other');
  await expect(switchButton(page, 'Recent')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => order(page)).toEqual([elsewhere.title]);
  await expect(meta(page, elsewhere.title)).toHaveText('10 min ago · Opus 5.5');
});

test('the filter narrows Recent, and its count says so', async ({ app, page }) => {
  await boot(app, page, { uiState: { ...defaultUi(), search: 'loose', filterPanelOpen: true } });
  await switchButton(page, 'Recent').click();
  await expect.poll(() => order(page)).toEqual([loose.title]);
  await expect(page.locator('#filter-status')).toContainText('1 of 3');
});

test('the archived view in Recent is flat too, each row saying when it was archived', async ({ app, page }) => {
  await boot(app, page, { archived: { [loose.id]: NOW - 5 * MINUTE }, uiState: { ...defaultUi(), filters: { ...defaultUi().filters, archived: true } } });
  await switchButton(page, 'Recent').click();
  await expect.poll(() => order(page)).toEqual([loose.title]);
  await expect(page.locator('#sessions .section-heading')).toHaveCount(0);
  await expect(meta(page, loose.title)).toHaveText('archived 5 min ago');
});

test('with every session archived, Recent says so in place of its rows, in a project and in All', async ({ app, page }) => {
  const finished = Object.fromEntries(fixture.sessions.map((s) => [s.id, NOW - MINUTE]));
  await boot(app, page, { archived: finished });
  await switchButton(page, 'Recent').click();
  await expect(page.locator('#sessions .empty-message')).toHaveText('All 3 sessions here are archived.');
  await chooseProject(page, 'All');
  await expect(page.locator('#sessions .empty-message')).toHaveText('All 4 sessions here are archived.');
});

test('collapse-all is unavailable in Recent', async ({ app, page }) => {
  await boot(app, page);
  await switchButton(page, 'Recent').click();
  await expect(page.locator('#collapse-toggle')).toHaveClass(/unavailable/);
  await expect(page.locator('#collapse-toggle')).toHaveAttribute('data-tooltip', 'Recent has no sections to fold.');
});

test('selecting several in Recent: Select… then a Shift+press ticks a run, and switching to Grouped keeps the ticks', async ({ app, page }) => {
  await boot(app, page);
  await switchButton(page, 'Recent').click();
  await row(page, grouped.title).locator('.kebab').click();
  await page.locator('.kebab-menu').getByText('Select…').click();
  await row(page, pinnedOld.title).click({ modifiers: ['Shift'] });
  await expect(page.locator('#sessions .session .tick[aria-checked="true"]')).toHaveCount(3);
  await switchButton(page, 'Grouped').click();
  await expect(page.locator('#sessions .session .tick[aria-checked="true"]')).toHaveCount(3);
});

test('the switch is unavailable during the review, and Done brings Recent back', async ({ app, page }) => {
  const old = session({ id: id(5), title: 'Old one', lastActivity: new Date(NOW - 40 * 24 * 60 * MINUTE).toISOString() });
  await boot(app, page, { sessions: [...fixture.sessions, old] });
  await switchButton(page, 'Recent').click();
  await page.locator('#review-button').click();
  await expect(switchButton(page, 'Grouped')).toHaveClass(/unavailable/);
  await expect(switchButton(page, 'Grouped')).toHaveAttribute('data-tooltip', 'The review keeps its own order');
  await page.locator('#review-button').click();
  await expect(switchButton(page, 'Recent')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => order(page)).toEqual([grouped.title, loose.title, pinnedOld.title, old.title]);
});

test('a pick is kept as the sessions panel’s view, and a layout entry naming Recent starts the list on it', async ({ app, page }) => {
  await page.clock.install({ time: NOW });
  const layout = { version: 2, root: { id: 'window', columns: [{ id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions', view: 'recent' }] }, { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] }] } };
  await app.boot({ ...withLayout(layout), ...fixture });
  await expect(switchButton(page, 'Recent')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => order(page)).toEqual([grouped.title, loose.title, pinnedOld.title]);

  await switchButton(page, 'Grouped').click();
  await expect.poll(() => keptChanges(app)).toContainEqual({ id: 'sessions', field: 'view', value: 'grouped' });
});

const SIDEBAR_LAYOUT = (entry: object = {}): object => ({ version: 2, root: { id: 'window', columns: [{ id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions', ...entry }] }, { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] }] } });

test('a pick kept in the app’s file beside the layout starts the next launch on Recent', async ({ app, page }) => {
  await page.clock.install({ time: NOW });
  await app.boot({ ...withLayout(SIDEBAR_LAYOUT(), { sessions: { view: 'recent' } }), ...fixture });
  await expect(switchButton(page, 'Recent')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => order(page)).toEqual([grouped.title, loose.title, pinnedOld.title]);
});

test('a layout entry naming a view the session list does not offer shows Grouped, and its group says why', async ({ app, page }) => {
  await page.clock.install({ time: NOW });
  await app.boot({ ...withLayout(SIDEBAR_LAYOUT({ view: 'newest' })), ...fixture });
  await expect(switchButton(page, 'Grouped')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('view "newest" on sessions is not one of the views its list offers (grouped, recent); its first is shown until another is picked.')).toBeVisible();
});

test('the same note when the session list mounts afresh, under an id the default layout does not use', async ({ app, page }) => {
  await page.clock.install({ time: NOW });
  const layout = { version: 2, root: { id: 'window', columns: [{ id: 'sidebar', size: '320px', panels: [{ id: 'list', type: 'sessions', view: 'newest' }] }, { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] }] } };
  await app.boot({ ...withLayout(layout), ...fixture });
  await expect(switchButton(page, 'Grouped')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('view "newest" on list is not one of the views its list offers (grouped, recent); its first is shown until another is picked.')).toBeVisible();
});

/** Press a tab-bar name and read, in the same step, the titles of the rows it flashed: the flash comes off on a timer. */
const flashedBy = (label: Locator): Promise<(string | null | undefined)[]> =>
  label.evaluate((el) => {
    (el as HTMLElement).click();
    return [...document.querySelectorAll<HTMLElement>('#sessions .session.flash')].map((r) => r.querySelector('.card-title')?.textContent);
  });

test("a tab bar group's name in Recent lands on the group's newest row and flashes it", async ({ app, page }) => {
  // An older session in the same group, drawn below the newest one, so landing on any of the group's rows would not do.
  const olderInWork = session({ id: id(6), title: 'Older in the group', lastActivity: ago(120) });
  await boot(app, page, {
    sessions: [...fixture.sessions, olderInWork],
    openSessions: [olderInWork.id],
    groupState: { groups: fixture.groupState.groups, groupOf: { [grouped.id]: 'g-work', [olderInWork.id]: 'g-work' } },
  });
  await switchButton(page, 'Recent').click();
  expect(await flashedBy(tabBarGroup(page, 'Work'))).toEqual([grouped.title]);
});

test("a tab bar project's name in Recent lands on the project's newest row and flashes it", async ({ app, page }) => {
  await boot(app, page, { activeProject: null, openSessions: [loose.id] });
  await switchButton(page, 'Recent').click();
  expect(await flashedBy(tabBarProject(page, 'demo'))).toEqual([grouped.title]);
});
