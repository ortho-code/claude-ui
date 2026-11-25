import type { Page } from '@playwright/test';
import type { Exchange } from '../../../../../src/shared/types';
import { PROJECT } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { goLive } from '../../../support/live';
import { tab } from '../../../support/window';
import { here, railItem } from '../../layout/layout';
import { bootDiff, diffLines, editor, editorPanel, file, fileDiff, fileSentence, panel, rows, summary } from '../explorer/explorer';

// Opening a file puts the docked Editor in sight, and a line asked for is brought into sight only where it can be seen, waiting while the Editor is out of sight.

const POLL = 30_000;
const lines = Array.from({ length: 200 }, (_, at) => `line ${at + 1}`);
const unchanged = fileDiff('src/c.ts', [], lines);
const listed = summary({ files: [file('src/a.ts'), file('src/c.ts', { added: 0, deleted: 0 })] });
const docked = { docked: true };

/** Clear claude's screen, print `text` at its top left, and press it as a link. */
async function pressPrinted(app: App, page: Page, text: string): Promise<void> {
  expect(await app.emit('onTerminalData', 1, `\x1b[2J\x1b[H${text}`)).toBe(1);
  const screen = (await page.locator('.term.active .xterm-screen').boundingBox())!;
  await page.mouse.move(screen.x + 4, screen.y + 4);
  await page.mouse.move(screen.x + 6, screen.y + 5);
  await expect(page.locator('#tooltip')).toContainText('Open in the Editor');
  await page.mouse.click(screen.x + 6, screen.y + 5);
}

/** `src/c.ts` gains a change on disk, at its top, and the Editor reads it again, drawing its lines while it is out of sight. */
async function changeOnDisk(app: App, page: Page): Promise<void> {
  await page.evaluate(([dir, now, edited]) => {
    window.__claudeUiFixture.diffs[dir].since = now;
    window.__claudeUiFixture.fileDiffs[dir]['src/c.ts'] = edited;
    window.__claudeUiFixture.trees[dir] = 'edited';
  }, [PROJECT, summary({ files: [file('src/a.ts'), file('src/c.ts')] }), fileDiff('src/c.ts', [{ old: 1, new: 1, rows: ['-old first', '+line 1'] }], lines)] as const);
  await page.clock.fastForward(POLL);
  await page.clock.fastForward(POLL);
  await expect.poll(async () => (await app.calls('diffFile')).filter((call) => call[2] === 'src/c.ts').length).toBeGreaterThan(1);
}

test('a file pressed in the Explorer brings the docked Editor in front of it in their group', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': fileDiff('src/a.ts', [{ old: 1, new: 1, rows: ['+a line'] }], ['a line']) }, editor: docked, together: true });
  await expect(railItem(page, /^Changes/)).toHaveClass(/\bshown\b/);
  await rows(page).first().click();
  await expect(railItem(page, /^Files/)).toHaveClass(/\bshown\b/);
  await expect(diffLines(page).filter({ hasText: 'a line' })).toBeVisible();
});

test('a file pressed in a full-screen Explorer leaves full screen, so the docked Editor shows it', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': fileDiff('src/a.ts', [{ old: 1, new: 1, rows: ['+a line'] }], ['a line']) }, editor: docked });
  await page.locator('.panel-content', { has: panel(page) }).getByRole('button', { name: 'Full screen' }).click();
  await expect(editorPanel(page)).toBeHidden();
  await rows(page).first().click();
  await expect(diffLines(page).filter({ hasText: 'a line' })).toBeVisible();
});

test('a file pressed in a full-screen Explorer leaves full screen, so the drawer it opens in is in sight', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': fileDiff('src/a.ts', [{ old: 1, new: 1, rows: ['+a line'] }], ['a line']) } });
  await page.locator('.panel-content', { has: panel(page) }).getByRole('button', { name: 'Full screen' }).click();
  await expect(page.locator('#terminal-pane')).toBeHidden();
  await rows(page).first().click();
  await expect(page.locator('.drawer .editor-view')).toBeVisible();
  await expect(diffLines(page).filter({ hasText: 'a line' })).toBeVisible();
});

test('a path claude prints brings the docked Editor in front, at the line asked for', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/c.ts': unchanged }, diskFiles: [`${PROJECT}/src/c.ts`], editor: docked, together: true });
  await goLive(page, app, tab(page, here.title));
  await pressPrinted(app, page, 'src/c.ts:150');
  await expect(railItem(page, /^Files/)).toHaveClass(/\bshown\b/);
  await expect(editor(page).locator('[data-line="150"]')).toBeInViewport();
});

test('a line asked for waits while the drawer is closed, and is brought into sight when it opens again', async ({ app, page }) => {
  await page.clock.install();
  const history: Exchange[] = [{ id: 'request-1', time: '2026-11-23T08:00:00.000Z', request: 'Look at c.ts', kind: 'typed', replaced: false, rewound: false, parts: [] }];
  await bootDiff(app, { since: listed }, { files: { 'src/c.ts': unchanged }, diskFiles: [`${PROJECT}/src/c.ts`], editor: { changesOnly: true }, tree: 'clean', history });
  await goLive(page, app, tab(page, here.title));
  await pressPrinted(app, page, 'src/c.ts:150');
  await expect(fileSentence(page)).toHaveText('No changes against this base.');
  await page.locator('.drawer-scrim').click({ position: { x: 5, y: 5 } });
  await expect(editor(page)).toBeHidden();
  await changeOnDisk(app, page);

  // The history opens the drawer with its rail, which lists the files too.
  await page.locator('.history-bar').click();
  await page.locator('.drawer .panel-rail').getByRole('button', { name: /^Files/ }).click();
  await expect(editor(page).locator('[data-line="150"]')).toBeInViewport();
});

test('a line asked for a file whose sentence offers nothing to switch off is dropped, not taken by a later draw', async ({ app, page }) => {
  await page.clock.install();
  await bootDiff(app, { since: listed }, { files: { 'src/c.ts': fileDiff('src/c.ts', [], null) }, diskFiles: [`${PROJECT}/src/c.ts`], editor: { changesOnly: true }, tree: 'clean' });
  await goLive(page, app, tab(page, here.title));
  await pressPrinted(app, page, 'src/c.ts:150');
  await expect(fileSentence(page)).toHaveCount(0);
  await expect(editor(page).locator('.diff-file-note')).toHaveText('No changes against this base.');
  await changeOnDisk(app, page);
  await expect(editor(page).locator('.diff-fold').first()).toBeVisible();
  await expect(editor(page).locator('[data-line="150"]')).toHaveCount(0);
});

test('a line asked for waits while the docked Editor is behind another panel, and is brought into sight when it is in front again', async ({ app, page }) => {
  await page.clock.install();
  await bootDiff(app, { since: listed }, { files: { 'src/c.ts': unchanged }, diskFiles: [`${PROJECT}/src/c.ts`], editor: { docked: true, changesOnly: true }, together: true, tree: 'clean' });
  await goLive(page, app, tab(page, here.title));
  await pressPrinted(app, page, 'src/c.ts:150');
  await expect(fileSentence(page)).toHaveText('No changes against this base.');
  await railItem(page, /^Changes/).click();
  await expect(editorPanel(page)).toBeHidden();
  await changeOnDisk(app, page);

  await railItem(page, /^Files/).click();
  await expect(editor(page).locator('[data-line="150"]')).toBeInViewport();
});
