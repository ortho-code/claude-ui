import { PROJECT } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { bootDiff, diffLines, diffToggle, editor, file, fileDiff, fileLift, fileNote, fileSentence, menuRows, position, rows, summary } from '../explorer/explorer';
import type { App } from '../../../support/harness';

// A file pressed in the Explorer opens in the Editor: the whole file with its changes marked, unified while the Editor is narrow and split from 600px, the words that changed marked, and a stepper through the changes; Changes only folds the unchanged lines between them.

const fifty = Array.from({ length: 50 }, (_, at) => `line ${at + 1}`);
const edited = fileDiff('src/a.ts', [{ old: 39, new: 39, heading: 'function a()', rows: [' line 39', '-line 40', '+line forty', ' line 41'] }], fifty.map((line, at) => (at === 39 ? 'line forty' : line)));
const listed = summary({ files: [file('src/a.ts', { added: 1, deleted: 1 }), file('src/b.ts')] });
const second = fileDiff('src/b.ts', [{ old: 1, new: 1, rows: ['+new first line', ' kept'] }], ['new first line', 'kept']);
const changesOnly = { changesOnly: true };
/** What the window last kept of the Editor. */
const keptEditor = async (app: App): Promise<unknown> => ((await app.calls('setUiState')).at(-1)?.[0] as { editor: unknown } | undefined)?.editor;

test('a file pressed in the list opens in the Editor, unified while it is narrow, and its row is marked', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited } });
  await expect(editor(page)).toHaveCount(0);
  await rows(page).first().click();
  await expect(rows(page).first()).toHaveAttribute('aria-current', 'true');
  await expect(editor(page).locator('.diff-read-only')).toHaveText('Read only');
  await expect(editor(page).locator('.diff-hunks')).not.toHaveClass(/split/);
  await expect(diffLines(page).filter({ hasText: 'line forty' })).toHaveClass(/add/);
  await expect(diffLines(page).filter({ hasText: 'line 40' }).first()).toHaveClass(/del/);
  expect((await app.calls('diffFile')).at(-1)).toEqual([PROJECT, 'aaaaaaa', 'src/a.ts', null, 3, false]);
});

test('from 600px wide the Editor draws Fit split, as full screen makes it docked', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited }, editor: { docked: true } });
  await rows(page).first().click();
  await expect(editor(page).locator('.diff-hunks')).not.toHaveClass(/split/);
  await editor(page).getByRole('button', { name: 'Full screen' }).click();
  await expect(editor(page).locator('.diff-hunks')).toHaveClass(/split/);
});

test('Split picked from the view menu holds in a narrow Editor, and is kept for the window', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited } });
  await rows(page).first().click();
  await editor(page).locator('.diff-view-button').click();
  await menuRows(page).filter({ hasText: 'Split' }).click();
  await expect(editor(page).locator('.diff-hunks')).toHaveClass(/split/);
  await expect.poll(() => keptEditor(app)).toEqual({ docked: false, view: 'split', ignoreWs: false, changesOnly: false });
});

test('the whole file is shown, every unchanged line with no fold, its change marked in place', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited } });
  await rows(page).first().click();
  await expect(editor(page).locator('.diff-fold')).toHaveCount(0);
  await expect(diffLines(page).filter({ hasText: /^line 1$/ })).toHaveCount(1);
  await expect(diffLines(page).filter({ hasText: /^line 50$/ })).toHaveCount(1);
  await expect(diffLines(page).filter({ hasText: 'line forty' })).toHaveClass(/add/);
});

test('Changes only folds the unchanged lines around the changes, and is kept for the window', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited } });
  await rows(page).first().click();
  await diffToggle(page, 'Changes only').click();
  await expect(editor(page).locator('.diff-fold').first()).toContainText('38 unchanged lines');
  await expect(diffLines(page).filter({ hasText: /^line 1$/ })).toHaveCount(0);
  await expect.poll(() => keptEditor(app)).toEqual({ docked: false, view: 'fit', ignoreWs: false, changesOnly: true });
});

test('a file with no change against its base is shown whole', async ({ app, page }) => {
  const same = fileDiff('src/a.ts', [], ['first line', 'second line']);
  await bootDiff(app, { since: summary({ files: [file('src/a.ts')] }) }, { files: { 'src/a.ts': same } });
  await rows(page).first().click();
  await expect(diffLines(page).filter({ hasText: 'second line' })).toHaveCount(1);
  await expect(fileNote(page)).toBeHidden();
});

