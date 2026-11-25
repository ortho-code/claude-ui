import type { Locator, Page } from '@playwright/test';
import type { Exchange } from '../../../../../src/shared/types';
import { HOME, PROJECT } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { goLive } from '../../../support/live';
import { tab } from '../../../support/window';
import { here } from '../../layout/layout';
import { bootDiff, diffLines, diffToggle, editor, editorTabs, file, fileDiff, fileLift, fileNote, fileSentence, rows, sessionFile, summary } from '../explorer/explorer';

// A file a tool call names in the history opens in the Editor: a file of a checkout as a press in the Explorer opens it, any other file with its changes since the session first changed it.

const NOTES = `${HOME}/notes/plan.md`;
const TIME = '2026-11-23T08:00:00.000Z';

/** One request whose reply calls `name` on `path`. */
const called = (name: string, path: string | null, detail = path ?? ''): Exchange[] => [
  { id: 'request-1', time: TIME, request: 'Write the plan', kind: 'typed', replaced: false, rewound: false, parts: [{ kind: 'tool', name, detail, file: path }] },
];

/** Open the history and press the file its one tool call names. */
async function pressToolFile(app: App, page: Page): Promise<void> {
  await goLive(page, app, tab(page, here.title));
  await page.locator('.history-bar').click();
  await page.locator('.exchange-tool-file').click();
}

const mark = (page: Page): Locator => editor(page).locator('.diff-file-mark');
const notice = (page: Page): Locator => editor(page).locator('.diff-file-notice');

test("a file outside every checkout opens from the history with its changes since the session's first edit", async ({ app, page }) => {
  await bootDiff(app, {}, { history: called('Write', NOTES), sessionFiles: { [NOTES]: sessionFile(fileDiff(NOTES, [{ old: 1, new: 1, rows: ['-old line', '+new line'] }], ['new line']), 'recorded') } });
  await pressToolFile(app, page);
  await expect(page.locator('.drawer .editor-view')).toBeVisible();
  await expect(editorTabs(page)).toHaveText(['plan.md']);
  await expect(mark(page)).toHaveText("Since this session's first edit");
  await expect(notice(page)).toBeHidden();
  await expect(diffLines(page).filter({ hasText: 'new line' })).toHaveCount(1);
});

test("where the text before the session's first edit is not recorded, a line says so and the file shows as it is", async ({ app, page }) => {
  await bootDiff(app, {}, { history: called('Edit', NOTES), sessionFiles: { [NOTES]: sessionFile(fileDiff(NOTES, [], ['as it is now']), 'unknown') } });
  await pressToolFile(app, page);
  await expect(notice(page)).toHaveText("The text before this session's first edit is not recorded, so its changes cannot be shown; the file is shown as it is now.");
  await expect(mark(page)).toBeHidden();
  await expect(diffLines(page).filter({ hasText: 'as it is now' })).toHaveCount(1);
});

test('a file the session only read shows as it is, and under Changes only says the session has not changed it', async ({ app, page }) => {
  await bootDiff(app, {}, { history: called('Read', NOTES), sessionFiles: { [NOTES]: sessionFile(fileDiff(NOTES, [], ['read only']), 'unwritten') } });
  await pressToolFile(app, page);
  await expect(diffLines(page).filter({ hasText: 'read only' })).toHaveCount(1);
  await expect(mark(page)).toBeHidden();
  await diffToggle(page, 'Changes only').click();
  await expect(fileSentence(page)).toHaveText('This session has not changed this file.');
  await expect(fileLift(page)).toHaveText('Show the whole file');
});

test('a file no longer on disk says so, with neither a mark nor a line under the header, Changes only or not', async ({ app, page }) => {
  await bootDiff(app, {}, { history: called('Write', NOTES), sessionFiles: { [NOTES]: sessionFile(fileDiff(NOTES, []), 'created', { gone: true }) } });
  await pressToolFile(app, page);
  await expect(fileNote(page)).toHaveText('This file is no longer on disk.');
  await expect(fileNote(page).getByRole('button')).toHaveCount(0);
  await expect(mark(page)).toBeHidden();
  await expect(notice(page)).toBeHidden();
  await diffToggle(page, 'Changes only').click();
  await expect(fileNote(page)).toHaveText('This file is no longer on disk.');
});

