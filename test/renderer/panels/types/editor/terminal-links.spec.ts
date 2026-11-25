import type { Page } from '@playwright/test';
import { HOME, PROJECT } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { goLive } from '../../../support/live';
import { tab } from '../../../support/window';
import { here } from '../../layout/layout';
import { bootDiff, editor, editorTabs, file, fileDiff, fileLift, fileSentence, rows, summary } from '../explorer/explorer';

// A file path claude prints in a session tab's terminal opens in the Editor on a press, read from the session's folder, at the line after it; so does a `file://` link claude sends.

/** A file longer than the Editor shows at once, whose one change is at its top, so its line 150 is out of sight, and in a fold under Changes only. */
const changedAtTop = fileDiff(
  'src/b.ts',
  [{ old: 1, new: 1, rows: ['-old first', '+line 1', ' line 2'] }],
  Array.from({ length: 200 }, (_, at) => `line ${at + 1}`),
);
const listed = summary({ files: [file('src/a.ts'), file('src/b.ts')] });

/** Clear claude's screen and print `text` at its top left, where `pressTopLeft` presses. */
async function print(app: App, text: string): Promise<void> {
  expect(await app.emit('onTerminalData', 1, `\x1b[2J\x1b[H${text}`)).toBe(1);
}

/** Point at the first cell of the live terminal, wait for a link there, and press it. */
async function pressTopLeft(page: Page): Promise<void> {
  const screen = (await page.locator('.term.active .xterm-screen').boundingBox())!;
  await page.mouse.move(screen.x + 4, screen.y + 4);
  await page.mouse.move(screen.x + 6, screen.y + 5);
  await expect(page.locator('#tooltip')).toContainText('Open in the Editor');
  await page.mouse.click(screen.x + 6, screen.y + 5);
}

test('a path claude prints, read from the session’s folder, opens in the Editor at the line after it', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/b.ts': changedAtTop }, diskFiles: [`${PROJECT}/src/b.ts`] });
  await goLive(page, app, tab(page, here.title));
  await print(app, 'src/b.ts:150 has it');
  await pressTopLeft(page);
  await expect(editorTabs(page)).toHaveText(['b.ts']);
  await expect(editor(page).locator('[data-line="150"]')).toBeInViewport();
});

test('a path to a file already open with a change brings its line into sight, and the file read again keeps it there', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/b.ts': changedAtTop }, diskFiles: [`${PROJECT}/src/b.ts`] });
  await goLive(page, app, tab(page, here.title));
  await rows(page).nth(1).click();
  await expect(editorTabs(page)).toHaveText(['b.ts']);
  await page.keyboard.press('Escape');
  await expect(editor(page)).toBeHidden();
  const reads = (await app.calls('diffFile')).length;
  await print(app, 'src/b.ts:150');
  await pressTopLeft(page);
  await expect.poll(async () => (await app.calls('diffFile')).length).toBeGreaterThan(reads);
  await expect(editor(page).locator('[data-line="150"]')).toBeInViewport();
});

test('a line inside a fold under Changes only opens that fold', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/b.ts': changedAtTop }, diskFiles: [`${PROJECT}/src/b.ts`], editor: { changesOnly: true } });
  await goLive(page, app, tab(page, here.title));
  await print(app, 'src/b.ts:150');
  await pressTopLeft(page);
  await expect(editor(page).locator('[data-line="150"]')).toBeInViewport();
});

test('with whitespace hidden, a file of a checkout with no change shows whole, at the line asked for', async ({ app, page }) => {
  const unchanged = fileDiff('src/c.ts', [], Array.from({ length: 200 }, (_, at) => `line ${at + 1}`));
  await bootDiff(app, { since: listed }, { files: { 'src/c.ts': unchanged }, diskFiles: [`${PROJECT}/src/c.ts`], editor: { ignoreWs: true } });
  await goLive(page, app, tab(page, here.title));
  await print(app, 'src/c.ts:150');
  await pressTopLeft(page);
  await expect(editorTabs(page)).toHaveText(['c.ts']);
  await expect(editor(page).locator('[data-line="150"]')).toBeInViewport();
});

