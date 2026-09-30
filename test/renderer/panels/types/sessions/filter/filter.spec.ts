import type { Locator, Page } from '@playwright/test';
import { defaultUi } from '../../../../../../src/shared/defaults';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';

// A filter that is on is never out of sight (docs/architecture.md § Reopening the way you left it): the count and Clear sit under the panel, and a panel shut over a filter folds to a row of chips, one per thing that is on, each with its own ×.
// The count compares a set with part of itself: the matches out of what the same scope holds before any filter.
const parser = session({ id: '00000000-0000-4000-8000-0000000000b1', title: 'Fix the parser' });
const docs = session({ id: '00000000-0000-4000-8000-0000000000b2', title: 'Write the docs' });
const tests = session({ id: '00000000-0000-4000-8000-0000000000b3', title: 'Parser tests' });
const fixture = { sessions: [parser, docs, tests], pinned: [parser.id] };

const titles = (page: Page): Locator => page.locator('#sessions .session .session-title');

test('search and a pill narrow the list and say by how much, a shut panel leaves chips, and Clear undoes it all', async ({ app, page }) => {
  await app.boot(fixture);
  await expect(page.locator('#filter-status')).toBeHidden();

  await page.locator('#filter-toggle').click();
  await page.locator('#search').fill('parser');
  await expect(titles(page)).toHaveText([parser.title, tests.title]);
  await expect(page.locator('#filter-count')).toHaveText('Showing 2 of 3');
  await expect(page.locator('#filter-toggle')).toHaveClass(/\bactive\b/);

  await page.locator('#pinned-filter').click();
  await expect(page.locator('#pinned-filter')).toHaveAttribute('aria-pressed', 'true');
  await expect(titles(page)).toHaveText([parser.title]);
  await expect(page.locator('#filter-count')).toHaveText('Showing 1 of 3');

  // Shut over a filter: the panel goes, what is on stays in sight.
  await page.locator('#filter-toggle').click();
  await expect(page.locator('#filter-panel')).toBeHidden();
  await expect(page.locator('#filter-chips .filter-chip')).toHaveCount(2);
  await expect(page.locator('#filter-chips .filter-chip-text')).toHaveText(['parser']);

  await page.getByRole('button', { name: 'Remove: Show only pinned sessions' }).click();
  await expect(page.locator('#filter-chips .filter-chip')).toHaveCount(1);
  await expect(titles(page)).toHaveText([parser.title, tests.title]);

  await page.locator('#filter-clear').click();
  await expect(titles(page)).toHaveText([parser.title, docs.title, tests.title]);
  await expect(page.locator('#filter-status')).toBeHidden();
  await expect(page.locator('#filter-toggle')).not.toHaveClass(/\bactive\b/);
});

test('the row of chips opens the panel again', async ({ app, page }) => {
  await app.boot({ ...fixture, uiState: { ...defaultUi(), search: 'parser', filterPanelOpen: false } });
  await page.locator('#filter-chips .filter-chip-text').click();
  await expect(page.locator('#filter-panel')).toBeVisible();
  await expect(page.locator('#search')).toHaveValue('parser');
  await expect(page.locator('#filter-chips')).toBeHidden();
});

test('a filter left on comes back on, with the panel as it was left', async ({ app, page }) => {
  await app.boot({ ...fixture, uiState: { ...defaultUi(), search: 'parser', filters: { ...defaultUi().filters, pinned: true }, filterPanelOpen: false } });
  await expect(titles(page)).toHaveText([parser.title]);
  await expect(page.locator('#filter-panel')).toBeHidden();
  await expect(page.locator('#filter-chips .filter-chip')).toHaveCount(2);
  await expect(page.locator('#filter-count')).toHaveText('Showing 1 of 3');
});