test('with whitespace hidden, a file no longer on disk still says so, and one the session only read still says it has not changed it', async ({ app, page }) => {
  const READ = `${HOME}/notes/read.md`;
  const history: Exchange[] = [{ ...called('Write', NOTES)[0], parts: [{ kind: 'tool', name: 'Write', detail: NOTES, file: NOTES }, { kind: 'tool', name: 'Read', detail: READ, file: READ }] }];
  await bootDiff(app, {}, {
    history,
    editor: { ignoreWs: true, changesOnly: true },
    sessionFiles: { [NOTES]: sessionFile(fileDiff(NOTES, []), 'created', { gone: true }), [READ]: sessionFile(fileDiff(READ, [], ['read only']), 'unwritten') },
  });
  await goLive(page, app, tab(page, here.title));
  await page.locator('.history-bar').click();
  await page.locator('.exchange-fold-head').click();
  await page.locator('.exchange-tool-file').nth(0).click();
  await expect(fileNote(page)).toHaveText('This file is no longer on disk.');
  await page.locator('.history-bar').click();
  await page.locator('.exchange-tool-file').nth(1).click();
  await expect(fileSentence(page)).toHaveText('This session has not changed this file.');
  await expect(fileLift(page)).toHaveText('Show the whole file');
});

test('with whitespace hidden, a file the session changed whose only change since is whitespace offers to show it', async ({ app, page }) => {
  await bootDiff(app, {}, { history: called('Edit', NOTES), editor: { ignoreWs: true, changesOnly: true }, sessionFiles: { [NOTES]: sessionFile(fileDiff(NOTES, [], ['spaced']), 'recorded') } });
  await pressToolFile(app, page);
  await expect(fileSentence(page)).toHaveText('Only whitespace changed here, and whitespace is hidden.');
  await expect(fileLift(page)).toHaveText('Show whitespace changes');
});

test('with whitespace hidden, a file the session changed and put back as it was says it has no changes, not that only whitespace changed', async ({ app, page }) => {
  await bootDiff(app, {}, { history: called('Edit', NOTES), editor: { ignoreWs: true, changesOnly: true }, sessionFiles: { [NOTES]: sessionFile(fileDiff(NOTES, [], ['as before']), 'recorded', { identical: true }) } });
  await pressToolFile(app, page);
  await expect(fileSentence(page)).toHaveText("No changes since this session's first edit.");
  await expect(fileLift(page)).toHaveText('Show the whole file');
});

test('a file of a checkout opens from the history in the tab a press on its row in the Explorer opens', async ({ app, page }) => {
  const listed = summary({ files: [file('src/a.ts'), file('src/b.ts')] });
  await bootDiff(app, { since: listed }, { history: called('Edit', `${PROJECT}/src/b.ts`), files: { 'src/b.ts': fileDiff('src/b.ts', [{ old: 1, new: 1, rows: ['+b line'] }], ['b line']) } });
  await pressToolFile(app, page);
  await expect(editorTabs(page)).toHaveText(['b.ts']);
  await expect(diffLines(page).filter({ hasText: 'b line' })).toHaveCount(1);
  await page.locator('.drawer-scrim').click({ position: { x: 5, y: 5 } });
  await rows(page).nth(1).dblclick();
  await expect(editorTabs(page)).toHaveText(['b.ts']);
});

test('a tool call that names no file reads as words, with nothing to press', async ({ app, page }) => {
  await bootDiff(app, {}, { history: called('Bash', null, 'npm test') });
  await goLive(page, app, tab(page, here.title));
  await page.locator('.history-bar').click();
  await expect(page.locator('.exchange-tool')).toHaveText('Bash(npm test)');
  await expect(page.locator('.exchange-tool-file')).toHaveCount(0);
});