test('under Changes only with whitespace hidden, a file of a checkout with no change says it has none, not that only whitespace changed', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/c.ts': fileDiff('src/c.ts', [], ['same']) }, diskFiles: [`${PROJECT}/src/c.ts`], editor: { ignoreWs: true, changesOnly: true } });
  await goLive(page, app, tab(page, here.title));
  await print(app, 'src/c.ts:1');
  await pressTopLeft(page);
  await expect(fileSentence(page)).toHaveText('No changes against this base.');
  await expect(fileLift(page)).toHaveText('Show the whole file');
});

test('under Changes only, a file with no change offers to show the whole file, which goes to the line asked for and is kept', async ({ app, page }) => {
  const unchanged = fileDiff('src/c.ts', [], Array.from({ length: 200 }, (_, at) => `line ${at + 1}`));
  await bootDiff(app, { since: listed }, { files: { 'src/c.ts': unchanged }, diskFiles: [`${PROJECT}/src/c.ts`], editor: { changesOnly: true } });
  await goLive(page, app, tab(page, here.title));
  await print(app, 'src/c.ts:150');
  await pressTopLeft(page);
  await expect(fileSentence(page)).toHaveText('No changes against this base.');
  await fileLift(page).click();
  await expect(editor(page).locator('[data-line="150"]')).toBeInViewport();
  await expect.poll(async () => ((await app.calls('setUiState')).at(-1)?.[0] as { editor: { changesOnly: boolean } } | undefined)?.editor.changesOnly).toBe(false);
});

test('with whitespace hidden, a file whose only change is whitespace offers to show it', async ({ app, page }) => {
  const spaced = summary({ files: [file('src/c.ts', { added: 1, deleted: 1 })] });
  await bootDiff(app, { since: spaced }, { files: { 'src/c.ts': fileDiff('src/c.ts', [], ['same']) }, diskFiles: [`${PROJECT}/src/c.ts`], editor: { ignoreWs: true, changesOnly: true } });
  await goLive(page, app, tab(page, here.title));
  await print(app, 'src/c.ts');
  await pressTopLeft(page);
  await expect(fileSentence(page)).toHaveText('Only whitespace changed here, and whitespace is hidden.');
  await expect(fileLift(page)).toHaveText('Show whitespace changes');
  await fileLift(page).click();
  await expect.poll(async () => (await app.calls('diffFile')).at(-1)?.[5]).toBe(false);
});

test('a path claude ends by moving the cursor rather than writing a space is still a link', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/b.ts': changedAtTop }, diskFiles: [`${PROJECT}/src/b.ts`] });
  await goLive(page, app, tab(page, here.title));
  // `ESC [ 1 C` moves the cursor one cell right, leaving that cell empty, as claude does between words.
  await print(app, 'src/b.ts\x1b[1Cis here');
  await pressTopLeft(page);
  await expect(editorTabs(page)).toHaveText(['b.ts']);
});

test('a path that names no file on disk stays words', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { diskFiles: [] });
  await goLive(page, app, tab(page, here.title));
  await print(app, 'src/gone.ts is gone');
  const screen = (await page.locator('.term.active .xterm-screen').boundingBox())!;
  await page.mouse.move(screen.x + 4, screen.y + 4);
  await page.mouse.move(screen.x + 6, screen.y + 5);
  await expect.poll(() => app.calls('resolvePaths')).not.toHaveLength(0);
  await page.mouse.click(screen.x + 6, screen.y + 5);
  await expect(editor(page)).toHaveCount(0);
});

test('a `file://` link claude sends opens its file in the Editor rather than the browser', async ({ app, page }) => {
  const notes = `${HOME}/notes/plan.md`;
  await bootDiff(app, { since: listed }, { sessionFiles: { [notes]: { path: notes, hunks: [], binary: false, lines: ['the plan'], start: 'unwritten', gone: false } } });
  await goLive(page, app, tab(page, here.title));
  expect(await app.emit('onTerminalData', 1, `\x1b[2J\x1b[H\x1b]8;;file://${notes}\x07the plan\x1b]8;;\x07`)).toBe(1);
  const screen = (await page.locator('.term.active .xterm-screen').boundingBox())!;
  await page.mouse.move(screen.x + 4, screen.y + 4);
  await page.mouse.move(screen.x + 6, screen.y + 5);
  await page.mouse.click(screen.x + 6, screen.y + 5);
  await expect(editorTabs(page)).toHaveText(['plan.md']);
  expect(await app.calls('openExternal')).toEqual([]);
});
