import type { Locator, Page } from '@playwright/test';
import type { SessionCheckout } from '../../../../../../src/shared/types';
import { PROJECT, session } from '../../../../support/fixture';
import { expect, test } from '../../../../support/harness';
import { token } from '../../../../support/looks';
import { row, tab } from '../../../../support/window';

// The checkouts a session worked in come from its transcript (docs/architecture/sessions.md § Reading sessions): its worktree mark counts them, in the accent while its panels follow it into a worktree, and lists them.
const worktree = (name: string): string => `${PROJECT}/.claude/worktrees/${name}`;
const checkout = (root: string, at: string, over: Partial<SessionCheckout> = {}): SessionCheckout => ({ root, at, gone: false, own: false, ...over });
// d90f859a's shape: in the main checkout, its changes in worktrees it reached by path or with a `cd`, one of them removed since, as two of its five are.
const worked = session({
  id: '00000000-0000-4000-8000-0000000000e1',
  title: 'Worked in worktrees',
  workCwd: worktree('feat-b'),
  checkouts: [checkout(worktree('feat-b'), '2026-10-26T10:00:00.000Z'), checkout(worktree('feat-c'), '2026-10-26T09:00:00.000Z', { gone: true }), checkout(PROJECT, '2026-10-26T08:00:00.000Z')],
});
// bed25ad5's: its panels back where it runs.
const before = session({
  id: '00000000-0000-4000-8000-0000000000e2',
  title: 'Worked in one before',
  checkouts: [checkout(PROJECT, '2026-10-26T10:00:00.000Z'), checkout(worktree('feat-d'), '2026-10-26T09:00:00.000Z', { gone: true })],
});
// 49ac1ff5's: in a worktree, its changes in another.
const beside = session({
  id: '00000000-0000-4000-8000-0000000000e3',
  title: 'In one and changing another',
  cwd: worktree('feature-x'),
  worktree: 'feature-x',
  workCwd: worktree('feat-b'),
  checkouts: [checkout(worktree('feat-b'), '2026-10-26T10:00:00.000Z'), checkout(worktree('feature-x'), '', { own: true })],
});
const inside = session({ id: '00000000-0000-4000-8000-0000000000e4', title: 'In its worktree', cwd: worktree('feature-x'), worktree: 'feature-x' });
const everyone = [worked, before, beside, inside];
const fixture = { sessions: everyone, history: Object.fromEntries(everyone.map((s) => [s.id, []])) };

const mark = (page: Page, title: string): Locator => row(page, title).locator('.worktree-badge');
const items = (page: Page): Locator => page.locator('.kebab-menu:not(.submenu) button');

test("a session's worktree mark counts the checkouts it worked in, in the accent while its panels follow it into a worktree", async ({ app, page }) => {
  await app.boot(fixture);
  await expect(mark(page, worked.title)).toHaveText('3');
  await expect(mark(page, worked.title)).toHaveAttribute('data-tooltip', 'Its panels follow it into linked git worktree: feat-b; 3 checkouts it worked in — click to list them');
  await expect(mark(page, worked.title)).toHaveCSS('color', await token(page, '--accent'));
  await expect(mark(page, beside.title)).toHaveText('2');
  await expect(mark(page, before.title)).toHaveText('2');
  await expect(mark(page, before.title)).toHaveCSS('color', await token(page, '--muted'));
  // Filled under the pointer in its own ink, as a mark that lists is, so a muted one fills muted rather than in the accent.
  await mark(page, before.title).hover();
  await expect(mark(page, before.title)).toHaveCSS('background-color', await token(page, '--muted'));
});

test("a worktree mark with nothing to list shows no count and is no control: a press on it is the row's", async ({ app, page }) => {
  await app.boot(fixture);
  await expect(mark(page, inside.title)).toHaveText('');
  await expect(mark(page, inside.title)).toHaveAttribute('data-tooltip', 'Linked git worktree: feature-x');
  await expect(mark(page, inside.title)).not.toHaveClass(/\bmenu-badge\b/);
  await mark(page, inside.title).click();
  await expect(page.locator('.kebab-menu')).toHaveCount(0);
  await expect(tab(page, inside.title)).toHaveCount(1);
});

test('the mark lists the checkouts under what a pick does, after Follow the session, in the order main gives, a gone one unavailable, without opening the session', async ({ app, page }) => {
  await app.boot({ ...fixture, openSessions: [worked.id] });
  await mark(page, worked.title).click();
  await expect(page.locator('.kebab-menu .menu-header-line')).toHaveText(['Where the panels look', 'A pick holds them there until you follow the session again']);
  await expect(items(page)).toHaveText(['Follow the session', /^feat-b · /, /^feat-c · /, /^demo · /]);
  await expect(items(page).nth(2)).toHaveClass(/\bunavailable\b/);
  await expect(items(page).nth(2)).toHaveAttribute('data-tooltip', 'Its folder is gone');
  expect(await app.calls('startTerminal')).toEqual([]);
  // A menu cuts its header's first line when too long for it, and before a pick the list's header is all that says what one does, so its first line fits.
  const cut = await page.locator('.kebab-menu .menu-header-line').evaluateAll((lines) => lines.filter((line) => line.scrollWidth > line.clientWidth).map((line) => line.textContent));
  expect(cut).toEqual([]);
});

test('the list names the worktree its mark names by where the session is, where it changed nothing', async ({ app, page }) => {
  await app.boot(fixture);
  await mark(page, beside.title).click();
  await expect(items(page)).toHaveText(['Follow the session', /^feat-b · /, 'feature-x · runs here']);
});

test("a session's options list its checkouts, from its row and from its tab", async ({ app, page }) => {
  await app.boot({ ...fixture, openSessions: [worked.id] });
  for (const kebab of [row(page, worked.title).locator('.session-kebab'), tab(page, worked.title).locator('.tab-kebab')]) {
    await kebab.click();
    await page.locator('.kebab-menu button', { hasText: 'Worktrees (3)' }).click();
    await expect(page.locator('.kebab-menu.submenu button')).toHaveText(['Follow the session', /^feat-b · /, /^feat-c · /, /^demo · /]);
  }
});

// The same rule as the row's mark, without the count, which a tab has no room for.
test("a tab's worktree mark says what its row's does", async ({ app, page }) => {
  await app.boot({ ...fixture, openSessions: [worked.id, before.id] });
  const tabMark = (title: string): Locator => tab(page, title).locator('.tab-worktree');
  await expect(tabMark(worked.title)).toHaveAttribute('data-tooltip', 'Its panels follow it into linked git worktree: feat-b; 3 checkouts it worked in');
  await expect(tabMark(worked.title)).toHaveCSS('color', await token(page, '--accent'));
  await expect(tabMark(before.title)).toHaveAttribute('data-tooltip', '2 checkouts it worked in');
  await expect(tabMark(before.title)).toHaveCSS('color', await token(page, '--muted'));
});
