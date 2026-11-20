import type { Locator, Page } from '@playwright/test';
import type { DiffPicks, DiffQuestion } from '../../../../../src/shared/diff/types';
import { PROJECT } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { bootDiff, editor, file, fileDiff, menuRows, panel, picksData, questionButton, rootRows, rows, summary } from './explorer';

// Each checkout in the Explorer answers the panel's question, or one it is set to on its own from its kebab; the toolbar's question sets every checkout, and reads Mixed while any answers another.

const FIX = `${PROJECT}/.claude/worktrees/fix`;
const OLD = `${PROJECT}/.claude/worktrees/old`;
const AT = '2026-11-19T08:00:00.000Z';
const POLL = 30_000;

/** A session working in the `fix` worktree, which also changed files in `old`; `old` lists two files since it branched, one of them not committed, and is read against its own commit for each question. */
const inWorktrees = (data?: Partial<DiffPicks>): Parameters<typeof bootDiff>[2] => ({
  as: {
    cwd: FIX,
    worktree: 'fix',
    checkouts: [
      { root: FIX, at: AT, gone: false, own: true },
      { root: OLD, at: AT, gone: false, own: false },
    ],
  },
  checkouts: {
    [FIX]: {
      diffs: { since: summary({ root: FIX, branch: 'fix', files: [file('src/a.ts')] }), unpushed: summary({ root: FIX, branch: 'fix', files: [file('src/a.ts')] }) },
      files: { 'src/a.ts': fileDiff('src/a.ts', [{ old: 1, new: 1, rows: ['+a'] }], ['a']) },
    },
    [OLD]: {
      diffs: {
        since: summary({ root: OLD, branch: 'old', files: [file('src/b.ts'), file('src/c.ts')], counts: { ahead: 4, behind: 2, unpushed: 1 } }),
        unpushed: summary({ root: OLD, branch: 'old', against: 'bbbbbbb', files: [file('src/b.ts')] }),
        uncommitted: summary({ root: OLD, branch: 'old', against: 'ccccccc', files: [file('src/c.ts')] }),
      },
      files: { 'src/c.ts': fileDiff('src/c.ts', [{ old: 1, new: 1, rows: ['+c'] }], ['c']) },
      tree: 'clean',
    },
  },
  ...(data ? { data: picksData(data) } : {}),
});

/** The main checkout, where others changed one file. */
const main = { since: summary({ root: PROJECT, branch: 'develop', files: [file('x.ts')] }), unpushed: summary({ root: PROJECT, branch: 'develop', files: [] }) };

const kebab = (page: Page, at: number): Locator => rootRows(page).nth(at).locator('.explorer-root-kebab');
const mark = (page: Page, at: number): Locator => rootRows(page).nth(at).locator('.explorer-question');
const ticked = (page: Page): Locator => menuRows(page).filter({ has: page.locator('.menu-tick svg') });
/** What the Explorer's own file keeps of its picks, written there once anything was picked. */
const kept = (page: Page): Promise<DiffPicks | undefined> => page.evaluate(() => window.__claudeUiFixture.panelData.changes.diff);
/** The questions main was asked about `root`, in order. */
const askedOf = async (app: App, root: string): Promise<DiffQuestion[]> =>
  (await app.calls('diffSummary')).filter((args) => args[0] === root).map((args) => args[1] as DiffQuestion);

test('a checkout’s menu names its branch and base, and ticks Follow the panel while it follows the panel', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees());
  await kebab(page, 1).click();
  await expect(page.locator('.kebab-menu .menu-header')).toHaveText(/^old.*from upstream\/main · guessed · 2 behind$/);
  await expect(menuRows(page)).toHaveText(['Follow the panel · Since branched', 'Since branched · 4 commits', 'Unpushed · 1 commit', 'Uncommitted']);
  await expect(ticked(page)).toHaveText(['Follow the panel · Since branched']);
});

test('a checkout set on its own lists that question’s files, says so on its row, and the toolbar reads Mixed', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees());
  await expect(rows(page)).toHaveText(['Msrc/a.ts+1', 'Msrc/b.ts+1', 'Msrc/c.ts+1']);
  await expect(mark(page, 1)).toHaveCount(0);

  await kebab(page, 1).click();
  await menuRows(page).filter({ hasText: 'Uncommitted' }).click();
  await expect(rows(page)).toHaveText(['Msrc/a.ts+1', 'Msrc/c.ts+1']);
  await expect(mark(page, 1)).toHaveText('Uncommitted');
  await expect(mark(page, 0)).toHaveCount(0);
  await expect(questionButton(page)).toHaveText('Mixed');
  expect(await kept(page)).toEqual({ question: 'since', roots: { [OLD]: 'uncommitted' } });
});

