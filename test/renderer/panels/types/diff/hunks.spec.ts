import { PROJECT } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { bootDiff, diffLines, file, fileDiff, fileNote, menuRows, panel, position, rows, summary } from './diff';

// Picking a file in the diff panel shows its diff: unified while the panel is narrow and split from 600px, the unchanged lines between changes folded, the words that changed marked, and a stepper through the changes.

const fifty = Array.from({ length: 50 }, (_, at) => `line ${at + 1}`);
const edited = fileDiff('src/a.ts', [{ old: 39, new: 39, heading: 'function a()', rows: [' line 39', '-line 40', '+line forty', ' line 41'] }], fifty.map((line, at) => (at === 39 ? 'line forty' : line)));
const listed = summary({ files: [file('src/a.ts', { added: 1, deleted: 1 }), file('src/b.ts')] });
const second = fileDiff('src/b.ts', [{ old: 1, new: 1, rows: ['+new first line', ' kept'] }], ['new first line', 'kept']);

test('picking a file shows its diff, unified while the panel is narrow, and marks its row', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited } });
  await expect(fileNote(page)).toHaveText('Pick a file to see what changed in it.');
  await rows(page).first().click();
  await expect(rows(page).first()).toHaveAttribute('aria-current', 'true');
  await expect(panel(page).locator('.diff-hunks')).not.toHaveClass(/split/);
  await expect(diffLines(page).filter({ hasText: 'line forty' })).toHaveClass(/add/);
  await expect(diffLines(page).filter({ hasText: 'line 40' }).first()).toHaveClass(/del/);
  expect((await app.calls('diffFile')).at(-1)).toEqual([PROJECT, 'aaaaaaa', 'src/a.ts', null, 3, false]);
});

test('from 600px wide the list sits beside the diff, and Fit draws it split', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited }, width: '720px' });
  await rows(page).first().click();
  await expect(panel(page).locator('.diff-hunks')).toHaveClass(/split/);
  const list = await panel(page).locator('.diff-list-area').boundingBox();
  const diff = await panel(page).locator('.diff-file-view').boundingBox();
  expect(list!.x + list!.width).toBeLessThanOrEqual(diff!.x + 1);
});

test('below 600px the list sits above the diff', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited }, width: '560px' });
  await rows(page).first().click();
  const list = await panel(page).locator('.diff-list-area').boundingBox();
  const diff = await panel(page).locator('.diff-file-view').boundingBox();
  expect(list!.y + list!.height).toBeLessThanOrEqual(diff!.y + 1);
});

test('Split picked from the view menu holds in a narrow panel, and is kept for the panel', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited } });
  await rows(page).first().click();
  await panel(page).locator('.diff-view-button').click();
  await menuRows(page).filter({ hasText: 'Split' }).click();
  await expect(panel(page).locator('.diff-hunks')).toHaveClass(/split/);
  expect((await app.calls('setDiffPicks')).at(-1)).toEqual(['changes', { question: 'since', view: 'split', ignoreWs: false }]);
});

test('the unchanged lines before a change are folded, open twenty at a time from the change, and whole on a press', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited } });
  await rows(page).first().click();
  const fold = panel(page).locator('.diff-fold').first();
  await expect(fold).toContainText('38 unchanged lines');
  await fold.locator('.diff-fold-step').click();
  await expect(panel(page).locator('.diff-fold').first()).toContainText('18 unchanged lines');
  await panel(page).locator('.diff-fold').first().click();
  await expect(diffLines(page).filter({ hasText: /^line 1$/ })).toHaveCount(1);
});

test('fewer than five unchanged lines are shown rather than folded', async ({ app, page }) => {
  const near = fileDiff('src/a.ts', [{ old: 4, new: 4, rows: [' line 4', '-line 5', '+line five', ' line 6'] }], fifty.slice(0, 6).map((line, at) => (at === 4 ? 'line five' : line)));
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': near } });
  await rows(page).first().click();
  await expect(panel(page).locator('.diff-fold')).toHaveCount(0);
  await expect(diffLines(page).filter({ hasText: /^line 1$/ })).toHaveCount(1);
});

test("git's heading for a change stands over it while the lines above it are folded", async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited } });
  await rows(page).first().click();
  await expect(panel(page).locator('.diff-heading')).toHaveText('function a()');
});