test('with Changes only, the unchanged lines before a change are folded, open twenty at a time from the change, and whole on a press', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited }, editor: changesOnly });
  await rows(page).first().click();
  const fold = editor(page).locator('.diff-fold').first();
  await expect(fold).toContainText('38 unchanged lines');
  await fold.locator('.diff-fold-step').click();
  await expect(editor(page).locator('.diff-fold').first()).toContainText('18 unchanged lines');
  await editor(page).locator('.diff-fold').first().click();
  await expect(diffLines(page).filter({ hasText: /^line 1$/ })).toHaveCount(1);
});

test('with Changes only, fewer than five unchanged lines are shown rather than folded', async ({ app, page }) => {
  const near = fileDiff('src/a.ts', [{ old: 4, new: 4, rows: [' line 4', '-line 5', '+line five', ' line 6'] }], fifty.slice(0, 6).map((line, at) => (at === 4 ? 'line five' : line)));
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': near }, editor: changesOnly });
  await rows(page).first().click();
  await expect(editor(page).locator('.diff-fold')).toHaveCount(0);
  await expect(diffLines(page).filter({ hasText: /^line 1$/ })).toHaveCount(1);
});

test('a tab in the code is four columns wide, not the browser’s eight', async ({ app, page }) => {
  const tabbed = fileDiff('src/a.ts', [{ old: 1, new: 1, rows: ['-\told', '+\tnew'] }], ['\tnew']);
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': tabbed } });
  await rows(page).first().click();
  const text = diffLines(page).filter({ hasText: 'new' }).locator('s');
  expect(await text.evaluate((el) => getComputedStyle(el).tabSize)).toBe('4');
});

test("with Changes only, git's heading for a change stands over it while the lines above it are folded", async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited }, editor: changesOnly });
  await rows(page).first().click();
  await expect(editor(page).locator('.diff-heading')).toHaveText('function a()');
});

test('the words that changed in a removed and an added line are marked', async ({ app, page }) => {
  const marked = fileDiff('src/a.ts', [{ old: 1, new: 1, rows: ['-the old word', '+the new word'] }], ['the new word']);
  marked.hunks[0].rows[0].words = [[4, 7]];
  marked.hunks[0].rows[1].words = [[4, 7]];
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': marked } });
  await rows(page).first().click();
  await expect(editor(page).locator('.word-del')).toHaveText('old');
  await expect(editor(page).locator('.word-add')).toHaveText('new');
});

test('the stepper walks the changes and carries on into the next file, saying where it is, and the list marks the file on show', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited, 'src/b.ts': second } });
  await rows(page).first().click();
  await expect(position(page)).toHaveText('change 1 of 1 · file 1 of 2');
  await editor(page).locator('.diff-hunks').press('j');
  await expect(position(page)).toHaveText('change 1 of 1 · file 2 of 2');
  await expect(rows(page).nth(1)).toHaveAttribute('aria-current', 'true');
  await editor(page).locator('.diff-hunks').press('k');
  await expect(position(page)).toHaveText('change 1 of 1 · file 1 of 2');
});

test('the stepper passes over a generated file, which has no change to step to while it is folded', async ({ app, page }) => {
  const lock = fileDiff('package-lock.json', [{ old: 1, new: 1, rows: ['-a', '+b'] }], ['b']);
  const three = summary({ files: [file('src/a.ts', { added: 1, deleted: 1 }), file('package-lock.json', { generated: true }), file('src/b.ts')] });
  await bootDiff(app, { since: three }, { files: { 'src/a.ts': edited, 'package-lock.json': lock, 'src/b.ts': second } });
  await rows(page).first().click();
  await editor(page).locator('.diff-hunks').press('j');
  await expect(position(page)).toHaveText('change 1 of 1 · file 3 of 3');
  await expect(rows(page).nth(2)).toHaveAttribute('aria-current', 'true');
});

test('with one file to step through, the stepper goes round from its last change to its first', async ({ app, page }) => {
  const two = fileDiff('src/a.ts', [
    { old: 2, new: 2, rows: ['-a', '+b'] },
    { old: 30, new: 30, rows: ['+c'] },
  ], fifty);
  await bootDiff(app, { since: summary({ files: [file('src/a.ts')] }) }, { files: { 'src/a.ts': two } });
  await rows(page).first().click();
  await editor(page).locator('.diff-hunks').press('j');
  await expect(position(page)).toHaveText('change 2 of 2');
  await editor(page).locator('.diff-hunks').press('j');
  await expect(position(page)).toHaveText('change 1 of 2');
});

test('a step past the last change, with no other file to step into, goes round in the same file', async ({ app, page }) => {
  await bootDiff(app, { since: summary({ files: [file('src/a.ts', { added: 1, deleted: 1 }), file('logo.png', { binary: true })] }) }, { files: { 'src/a.ts': edited } });
  await rows(page).first().click();
  await editor(page).locator('.diff-hunks').press('j');
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
  const ticks = editor(page).locator('.diff-tick');
  await expect(ticks).toHaveCount(2);
  await expect(ticks.nth(0)).toHaveClass(/mixed/);
  await ticks.nth(1).click();
  await expect(position(page)).toHaveText('change 2 of 2 · file 1 of 2');
});

