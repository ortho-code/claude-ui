import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../../support/harness';
import { bootDiff, diffLines, file, fileDiff, rows, summary } from '../diff/diff';

// A file's diff is coloured by its language, each side read as one text, so a line inside a block comment colours as a comment, and the words that changed are marked over the colours rather than in their place.

/** The colour a piece of a line is drawn in, as its own style says it. */
const colourOf = (piece: Locator): Promise<string> => piece.evaluate((el) => (el as HTMLElement).style.color);

/** The piece of the diff's line holding `text` that reads exactly `piece`. */
const pieceOf = (page: Page, text: string | RegExp, piece: string): Locator => diffLines(page).filter({ hasText: text }).locator('s span').filter({ hasText: new RegExp(`^${piece.replace(/[$.*]/g, '\\$&')}$`) }).first();

const code = ['/**', ' * a note that runs on', ' */', 'const total = price * qty;'];

test('a TypeScript file colours its keywords in the keyword colour', async ({ app, page }) => {
  const diff = fileDiff('src/a.ts', [{ old: 4, new: 4, rows: ['-const total = 1;', '+const total = price * qty;'] }], code);
  await bootDiff(app, { since: summary({ files: [file('src/a.ts')] }) }, { files: { 'src/a.ts': diff } });
  await rows(page).first().click();
  expect(await colourOf(pieceOf(page, 'price', 'const'))).toBe('var(--syntax-token-keyword)');
});

test("a line inside a block comment colours as a comment, though the hunk shows none of the comment's start", async ({ app, page }) => {
  const diff = fileDiff('src/a.ts', [{ old: 2, new: 2, rows: ['- * a note', '+ * a note that runs on'] }], code);
  await bootDiff(app, { since: summary({ files: [file('src/a.ts')] }) }, { files: { 'src/a.ts': diff } });
  await rows(page).first().click();
  const added = diffLines(page).filter({ hasText: 'a note that runs on' }).locator('s span').first();
  expect(await colourOf(added)).toBe('var(--syntax-token-comment)');
});

test('a changed word keeps its colour under its mark', async ({ app, page }) => {
  const lines = [...code.slice(0, 3), 'const total = price * 3;'];
  const diff = fileDiff('src/a.ts', [{ old: 4, new: 4, rows: ['-const total = price * 2;', '+const total = price * 3;'] }], lines);
  diff.hunks[0].rows[1].words = [[22, 23]];
  await bootDiff(app, { since: summary({ files: [file('src/a.ts')] }) }, { files: { 'src/a.ts': diff } });
  await rows(page).first().click();
  const marked = diffLines(page).filter({ hasText: 'price * 3' }).locator('s .word-add');
  await expect(marked).toHaveText('3');
  expect(await colourOf(marked)).toBe('var(--syntax-token-constant)');
});

for (const path of ['notes.xyz', 'lib/task.rb']) {
  test(`a file in a language not picked is plain text, one a picked grammar only embeds as well: ${path}`, async ({ app, page }) => {
    const diff = fileDiff(path, [{ old: 1, new: 1, rows: ['-def a', '+def b'] }], ['def b']);
    await bootDiff(app, { since: summary({ files: [file(path)] }) }, { files: { [path]: diff } });
    await rows(page).first().click();
    await expect(diffLines(page).filter({ hasText: 'def b' })).toHaveCount(1);
    await expect(diffLines(page).filter({ hasText: 'def b' }).locator('s span[style]')).toHaveCount(0);
  });
}