test('the words that changed in a removed and an added line are marked', async ({ app, page }) => {
  const marked = fileDiff('src/a.ts', [{ old: 1, new: 1, rows: ['-the old word', '+the new word'] }], ['the new word']);
  marked.hunks[0].rows[0].words = [[4, 7]];
  marked.hunks[0].rows[1].words = [[4, 7]];
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': marked } });
  await rows(page).first().click();
  await expect(panel(page).locator('.word-del')).toHaveText('old');
  await expect(panel(page).locator('.word-add')).toHaveText('new');
});

test('the stepper walks the changes and carries on into the next file, saying where it is', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited, 'src/b.ts': second } });
  await rows(page).first().click();
  await expect(position(page)).toHaveText('change 1 of 1 · file 1 of 2');
  await panel(page).locator('.diff-hunks').press('j');
  await expect(position(page)).toHaveText('change 1 of 1 · file 2 of 2');
  await expect(rows(page).nth(1)).toHaveAttribute('aria-current', 'true');
  await panel(page).locator('.diff-hunks').press('k');
  await expect(position(page)).toHaveText('change 1 of 1 · file 1 of 2');
});

test('with one file to step through, the stepper goes round from its last change to its first', async ({ app, page }) => {
  const two = fileDiff('src/a.ts', [
    { old: 2, new: 2, rows: ['-a', '+b'] },
    { old: 30, new: 30, rows: ['+c'] },
  ], fifty);
  await bootDiff(app, { since: summary({ files: [file('src/a.ts')] }) }, { files: { 'src/a.ts': two } });
  await rows(page).first().click();
  await panel(page).locator('.diff-hunks').press('j');
  await expect(position(page)).toHaveText('change 2 of 2');
  await panel(page).locator('.diff-hunks').press('j');
  await expect(position(page)).toHaveText('change 1 of 2');
});

test('a step past the last change, with no other file to step into, goes round in the same file', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited } });
  await rows(page).first().click();
  await panel(page).locator('.diff-hunks').press('j');
  await expect(rows(page).first()).toHaveAttribute('aria-current', 'true');
  await expect(position(page)).toHaveText('change 1 of 1 · file 1 of 2');
});

test('the change map has a tick per change, and a press on one goes to it', async ({ app, page }) => {
  const two = fileDiff('src/a.ts', [
    { old: 2, new: 2, rows: ['-a', '+b'] },
    { old: 30, new: 30, rows: ['+c'] },
  ], fifty);
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': two } });
  await rows(page).first().click();
  const ticks = panel(page).locator('.diff-tick');
  await expect(ticks).toHaveCount(2);
  await expect(ticks.nth(0)).toHaveClass(/mixed/);
  await ticks.nth(1).click();
  await expect(position(page)).toHaveText('change 2 of 2 · file 1 of 2');
});

test('a generated file is one line until it is asked for', async ({ app, page }) => {
  const lock = summary({ files: [file('package-lock.json', { generated: true, added: 9, deleted: 4 })] });
  await bootDiff(app, { since: lock }, { files: { 'package-lock.json': fileDiff('package-lock.json', [{ old: 1, new: 1, rows: ['-a', '+b'] }], ['b']) } });
  await rows(page).first().click();
  await expect(panel(page).locator('.diff-fold')).toHaveText('⋯ generated file, +9 −4, press to show');
  await panel(page).locator('.diff-fold').click();
  await expect(diffLines(page).filter({ hasText: /^b$/ })).toHaveCount(1);
});

test('a binary file says so', async ({ app, page }) => {
  await bootDiff(app, { since: summary({ files: [file('logo.png', { binary: true })] }) });
  await rows(page).first().click();
  await expect(fileNote(page)).toHaveText('A binary file: nothing to show.');
});

test('hiding whitespace reads the file again without it, and is kept for the panel', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited } });
  await rows(page).first().click();
  await panel(page).locator('.diff-view-button').click();
  await menuRows(page).filter({ hasText: 'Hide whitespace changes' }).click();
  await expect.poll(async () => (await app.calls('diffFile')).at(-1)?.[5]).toBe(true);
  expect((await app.calls('setDiffPicks')).at(-1)).toEqual(['changes', { question: 'since', view: 'fit', ignoreWs: true }]);
});
