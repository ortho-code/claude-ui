import type { Locator, Page } from '@playwright/test';
import { PROJECT, session } from '../../../support/fixture';
import { expect, test, type App } from '../../../support/harness';
import { OTHER, railItem, withLayout } from '../../layout/layout';

// Now (docs/architecture/session-list.md § Now): the sessions that call you and what is in hand, in sections drawn as the session list's rows, in a panel of its own whose header switches between All projects and This project.

const asking = session({ id: '00000000-0000-4000-8000-0000000000a1', title: 'Asks here' });
const asideHere = session({ id: '00000000-0000-4000-8000-0000000000a2', title: 'Set aside here' });
const askingThere = session({ id: '00000000-0000-4000-8000-0000000000a3', title: 'Asks over there', cwd: OTHER, repoRoot: OTHER });
const quiet = session({ id: '00000000-0000-4000-8000-0000000000a4', title: 'Nothing to say' });

const layout = withLayout({
  version: 2,
  root: {
    id: 'window',
    columns: [
      { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
      { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
      { id: 'right', size: '360px', panels: [{ id: 'now', type: 'session-view', options: { show: 'now' } }] },
    ],
  },
});

const panel = (page: Page): Locator => page.locator('.session-view');
const header = (page: Page): Locator => page.locator('.panel-header', { hasText: 'Now' });
const section = (page: Page, name: string): Locator => panel(page).locator('.flat-section', { has: page.locator('.section-heading .label', { hasText: new RegExp(`^${name}$`) }) });
const headings = (page: Page): Promise<string[]> => panel(page).locator('.flat-section .section-heading .label').allTextContents();
const titles = (scope: Locator): Promise<string[]> => scope.locator('.session .card-title').allTextContents();
const view = (page: Page, label: string): Locator => header(page).locator(`.panel-view[aria-label="${label}"]`);

async function boot(app: App, more: object = {}): Promise<void> {
  await app.boot({
    ...layout,
    sessions: [asking, asideHere, askingThere, quiet],
    projectOrder: [PROJECT, OTHER],
    statuses: { [asking.id]: 'waiting', [askingThere.id]: 'waiting' },
    setAside: { [asideHere.id]: { due: null, at: 1 } },
    history: { [asking.id]: [] },
    ...more,
  });
}

test('opens on All projects: what asks for you under Needs you, counted in its header, and what is set aside under Not now, each row its states', async ({ app, page }) => {
  await boot(app);
  await expect(view(page, 'All projects')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => headings(page)).toEqual(['Running', 'Needs you', 'Not now']);
  await expect.poll(() => titles(section(page, 'Needs you'))).toEqual([asking.title, askingThere.title]);
  await expect.poll(() => titles(section(page, 'Not now'))).toEqual([asideHere.title]);
  await expect(section(page, 'Running').locator('.flat-note')).toHaveText('Nothing running.');
  await expect(header(page).locator('.panel-count')).toHaveText('2');
  // In All, a row's line under its title names its project, then its first state, where the sidebar's row says its time.
  await expect(section(page, 'Needs you').locator('.session', { hasText: asking.title }).locator('.meta-text')).toHaveText('demo · Waiting for you');
  await expect(section(page, 'Needs you').locator('.session', { hasText: askingThere.title }).locator('.meta-text')).toHaveText('other · Waiting for you');
  await expect(section(page, 'Not now').locator('.meta-text')).toHaveText('demo · Set aside, whenever');
});

test("a row's first state sits on the line under its title, beside its marks, as a row's time does elsewhere, with the rest under it", async ({ app, page }) => {
  await boot(app, { notes: { [asking.id]: 'Waiting on review' }, setAside: { [asideHere.id]: { due: null, at: 1 } } });
  const row = section(page, 'Needs you').locator('.session', { hasText: asking.title });
  // In All, led by its project.
  await expect(row.locator('.meta-text')).toHaveText('demo · Waiting for you');
  await expect(row.locator('.session-state-line')).toHaveCount(0);
  await expect(row.locator('.meta-sep')).toBeVisible();
  // As tall as the same session's row in the sidebar, whose line under its title says its time.
  const sidebarRow = page.locator('#sessions .session', { hasText: asking.title });
  expect(Math.round((await row.boundingBox())!.height)).toBe(Math.round((await sidebarRow.boundingBox())!.height));
});

test("This project shows the project on show, and other projects' sessions that ask for you under Elsewhere, compact and uncounted", async ({ app, page }) => {
  await boot(app);
  await view(page, 'This project').click();
  await expect.poll(() => headings(page)).toEqual(['Running', 'Needs you', 'Elsewhere', 'Not now']);
  await expect.poll(() => titles(section(page, 'Needs you'))).toEqual([asking.title]);
  const elsewhere = section(page, 'Elsewhere').locator('.session');
  await expect(elsewhere).toHaveCount(1);
  await expect(elsewhere.locator('.card-title')).toHaveText(askingThere.title);
  await expect(elsewhere.locator('.meta-text')).toHaveText('other');
  await expect(elsewhere.locator('.session-state-line')).toHaveCount(0);
  await expect(header(page).locator('.panel-count')).toHaveText('1');
});

test('Elsewhere stands in This project with nothing in it, saying so', async ({ app, page }) => {
  await boot(app, { statuses: { [asking.id]: 'waiting' } });
  await view(page, 'This project').click();
  await expect(section(page, 'Elsewhere').locator('.flat-note')).toHaveText('Nothing elsewhere.');
});

test('This project with no project on show says so in every section and counts nothing', async ({ app, page }) => {
  await boot(app, { activeProject: null });
  await view(page, 'This project').click();
  await expect.poll(() => headings(page)).toEqual(['Running', 'Needs you', 'Not now']);
  await expect(panel(page).locator('.flat-note')).toHaveText(['No project selected.', 'No project selected.', 'No project selected.']);
  await expect(panel(page).locator('.session')).toHaveCount(0);
  await expect(header(page).locator('.panel-count')).toHaveText('0');
});

test('folded away, it draws no rows but keeps its count on its rail icon, following what asks for you', async ({ app, page }) => {
  const folded = withLayout(
    {
      version: 2,
      root: {
        id: 'window',
        columns: [
          { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
          { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
          { id: 'right', size: '360px', collapsible: true, panels: [{ id: 'now', type: 'session-view', options: { show: 'now' } }] },
        ],
      },
    },
    { right: { folded: true, active: 'now' } },
  );
  await boot(app, { layout: folded.layout });
  const count = railItem(page, /^Now/).locator('.rail-count');
  await expect(count).toHaveText('2');
  await expect(panel(page).locator('.session')).toHaveCount(0);
  await app.emit('onSessionStatus', askingThere.id, 'busy', '', 'UserPromptSubmit');
  await expect(count).toHaveText('1');
});

test('a press on a row opens its session, whose row then wears the edge of a session with a tab, and its header has no Refresh', async ({ app, page }) => {
  await boot(app);
  const row = panel(page).locator('.session', { hasText: asking.title });
  await expect(row).not.toHaveClass(/\bopen\b/);
  await row.click();
  await expect(page.locator('#tabbar .tab', { hasText: asking.title })).toHaveCount(1);
  await expect(panel(page).locator('.session', { hasText: asking.title })).toHaveClass(/\bopen\b/);
  await expect(header(page).getByRole('button', { name: 'Refresh' })).toHaveCount(0);
});
