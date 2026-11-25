import { defaultUi } from '../../../../../../src/shared/config/defaults';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { pixels, token } from '../../../../support/looks';
import { titles } from '../../../../support/window';

// A filter that is on is never out of sight (docs/architecture/window.md § Reopening the way you left it): the query field stands on a row of its own whether the pills are open or not, with the count and Clear under it.
// The count compares a set with part of itself: the matches out of what the same scope holds before any filter.
const parser = session({ id: '00000000-0000-4000-8000-0000000000b1', title: 'Fix the parser' });
const docs = session({ id: '00000000-0000-4000-8000-0000000000b2', title: 'Write the docs' });
const tests = session({ id: '00000000-0000-4000-8000-0000000000b3', title: 'Parser tests' });
const fixture = { sessions: [parser, docs, tests], pinned: [parser.id] };

test('the query field stands on a row of its own, with the filter button, while the filters are shut', async ({ app, page }) => {
  await app.boot(fixture);
  await expect(page.locator('#filters-card')).toBeHidden();
  const row = page.locator('#query-row');
  await expect(row.locator('#search')).toBeVisible();
  await expect(row.locator('#filter-toggle')).toBeVisible();
  await page.locator('#search').fill('parser');
  await expect(titles(page)).toHaveText([parser.title, tests.title]);
});

