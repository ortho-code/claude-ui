import type { Page } from '@playwright/test';
import type { Exchange } from '../../../../../src/shared/types';
import { PROJECT, session } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { goLive } from '../../../support/live';
import { tab } from '../../../support/window';
import { here } from '../../layout/layout';
import { bootDiff, editor, editorPanel, editorTabs, file, fileDiff, menuRows, rows, summary } from '../diff/diff';

// The Editor opens as a drawer over the terminal area, so the terminal keeps its width; Dock puts it beside the terminal and Undock back, kept for the window; it and the history take turns in the drawer.

const listed = summary({ files: [file('src/a.ts'), file('src/b.ts'), file('src/c.ts')] });
const files = Object.fromEntries(['a', 'b', 'c'].map((name) => [`src/${name}.ts`, fileDiff(`src/${name}.ts`, [{ old: 1, new: 1, rows: [`+${name} line`] }], [`${name} line`])]));

/** One request with a reply, so the history has something to open on. */
const asked: Exchange[] = [{ id: 'request-1', time: '2026-11-18T08:00:00.000Z', request: 'Show me the change', kind: 'typed', replaced: false, rewound: false, parts: [{ kind: 'text', id: 'reply-1', time: '2026-11-18T08:00:00.000Z', text: 'Here it is.' }] }];

const terminalWidth = async (page: Page): Promise<number> => (await page.locator('#terminals').boundingBox())!.width;
/** What the window last kept of the Editor. */
const keptEditor = async (app: App): Promise<unknown> => ((await app.calls('setUiState')).at(-1)?.[0] as { editor: unknown } | undefined)?.editor;

test('a file opens the Editor as a drawer over the terminal, which keeps its width, and a press on claude closes it', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files });
  await goLive(page, app, tab(page, here.title));
  const width = await terminalWidth(page);
  await rows(page).nth(0).click();
  await expect(page.locator('.drawer .editor-view')).toBeVisible();
  await expect(editorPanel(page)).toHaveCount(0);
  expect(await terminalWidth(page)).toBe(width);
  await page.locator('.drawer-scrim').click({ position: { x: 5, y: 5 } });
  await expect(editor(page)).toHaveCount(0);
});

test('Dock puts the Editor beside the terminal and Undock back in the drawer, kept for the window', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files });
  await rows(page).nth(0).click();
  await editor(page).getByRole('button', { name: 'Dock' }).click();
  await expect(editorPanel(page).locator('.editor-view')).toBeVisible();
  await expect(page.locator('.drawer .editor-view')).toHaveCount(0);
  await expect.poll(() => keptEditor(app)).toMatchObject({ docked: true });
  await editor(page).getByRole('button', { name: 'Undock' }).click();
  await expect(page.locator('.drawer .editor-view')).toBeVisible();
  await expect.poll(() => keptEditor(app)).toMatchObject({ docked: false });
});

test('docked where the app added it, the Editor takes about two-thirds of what it shares with the terminal', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files, editor: { docked: true }, width: null });
  await rows(page).nth(0).click();
  const docked = (await editorPanel(page).boundingBox())!.width;
  const terminal = await terminalWidth(page);
  expect(docked / (docked + terminal)).toBeGreaterThan(0.6);
  expect(docked / (docked + terminal)).toBeLessThan(0.72);
});

test('the Editor and the history take turns in the drawer', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files, history: asked });
  await goLive(page, app, tab(page, here.title));
  await rows(page).nth(0).click();
  await expect(page.locator('.drawer .editor-view')).toBeVisible();
  await page.locator('.history-bar').click();
  await expect(page.locator('.history')).toBeVisible();
  await expect(editor(page)).toHaveCount(0);
  await rows(page).nth(1).click();
  await expect(page.locator('.drawer .editor-view')).toBeVisible();
  await expect(page.locator('.history')).toBeHidden();
});

test('with the Editor docked, the history opens over the terminal only, and the file stays in view', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files, editor: { docked: true }, history: asked });
  await goLive(page, app, tab(page, here.title));
  await rows(page).nth(0).click();
  await page.locator('.history-bar').click();
  await expect(page.locator('.history')).toBeVisible();
  await expect(editorPanel(page).locator('.editor-view')).toBeVisible();
});

test('a switch of session tabs closes the drawer', async ({ app, page }) => {
  const other = session({ id: '00000000-0000-4000-8000-0000000000e2', title: 'Second here', cwd: PROJECT, repoRoot: PROJECT });
  await bootDiff(app, { since: listed }, { files, also: other });
  await rows(page).nth(0).click();
  await expect(page.locator('.drawer .editor-view')).toBeVisible();
  await tab(page, other.title).click();
  await expect(editor(page)).toHaveCount(0);
});

test("a tab's menu holds Pin on a preview, Copy path, Close other tabs and Close, and each does what it says", async ({ app, page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await bootDiff(app, { since: listed }, { files });
  await rows(page).nth(2).click();
  await rows(page).nth(0).dblclick();
  await rows(page).nth(1).click();
  await expect(editorTabs(page)).toHaveText(['a.ts', 'b.ts']);
  await editorTabs(page).nth(1).click({ button: 'right' });
  await expect(menuRows(page)).toHaveText(['Pin', 'Copy path', 'Close other tabs', 'Close']);
  await menuRows(page).filter({ hasText: 'Pin' }).click();
  await expect(editorTabs(page).nth(1)).not.toHaveClass(/\bpreview\b/);

  await editorTabs(page).nth(1).click({ button: 'right' });
  await expect(menuRows(page)).toHaveText(['Copy path', 'Close other tabs', 'Close']);
  await menuRows(page).filter({ hasText: 'Copy path' }).click();
  await expect(page.locator('#toast-message')).toHaveText('Path copied.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/src\/b\.ts$/);

  await editorTabs(page).nth(1).click({ button: 'right' });
  await menuRows(page).filter({ hasText: 'Close other tabs' }).click();
  await expect(editorTabs(page)).toHaveText(['b.ts']);
  await editorTabs(page).nth(0).click({ button: 'right' });
  await expect(menuRows(page)).toHaveText(['Copy path', 'Close']);
  await menuRows(page).filter({ hasText: /^Close$/ }).click();
  await expect(editor(page)).toHaveCount(0);
});

test('opening the drawer gives the file the keys, and Esc closes it, giving them back to claude', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files });
  await goLive(page, app, tab(page, here.title));
  await rows(page).nth(0).click();
  await expect(editor(page).locator('.diff-hunks')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator('.term.active .xterm-helper-textarea')).toBeFocused();
});

test('the Editor taking the drawer from the history keeps the keys, where closing the history would give them to claude', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files, history: asked });
  await goLive(page, app, tab(page, here.title));
  await page.locator('.history-bar').click();
  await expect(page.locator('.history')).toBeVisible();
  await rows(page).nth(0).click();
  await expect(editor(page).locator('.diff-hunks')).toBeFocused();
});

test('the Editor taking the drawer from a history standing in for a cold tab closes it for good, so it does not come back on its own', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files, history: asked });
  await page.locator('#term-placeholder').getByRole('button', { name: 'Show history' }).click();
  await expect(page.locator('.history')).toHaveClass(/\bstandalone\b/);
  await rows(page).nth(0).click();
  await expect(page.locator('.drawer .editor-view')).toBeVisible();
  await expect(page.locator('.history')).not.toHaveClass(/\bstandalone\b/);
  await expect(page.locator('.history-note')).toBeHidden();
});
