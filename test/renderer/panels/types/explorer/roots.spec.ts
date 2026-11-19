import { PROJECT, session } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { tab } from '../../../support/window';
import { bootDiff, editor, file, fileDiff, picksData, position, rootRows, rows, summary } from './explorer';

// The Explorer shows one tree over the session's checkouts: the one it works in first, then the others it changed files in, then the repository's main checkout, folded, when it changed nothing there; each a row with its branch where that is not the folder's name and its count, its files inside an index line, and a jump to each.

const FIX = `${PROJECT}/.claude/worktrees/fix`;
const OLD = `${PROJECT}/.claude/worktrees/old`;
const AT = '2026-11-19T08:00:00.000Z';

/** A session working in the `fix` worktree, which also changed files in `old`, and nothing in the main checkout. */
const inWorktrees = {
  as: {
    cwd: FIX,
    worktree: 'fix',
    checkouts: [
      { root: FIX, at: AT, gone: false, own: true },
      { root: OLD, at: AT, gone: false, own: false },
    ],
  },
  checkouts: {
    [FIX]: { diffs: { since: summary({ root: FIX, branch: 'fix', files: [file('src/a.ts')] }) }, files: { 'src/a.ts': fileDiff('src/a.ts', [{ old: 1, new: 1, rows: ['+a'] }], ['a']) } },
    [OLD]: { diffs: { since: summary({ root: OLD, branch: 'old', files: [file('src/b.ts'), file('src/c.ts')] }) }, files: { 'src/b.ts': fileDiff('src/b.ts', [{ old: 1, new: 1, rows: ['+b'] }], ['b']) } },
  },
};
/** The main checkout, where others changed three files. */
const main = summary({ root: PROJECT, branch: 'develop', files: [file('x.ts'), file('y.ts'), file('z.ts')] });

test('the session’s checkouts are roots in order, each with its count, the main one it changed nothing in last and folded', async ({ app, page }) => {
  await bootDiff(app, { since: main }, inWorktrees);
  await expect(rootRows(page).locator('.card-title')).toHaveText(['fix', 'old', 'demo']);
  await expect(rootRows(page).locator('.list-trail')).toHaveText(['1', '2', '3']);
  await expect(rootRows(page).nth(2).locator('.list-fold')).toHaveAttribute('aria-expanded', 'false');
  await expect(rows(page)).toHaveText(['Msrc/a.ts+1', 'Msrc/b.ts+1', 'Msrc/c.ts+1']);
  await rootRows(page).nth(2).click();
  await expect(rows(page)).toHaveCount(6);
});

test('the panel counts the files of the roots it opens with, not the folded main checkout’s', async ({ app, page }) => {
  await bootDiff(app, { since: main }, inWorktrees);
  await expect(rootRows(page)).toHaveCount(3);
  await expect(page.locator('.panel-count').first()).toHaveText('3');
});

test('the Editor steps from the last file of one root into the first of the next', async ({ app, page }) => {
  await bootDiff(app, { since: main }, inWorktrees);
  await rows(page).first().click();
  await expect(position(page)).toHaveText('change 1 of 1 · file 1 of 3');
  await editor(page).locator('.diff-hunks').press('j');
  await expect(position(page)).toHaveText('change 1 of 1 · file 2 of 3');
  await expect(editor(page).locator('.diff-file-path')).toContainText('src/b.ts');
  await expect(rows(page).nth(1)).toHaveAttribute('aria-current', 'true');
});

test('a session in the main checkout has it alone as its root', async ({ app, page }) => {
  await bootDiff(app, { since: summary({ files: [file('src/a.ts')] }) });
  await expect(rootRows(page).locator('.card-title')).toHaveText(['demo']);
});

test('a checkout seen open for one session tab starts folded where another lists it as the main checkout it changed nothing in', async ({ app, page }) => {
  const worker = session({ id: '00000000-0000-4000-8000-0000000000f1', title: 'In a worktree', cwd: FIX, worktree: 'fix' });
  await bootDiff(app, { since: main }, { also: worker, checkouts: { [FIX]: inWorktrees.checkouts[FIX] } });
  await expect(rootRows(page).locator('.card-title')).toHaveText(['demo']);
  await expect(rootRows(page).first().locator('.list-fold')).toHaveAttribute('aria-expanded', 'true');
  await tab(page, worker.title).click();
  await expect(rootRows(page).locator('.card-title')).toHaveText(['fix', 'demo']);
  await expect(rootRows(page).nth(1).locator('.list-fold')).toHaveAttribute('aria-expanded', 'false');
});

test('a root’s branch follows its name only where it is not the folder’s own name', async ({ app, page }) => {
  await bootDiff(app, { since: main }, inWorktrees);
  await expect(rootRows(page).locator('.card-title')).toHaveText(['fix', 'old', 'demo']);
  await expect(rootRows(page).nth(0).locator('.explorer-branch')).toHaveCount(0);
  await expect(rootRows(page).nth(1).locator('.explorer-branch')).toHaveCount(0);
  await expect(rootRows(page).nth(2).locator('.explorer-branch')).toHaveText('develop');
});

