import type { Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/config/defaults';
import { session, sorted } from '../../../../support/fixture';
import { expect, test, type App } from '../../../../support/harness';
import { sortedTitles, tabLabel } from '../../../../support/window';

// The query field narrows the list by what it says; which session meets which term is the fields', unit-tested on their own, so this holds the wiring and the cases the query language started from.
const pinnedRunning = session({ id: '00000000-0000-4000-8000-0000000000d1', title: 'Pinned and running' });
const running = session({ id: '00000000-0000-4000-8000-0000000000d2', title: 'Running only' });
const aside = session({ id: '00000000-0000-4000-8000-0000000000d3', title: 'Set aside' });
const plain = session({ id: '00000000-0000-4000-8000-0000000000d4', title: 'Nothing on it' });
const everyone = [pinnedRunning, running, aside, plain];
const fixture = {
  sessions: everyone,
  pinned: [pinnedRunning.id],
  openSessions: [pinnedRunning.id, running.id],
  setAside: { [aside.id]: { due: null, at: 1 } },
  history: { [pinnedRunning.id]: [], [running.id]: [] },
};

/** Boot, and start claude in both tabs, which come back cold. */
async function boot(app: App, page: Page): Promise<void> {
  await app.boot(fixture);
  await tabLabel(page, pinnedRunning.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await tabLabel(page, running.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
}

async function typed(page: Page, query: string): Promise<void> {
  if (await page.locator('#filter-panel').isHidden()) await page.locator('#filter-toggle').click();
  await page.locator('#search').fill(query);
}

test('an OR across kinds of filter holds the sessions any side names', async ({ app, page }) => {
  await boot(app, page);
  await typed(page, 'is:pinned OR is:running OR is:set-aside');
  await expect.poll(() => sortedTitles(page)).toEqual(sorted(pinnedRunning, running, aside));
});

test('a - leaves out what it names', async ({ app, page }) => {
  await boot(app, page);
  await typed(page, '-is:pinned');
  await expect.poll(() => sortedTitles(page)).toEqual(sorted(running, aside, plain));
});

test('terms side by side bind tighter than OR', async ({ app, page }) => {
  await boot(app, page);
  await typed(page, '-is:pinned is:running OR is:set-aside');
  await expect.poll(() => sortedTitles(page)).toEqual(sorted(running, aside));
});

test('a pill on a query with an OR adds its term to every part, shows on, and a second press takes it out of every part', async ({ app, page }) => {
  await boot(app, page);
  await typed(page, 'is:running OR is:set-aside');
  await page.locator('#pinned-filter').click();
  await expect(page.locator('#search')).toHaveValue('is:running is:pinned OR is:set-aside is:pinned');
  await expect(page.locator('#pinned-filter')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => sortedTitles(page)).toEqual(sorted(pinnedRunning));
  await page.locator('#pinned-filter').click();
  await expect(page.locator('#search')).toHaveValue('is:running OR is:set-aside');
  await expect(page.locator('#pinned-filter')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => sortedTitles(page)).toEqual(sorted(pinnedRunning, running, aside));
});

test('a term half typed keeps the list the last query that read drew', async ({ app, page }) => {
  await boot(app, page);
  await typed(page, 'is:set-aside');
  await expect.poll(() => sortedTitles(page)).toEqual(sorted(aside));
  await page.locator('#search').fill('is:set-aside OR is:pin');
  await expect.poll(() => sortedTitles(page)).toEqual(sorted(aside));
  await page.locator('#search').fill('is:set-aside OR is:pinned');
  await expect.poll(() => sortedTitles(page)).toEqual(sorted(pinnedRunning, aside));
});

test('a term that does not read is underlined and named under the field, and the list dimmed, until it reads', async ({ app, page }) => {
  await boot(app, page);
  await typed(page, 'is:set-aside is:pin');
  await expect(page.locator('#query-mirror .query-problem')).toHaveText(['is:pin']);
  await expect(page.locator('#query-problems li')).toHaveText(['pin is not a value of is:.']);
  await expect(page.locator('#search')).toHaveClass(/\bhas-problems\b/);
  await expect(page.locator('#sessions')).toHaveClass(/\bstale\b/);

  await page.locator('#search').fill('is:set-aside is:pinned');
  await expect(page.locator('#query-problems')).toBeHidden();
  await expect(page.locator('#query-mirror .query-problem')).toHaveCount(0);
  await expect(page.locator('#search')).not.toHaveClass(/\bhas-problems\b/);
  await expect(page.locator('#sessions')).not.toHaveClass(/\bstale\b/);
});

test('shut over a query that does not read, the list stays dimmed and the chip says why', async ({ app, page }) => {
  await boot(app, page);
  await typed(page, 'is:pin');
  await page.locator('#filter-toggle').click();
  await expect(page.locator('#sessions')).toHaveClass(/\bstale\b/);
  await expect(page.locator('#filter-chips .filter-chip-text')).toHaveText(['is:pin']);
  await expect(page.locator('#filter-chips .filter-chip')).toHaveClass(/\bhas-problems\b/);
  await expect(page.locator('#filter-chips .filter-chip-remove')).toHaveAttribute('aria-label', 'Remove: Does not read: pin is not a value of is:.');
  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill('is:pinned');
  await page.locator('#filter-toggle').click();
  await expect(page.locator('#filter-chips .filter-chip')).not.toHaveClass(/\bhas-problems\b/);
});

test('a stored query that does not read shows nothing until it does', async ({ app, page }) => {
  await app.boot({ ...fixture, uiState: { ...defaultUi(), query: 'is:set-aside OR is:pin', filterPanelOpen: true } });
  await expect.poll(() => sortedTitles(page)).toEqual([]);
  await page.locator('#search').fill('is:set-aside OR is:pinned');
  await expect.poll(() => sortedTitles(page)).toEqual(sorted(pinnedRunning, aside));
});

test("a query that asks what claude is doing follows claude's status as it changes", async ({ app, page }) => {
  await boot(app, page);
  await typed(page, 'status:waiting');
  await expect.poll(() => sortedTitles(page)).toEqual([]);
  expect(await app.emit('onSessionStatus', running.id, 'waiting', '', 'Notification')).toBe(1);
  await expect.poll(() => sortedTitles(page)).toEqual(sorted(running));
});

test('shut over a query with an OR, the panel folds to one chip of the whole query, whose × empties it', async ({ app, page }) => {
  await boot(app, page);
  await typed(page, 'is:pinned OR is:set-aside');
  await page.locator('#filter-toggle').click();
  await expect(page.locator('#filter-chips .filter-chip-text')).toHaveText(['is:pinned OR is:set-aside']);
  await page.locator('#filter-chips .filter-chip-remove').click();
  await expect.poll(() => sortedTitles(page)).toEqual(sorted(...everyone));
});