test('a generated file is one line until it is asked for', async ({ app, page }) => {
  const lock = summary({ files: [file('package-lock.json', { generated: true, added: 9, deleted: 4 })] });
  await bootDiff(app, { since: lock }, { files: { 'package-lock.json': fileDiff('package-lock.json', [{ old: 1, new: 1, rows: ['-a', '+b'] }], ['b']) } });
  await rows(page).first().click();
  await expect(editor(page).locator('.diff-fold')).toHaveText('⋯ generated file, +9 −4, press to show');
  await editor(page).locator('.diff-fold').click();
  await expect(diffLines(page).filter({ hasText: /^b$/ })).toHaveCount(1);
});

test('a binary file says so', async ({ app, page }) => {
  await bootDiff(app, { since: summary({ files: [file('logo.png', { binary: true })] }) });
  await rows(page).first().click();
  await expect(fileNote(page)).toHaveText('A binary file: nothing to show.');
});

test('with whitespace hidden, a file whose only change is whitespace says so under Changes only, and with whitespace shown says it has no changes', async ({ app, page }) => {
  await bootDiff(app, { since: summary({ files: [file('src/a.ts')] }) }, { files: { 'src/a.ts': fileDiff('src/a.ts', [], ['same']) }, editor: { ignoreWs: true, changesOnly: true } });
  await rows(page).first().click();
  await expect(fileSentence(page)).toHaveText('Only whitespace changed here, and whitespace is hidden.');
  await expect(fileLift(page)).toHaveText('Show whitespace changes');
  await diffToggle(page, 'Hide whitespace').click();
  await expect(fileSentence(page)).toHaveText('No changes against this base.');
  await expect(fileLift(page)).toHaveText('Show the whole file');
});

test('under Changes only, a rename with nothing else changed says so and offers to show the whole file', async ({ app, page }) => {
  const moved = summary({ files: [file('src/new.ts', { status: 'R', from: 'src/old.ts', added: 0, deleted: 0 })] });
  await bootDiff(app, { since: moved }, { files: { 'src/new.ts': fileDiff('src/new.ts', [], ['kept']) }, editor: changesOnly });
  await rows(page).first().click();
  await expect(fileSentence(page)).toHaveText('Renamed from src/old.ts, with nothing else changed.');
  await expect(fileLift(page)).toHaveText('Show the whole file');
});

test('with whitespace hidden, a rename whose only other change is whitespace offers to show it', async ({ app, page }) => {
  const moved = summary({ files: [file('src/new.ts', { status: 'R', from: 'src/old.ts', added: 1, deleted: 1 })] });
  await bootDiff(app, { since: moved }, { files: { 'src/new.ts': fileDiff('src/new.ts', [], ['kept']) }, editor: { ignoreWs: true, changesOnly: true } });
  await rows(page).first().click();
  await expect(fileSentence(page)).toHaveText('Only whitespace changed here, and whitespace is hidden.');
  await expect(fileLift(page)).toHaveText('Show whitespace changes');
});

test('under Changes only, a file whose mode alone changed says so', async ({ app, page }) => {
  const executable = { ...fileDiff('run.sh', [], ['echo hi']), mode: { from: '100644', to: '100755' } };
  await bootDiff(app, { since: summary({ files: [file('run.sh', { added: 0, deleted: 0 })] }) }, { files: { 'run.sh': executable }, editor: changesOnly });
  await rows(page).first().click();
  await expect(fileSentence(page)).toHaveText('Only the file mode changed, from 100644 to 100755.');
  await expect(fileLift(page)).toHaveText('Show the whole file');
});

test('under Changes only, a rename whose mode changed too says both', async ({ app, page }) => {
  const moved = summary({ files: [file('bin/run', { status: 'R', from: 'run.sh', added: 0, deleted: 0 })] });
  await bootDiff(app, { since: moved }, { files: { 'bin/run': { ...fileDiff('bin/run', [], ['echo hi']), mode: { from: '100644', to: '100755' } } }, editor: changesOnly });
  await rows(page).first().click();
  await expect(fileSentence(page)).toHaveText('Renamed from run.sh, with only the file mode changed, from 100644 to 100755.');
});

test('hiding whitespace reads the file again without it, and is kept for the window', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited } });
  await rows(page).first().click();
  await diffToggle(page, 'Hide whitespace').click();
  await expect.poll(async () => (await app.calls('diffFile')).at(-1)?.[5]).toBe(true);
  await expect.poll(() => keptEditor(app)).toEqual({ docked: false, view: 'fit', ignoreWs: true, changesOnly: false });
});