test('a root’s files sit inside an index line, right under its row', async ({ app, page }) => {
  await bootDiff(app, { since: main }, inWorktrees);
  const blocks = page.locator('.explorer-files > .members-rail');
  await expect(blocks).toHaveCount(2);
  await expect(blocks.nth(1).locator('.list-row')).toHaveText(['Msrc/b.ts+1', 'Msrc/c.ts+1']);
  expect(await blocks.nth(1).evaluate((block) => block.previousElementSibling?.querySelector('.card-title')?.textContent)).toBe('old');
});

test('the jump lists each root with its count, and a press on one unfolds it and brings it into view', async ({ app, page }) => {
  await bootDiff(app, { since: main }, inWorktrees);
  const jump = page.getByRole('button', { name: 'Jump to a checkout' });
  await jump.click();
  await expect(page.locator('.kebab-menu button.menu-row')).toHaveText(['fix1', 'old2', 'demo3']);
  await page.locator('.kebab-menu button.menu-row').filter({ hasText: 'demo' }).click();
  await expect(rootRows(page).nth(2).locator('.list-fold')).toHaveAttribute('aria-expanded', 'true');
  await expect(rootRows(page).nth(2)).toBeInViewport();
});

test('a single root has no jump', async ({ app, page }) => {
  await bootDiff(app, { since: summary({ files: [file('src/a.ts')] }) });
  await expect(rootRows(page)).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Jump to a checkout' })).toBeHidden();
});

test('a long branch gives way before the root’s name does', async ({ app, page }) => {
  const night = `${PROJECT}/.claude/worktrees/renovate-opens-its-prs-at-night`;
  await bootDiff(app, { since: main }, {
    as: { cwd: night, worktree: 'renovate-opens-its-prs-at-night', checkouts: [{ root: night, at: AT, gone: false, own: true }] },
    checkouts: { [night]: { diffs: { since: summary({ root: night, branch: 'renovate/prs-at-night-and-a-good-many-more-words-to-cut', files: [file('renovate.json')] }) } } },
  });
  const first = rootRows(page).first();
  await expect(first.locator('.explorer-branch')).toBeVisible();
  const cut = (selector: string): Promise<boolean> => first.locator(selector).evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(await cut('.card-title')).toBe(false);
  expect(await cut('.explorer-branch-name')).toBe(true);
});

test('with nothing to list, the roots stay whole above the note that says so', async ({ app, page }) => {
  await bootDiff(app, { since: summary({ files: [file('src/a.ts')] }), uncommitted: summary({ files: [] }) }, { data: picksData({ question: 'uncommitted' }) });
  await expect(page.locator('.explorer-note')).toHaveText('Nothing uncommitted.');
  const list = page.locator('.explorer-files');
  expect(await list.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  expect((await rootRows(page).first().boundingBox())!.height).toBeGreaterThan(18);
});

test('a folder no repository holds has the repositories inside it as its roots, counted, with no word of git’s refusal nor of one repository’s base', async ({ app, page }) => {
  const theme = `${PROJECT}/wp-content/themes/theme`;
  const plugin = `${PROJECT}/wp-content/plugins/plugin`;
  await bootDiff(app, {}, {
    as: { isRepo: false },
    nested: { [PROJECT]: [plugin, theme] },
    checkouts: {
      [plugin]: { diffs: { since: summary({ root: plugin, branch: 'main', files: [file('plugin.php')] }) } },
      [theme]: { diffs: { since: summary({ root: theme, branch: 'main', files: [file('style.css'), file('functions.php')] }) } },
    },
  });
  await expect(rootRows(page).locator('.card-title')).toHaveText(['wp-content/plugins/plugin', 'wp-content/themes/theme']);
  await expect(rootRows(page).locator('.list-trail')).toHaveText(['1', '2']);
  await expect(page.locator('.explorer-note')).not.toContainText('Git could not read');
  await expect(page.locator('.panel-count').first()).toHaveText('3');
  await expect(page.locator('.diff-base')).toHaveText('');
});

test('a repository inside the checkout comes after it, folded while it lists no change', async ({ app, page }) => {
  const clone = `${PROJECT}/libs/clone`;
  await bootDiff(app, { since: summary({ files: [file('src/a.ts')] }) }, {
    nested: { [PROJECT]: [clone] },
    checkouts: { [clone]: { diffs: { since: summary({ root: clone, branch: 'main', files: [] }) } } },
  });
  await expect(rootRows(page).locator('.card-title')).toHaveText(['demo', 'libs/clone']);
  await expect(rootRows(page).nth(1).locator('.list-fold')).toHaveAttribute('aria-expanded', 'false');
});