test('the filter button opens the filters beside the list, each facet named and each pill in words, and the list keeps its place', async ({ app, page }) => {
  await app.boot(fixture);
  const before = await page.locator('#sessions').boundingBox();
  await page.locator('#filter-toggle').click();
  const card = page.locator('#filters-card');
  await expect(card).toBeVisible();
  await expect(page.locator('#filter-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(card.locator('.facet-name')).toHaveText(['Lifecycle', 'Links', 'Relations', 'Marks', 'Place', 'Last active']);
  await expect(card.locator('.facet-pills > .pill')).toHaveText(['Working', 'Running', 'Set aside', 'Finished', 'PR', 'Siblings', 'Pinned', 'Noted', 'Worktree', 'Folder gone']);
  const list = await page.locator('#sidebar').evaluate((el) => (el.closest('.panel-group') ?? el).getBoundingClientRect().right);
  expect(await card.evaluate((el) => el.getBoundingClientRect().left)).toBeGreaterThanOrEqual(list);
  expect(await page.locator('#sessions').boundingBox()).toEqual(before);

  await card.getByRole('button', { name: 'Pinned' }).click();
  await expect(titles(page)).toHaveText([parser.title]);
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(page.locator('#filter-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#search')).toHaveValue('is:pinned');
});

test('search and a pill narrow the list and say by how much, shutting the pills leaves the query in the field, and Clear undoes it all', async ({ app, page }) => {
  await app.boot(fixture);
  await expect(page.locator('#filter-status')).toBeHidden();

  await page.locator('#search').fill('parser');
  await expect(titles(page)).toHaveText([parser.title, tests.title]);
  await expect(page.locator('#filter-count')).toHaveText('Showing 2 of 3');
  await expect(page.locator('#filter-toggle')).toHaveClass(/\bactive\b/);

  await page.locator('#filter-toggle').click();
  await page.locator('#pinned-filter').click();
  await expect(page.locator('#pinned-filter')).toHaveAttribute('aria-pressed', 'true');
  await expect(titles(page)).toHaveText([parser.title]);
  await expect(page.locator('#filter-count')).toHaveText('Showing 1 of 3');

  // Shut over a filter: the pills go, the field still says what is on.
  await page.locator('#filter-toggle').click();
  await expect(page.locator('#filters-card')).toBeHidden();
  await expect(page.locator('#search')).toHaveValue('parser is:pinned');
  await expect(page.locator('#filter-count')).toHaveText('Showing 1 of 3');

  await page.locator('#filter-clear').click();
  await expect(titles(page)).toHaveText([parser.title, docs.title, tests.title]);
  await expect(page.locator('#search')).toHaveValue('');
  await expect(page.locator('#filter-status')).toBeHidden();
  await expect(page.locator('#filter-toggle')).not.toHaveClass(/\bactive\b/);
});

test('Clear and close empties the filter and shuts the pills in one press, and shows only while they are open', async ({ app, page }) => {
  await app.boot(fixture);
  await page.locator('#search').fill('parser');
  await page.locator('#filter-toggle').click();
  await page.locator('#pinned-filter').click();
  await expect(titles(page)).toHaveText([parser.title]);

  await page.locator('#filter-toggle').click();
  await expect(page.locator('#filter-clear')).toBeVisible();
  await expect(page.locator('#filter-clear-close')).toBeHidden();

  await page.locator('#filter-toggle').click();
  await page.locator('#filter-clear-close').click();
  await expect(page.locator('#filters-card')).toBeHidden();
  await expect(page.locator('#filter-status')).toBeHidden();
  await expect(titles(page)).toHaveText([parser.title, docs.title, tests.title]);
  await expect(page.locator('#search')).toHaveValue('');

  await page.locator('#filter-toggle').click();
  await expect(page.locator('#pinned-filter')).toHaveAttribute('aria-pressed', 'false');
});

// With the list already at its top, so a filter's return there moves nothing that would be saved for its own sake.
test('the query is saved as it is set, and whether the pills are open is not', async ({ app, page }) => {
  await app.boot(fixture);
  await page.locator('#search').fill('parser');
  await expect.poll(async () => (await app.saved())?.query).toBe('parser');
  await page.locator('#filter-toggle').click();
  await page.locator('#pinned-filter').click();
  await expect.poll(async () => (await app.saved())?.query).toBe('parser is:pinned');
  expect(Object.keys((await app.saved()) ?? {})).not.toContain('filterPanelOpen');
});

test('the finished switch, which the field does not show, is said by the count and the funnel once the pills shut', async ({ app, page }) => {
  await app.boot({ ...fixture, finished: { [docs.id]: 1, [tests.id]: 2 } });
  await page.locator('#filter-toggle').click();
  await page.locator('#finished-filter').click();
  await page.locator('#filter-toggle').click();
  await expect(page.locator('#filters-card')).toBeHidden();
  await expect(page.locator('#search')).toHaveValue('');
  await expect(titles(page)).toHaveText([docs.title, tests.title]);
  await expect(page.locator('#filter-count')).toHaveText('Showing 2 of 2 finished');
  await expect(page.locator('#filter-toggle')).toHaveClass(/\bactive\b/);
});

test('a filter left on comes back on at launch, in the field, with the pills shut', async ({ app, page }) => {
  await app.boot({ ...fixture, uiState: { ...defaultUi(), query: 'parser is:pinned' } });
  await expect(titles(page)).toHaveText([parser.title]);
  await expect(page.locator('#filters-card')).toBeHidden();
  await expect(page.locator('#filter-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#search')).toHaveValue('parser is:pinned');
  await expect(page.locator('#filter-count')).toHaveText('Showing 1 of 3');
});

test("the search box's × draws in the muted ink, and in the text's while the pointer is on it", async ({ app, page }) => {
  await app.boot(fixture);
  const search = page.locator('#search');
  await search.fill('parser');
  const box = (await search.boundingBox())!;
  // The × sits at the field's right end, inside its 10px padding.
  const clip = { x: box.x + box.width - 26, y: box.y + box.height / 2 - 8, width: 20, height: 16 };
  const inked = async (variable: string): Promise<number> => {
    const [r, g, b] = (await token(page, variable)).match(/\d+/g)!.map(Number);
    return (await pixels(page, clip)).flat().filter(([pr, pg, pb]) => Math.abs(pr - r) + Math.abs(pg - g) + Math.abs(pb - b) < 30).length;
  };
  // A × of thin strokes inks a few pixels fully; the 12px button unmasked would ink all 144.
  const ofAnX = (count: number): void => {
    expect(count).toBeGreaterThan(4);
    expect(count).toBeLessThan(40);
  };
  ofAnX(await inked('--muted'));
  await page.mouse.move(box.x + box.width - 16, box.y + box.height / 2);
  ofAnX(await inked('--text'));
});
