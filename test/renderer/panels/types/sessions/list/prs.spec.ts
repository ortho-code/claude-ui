import type { SessionPr } from '../../../../../../src/shared/types';
import { session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { row, tab } from '../../../../support/window';

// A session's PRs come from its transcript (docs/architecture.md § Reading sessions): its row carries a mark counting them, the mark lists them, and picking one opens its page.
const pr = (number: number): SessionPr => ({ repository: 'ScientaNL/demo', number, url: `https://github.com/ScientaNL/demo/pull/${number}` });
const two = session({ id: '00000000-0000-4000-8000-0000000000d1', title: 'Linked two PRs', prs: [pr(12), pr(7)] });
const one = session({ id: '00000000-0000-4000-8000-0000000000d2', title: 'Linked one PR', prs: [pr(3)] });
const none = session({ id: '00000000-0000-4000-8000-0000000000d3', title: 'Linked none' });
const fixture = { sessions: [two, one, none], history: { [two.id]: [], [one.id]: [], [none.id]: [] } };

test("a session's PRs show as a mark on its row, counted, with the count in its tooltip, and a session without one has none", async ({ app, page }) => {
  await app.boot(fixture);
  const mark = row(page, two.title).locator('.pr-badge');
  await expect(mark).toHaveText('2');
  await expect(mark).toHaveAttribute('data-tooltip', '2 PRs linked to this session — click to list them');
  await expect(row(page, one.title).locator('.pr-badge')).toHaveAttribute('data-tooltip', '1 PR linked to this session — click to list them');
  await expect(row(page, none.title).locator('.pr-badge')).toBeHidden();
});

test('the mark lists the PRs by their full reference, oldest first, and opens the one picked, without opening the session', async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, two.title).locator('.pr-badge').click();
  await expect(page.locator('.kebab-menu button')).toHaveText(['ScientaNL/demo#12', 'ScientaNL/demo#7']);
  await page.locator('.kebab-menu button', { hasText: 'ScientaNL/demo#7' }).click();
  expect(await app.calls('openExternal')).toEqual([['https://github.com/ScientaNL/demo/pull/7']]);
  await expect(tab(page, two.title)).toHaveCount(0);
});

test("a session's options list its PRs, from its row and from its tab, each opening its page", async ({ app, page }) => {
  await app.boot({ ...fixture, openSessions: [two.id] });
  await row(page, two.title).locator('.session-kebab').click();
  await page.locator('.kebab-menu button', { hasText: 'PRs (2)' }).click();
  await expect(page.locator('.kebab-menu.submenu button')).toHaveText(['ScientaNL/demo#12', 'ScientaNL/demo#7']);
  await page.locator('.kebab-menu.submenu button', { hasText: 'ScientaNL/demo#12' }).click();

  await tab(page, two.title).locator('.tab-kebab').click();
  await page.locator('.kebab-menu button', { hasText: 'PRs (2)' }).click();
  await expect(page.locator('.kebab-menu.submenu button')).toHaveText(['ScientaNL/demo#12', 'ScientaNL/demo#7']);
  await page.locator('.kebab-menu.submenu button', { hasText: 'ScientaNL/demo#7' }).click();
  expect(await app.calls('openExternal')).toEqual([['https://github.com/ScientaNL/demo/pull/12'], ['https://github.com/ScientaNL/demo/pull/7']]);
});

test('the options of a session without a PR have no PRs item', async ({ app, page }) => {
  await app.boot(fixture);
  await row(page, none.title).locator('.session-kebab').click();
  await expect(page.locator('.kebab-menu button', { hasText: 'Archive' })).toBeVisible();
  await expect(page.locator('.kebab-menu button', { hasText: /^PRs/ })).toHaveCount(0);
});

test('a PR the transcript links while the app runs shows on the row', async ({ app, page }) => {
  await app.boot(fixture);
  const mark = row(page, none.title).locator('.pr-badge');
  await expect(mark).toBeHidden();
  await app.listOnDisk([two, one, { ...none, prs: [pr(20)] }]);
  await expect(mark).toHaveText('1');
});