test('a checkout’s own question is kept for the panel, and its menu ticks it', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees({ roots: { [OLD]: 'uncommitted' } }));
  await expect(rows(page)).toHaveText(['Msrc/a.ts+1', 'Msrc/c.ts+1']);
  await expect(mark(page, 1)).toHaveText('Uncommitted');
  await kebab(page, 1).click();
  await expect(ticked(page)).toHaveText(['Uncommitted']);
});

test('a checkout set on its own to the panel’s question still says so, and the toolbar reads Mixed', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees({ roots: { [OLD]: 'since' } }));
  await expect(rows(page)).toHaveText(['Msrc/a.ts+1', 'Msrc/b.ts+1', 'Msrc/c.ts+1']);
  await expect(mark(page, 1)).toHaveText('Since branched');
  await expect(questionButton(page)).toHaveText('Mixed');
});

test('Follow the panel puts a checkout back on the panel’s question', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees({ roots: { [OLD]: 'uncommitted' } }));
  await expect(questionButton(page)).toHaveText('Mixed');
  await kebab(page, 1).click();
  await menuRows(page).filter({ hasText: 'Follow the panel' }).click();
  await expect(rows(page)).toHaveText(['Msrc/a.ts+1', 'Msrc/b.ts+1', 'Msrc/c.ts+1']);
  await expect(mark(page, 1)).toHaveCount(0);
  await expect(questionButton(page)).toHaveText('Since branched');
  expect(await kept(page)).toEqual({ question: 'since' });
});

test('the toolbar’s question sets every checkout, those set on their own included', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees({ roots: { [OLD]: 'uncommitted' } }));
  await expect(questionButton(page)).toHaveText('Mixed');
  await questionButton(page).click();
  await expect(page.locator('.kebab-menu .menu-header')).toHaveText('1 checkout set on its ownA pick here sets every checkout.');
  await expect(ticked(page)).toHaveCount(0);

  await menuRows(page).filter({ hasText: 'Unpushed' }).click();
  await expect(rows(page)).toHaveText(['Msrc/a.ts+1', 'Msrc/b.ts+1']);
  await expect(mark(page, 1)).toHaveCount(0);
  await expect(questionButton(page)).toHaveText('Unpushed');
  expect(await kept(page)).toEqual({ question: 'unpushed' });
});

test('with more than one checkout the toolbar names no base and counts no commits, since its pick sets them all', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees());
  await expect(rootRows(page)).toHaveCount(3);
  await expect(panel(page).locator('.diff-base')).toHaveText('');
  await questionButton(page).click();
  await expect(menuRows(page)).toHaveText(['Since branched', 'Unpushed', 'Uncommitted']);
});

test('a checkout’s row, kebab and all, is as tall as a file’s, its name the size of a file’s, and its count ends where theirs do', async ({ app, page }) => {
  await bootDiff(app, main, inWorktrees());
  const root = rootRows(page).nth(1);
  const file = rows(page).nth(1);
  const box = async (row: Locator, part: string): Promise<{ height: number; right: number; size: string }> =>
    row.locator(part).first().evaluate((el) => ({ height: el.closest('.list-row')!.getBoundingClientRect().height, right: el.getBoundingClientRect().right, size: getComputedStyle(el).fontSize }));
  const [rootName, fileName] = [await box(root, '.card-title .list-text'), await box(file, '.card-title .list-text')];
  expect(rootName.size).toBe(fileName.size);
  expect(rootName.height).toBe(fileName.height);
  expect((await box(root, '.list-trail')).right).toBe((await box(file, '.list-trail')).right);
});

test('a step into a checkout set on its own follows that checkout for its own question', async ({ app, page }) => {
  await page.clock.install();
  await bootDiff(app, main, inWorktrees({ roots: { [OLD]: 'uncommitted' } }));
  await rows(page).first().click();
  await editor(page).locator('.diff-hunks').press('j');
  await expect(editor(page).locator('.diff-file-path')).toContainText('src/c.ts');
  expect((await app.calls('diffFile')).at(-1)?.slice(0, 2)).toEqual([OLD, 'ccccccc']);
  const before = (await askedOf(app, OLD)).length;

  await page.evaluate((dir) => void (window.__claudeUiFixture.trees[dir] = 'edited'), OLD);
  await page.clock.fastForward(POLL);
  await page.clock.fastForward(POLL);
  await expect.poll(async () => (await askedOf(app, OLD)).length).toBeGreaterThan(before);
  expect((await askedOf(app, OLD)).slice(before)).toEqual(['uncommitted']);
});
