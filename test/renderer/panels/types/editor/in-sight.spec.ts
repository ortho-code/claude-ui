import type { Page } from '@playwright/test';
import { PROJECT } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { goLive } from '../../../support/live';
import { tab } from '../../../support/window';
import { here, railItem } from '../../layout/layout';
import { bootDiff, diffLines, editor, editorPanel, file, fileDiff, panel, rows, summary } from '../explorer/explorer';

// Opening a file puts the Editor in sight, docked or in the drawer.

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
