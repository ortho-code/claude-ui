import type { Locator, Page } from '@playwright/test';
import type { Exchange } from '../../../../../src/shared/types';
import { expect, test } from '../../../support/harness';
import { goLive } from '../../../support/live';
import { historyAtTop, tab } from '../../../support/window';
import { here } from '../../layout/layout';
import { bootDiff, editor, editorTabs, file, fileDiff, rows, summary } from '../diff/diff';

// While the drawer over the terminal area is open with both the history and the Editor to show, a rail on its left edge switches between them; what is docked leaves it.

const listed = summary({ files: [file('src/a.ts'), file('src/b.ts')] });
const files = Object.fromEntries(['a', 'b'].map((name) => [`src/${name}.ts`, fileDiff(`src/${name}.ts`, [{ old: 1, new: 1, rows: [`+${name} line`] }], [`${name} line`])]));

/** Enough requests, each with a reply of several lines, that the history scrolls well past one screen. */
const asked: Exchange[] = Array.from({ length: 30 }, (_, n) => ({
  id: `request-${n}`,
  time: '2026-11-18T08:00:00.000Z',
  request: `Request ${n}`,
  kind: 'typed',
  replaced: false,
  rewound: false,
  parts: [{ kind: 'text', id: `reply-${n}`, time: '2026-11-18T08:00:00.000Z', text: Array.from({ length: 6 }, (__, line) => `Reply ${n}, line ${line}.`).join('\n\n') }],
}));

const rail = (page: Page): Locator => page.locator('.drawer > .panel-rail');
const railIcon = (page: Page, name: RegExp): Locator => rail(page).getByRole('button', { name });

/** The history open over the live terminal, then a file opened, which takes the drawer from it. */
async function bothOpen(app: Parameters<typeof bootDiff>[0], page: Page, editorUi?: { docked: boolean }): Promise<void> {
  await bootDiff(app, { since: listed }, { files, history: asked, ...(editorUi ? { editor: editorUi } : {}) });
  await goLive(page, app, tab(page, here.title));
  await page.locator('.history-bar').click();
  await expect(page.locator('.history')).toBeVisible();
  await rows(page).nth(0).click();
}

test('with only a file to show the drawer has no rail', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files });
  await goLive(page, app, tab(page, here.title));
  await rows(page).nth(0).click();
  await expect(page.locator('.drawer .editor-view')).toBeVisible();
  await expect(rail(page)).toBeHidden();
});

test('with the history to show too, the rail lists both, the one on show lit and Files with its count', async ({ app, page }) => {
  await bothOpen(app, page);
  await expect(rail(page)).toBeVisible();
  await expect(rail(page).locator('.rail-item')).toHaveCount(2);
  await expect(railIcon(page, /^Files/)).toHaveAttribute('aria-current', 'true');
  await expect(railIcon(page, /^History$/)).not.toHaveAttribute('aria-current', 'true');
  await expect(railIcon(page, /^Files/).locator('.rail-count')).toHaveText('1');
  await expect(railIcon(page, /^Files/)).toHaveAccessibleName('Files · 1 — click to close');
});

test('a press on the other icon swaps what the drawer shows, and a press on the lit one closes the drawer, giving the keys to claude', async ({ app, page }) => {
  await bothOpen(app, page);
  await railIcon(page, /^History$/).click();
  await expect(page.locator('.history')).toBeVisible();
  await expect(editor(page)).toBeHidden();
  await railIcon(page, /^Files/).click();
  await expect(page.locator('.drawer .editor-view')).toBeVisible();
  await expect(page.locator('.history')).toBeHidden();
  await railIcon(page, /^Files/).click();
  await expect(editor(page)).toBeHidden();
  await expect(rail(page)).toBeHidden();
  await expect(page.locator('.term.active .xterm-helper-textarea')).toBeFocused();
});

test("the rail's count follows the files open", async ({ app, page }) => {
  await bothOpen(app, page);
  await rows(page).nth(0).dblclick();
  await rows(page).nth(1).click();
  await expect(editorTabs(page)).toHaveCount(2);
  await expect(railIcon(page, /^Files/).locator('.rail-count')).toHaveText('2');
});

test('the history comes back from the rail where it was left when a file took the drawer', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files, history: asked });
  await goLive(page, app, tab(page, here.title));
  await page.locator('.history-bar').click();
  await page.keyboard.press('Control+Shift+ArrowUp');
  await page.keyboard.press('Control+Shift+ArrowUp');
  await page.keyboard.press('Control+Shift+ArrowUp');
  const left = await historyAtTop(page);
  expect(left).not.toBe('Request 29');
  await rows(page).nth(0).click();
  await expect(page.locator('.history')).toBeHidden();
  await railIcon(page, /^History$/).click();
  await expect(page.locator('.history')).toBeVisible();
  expect(await historyAtTop(page)).toBe(left);
});

test('the docked Editor leaves the rail, and the history opens alone in the drawer', async ({ app, page }) => {
  await bothOpen(app, page, { docked: true });
  await expect(page.locator('.editor-panel .editor-view')).toBeVisible();
  await expect(page.locator('.history')).toBeVisible();
  await expect(rail(page)).toBeHidden();
});

test("standing for a cold tab, the history closed from its own rail icon opens again at the end, not where it was", async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files, history: asked });
  await page.locator('#term-placeholder').getByRole('button', { name: 'Show history' }).click();
  await expect(page.locator('.history')).toHaveClass(/\bstandalone\b/);
  const end = await historyAtTop(page);
  for (let n = 0; n < 3; n++) await page.keyboard.press('Control+Shift+ArrowUp');
  const left = await historyAtTop(page);
  expect(left).not.toBe(end);
  await rows(page).nth(0).click();
  await railIcon(page, /^History$/).click();
  await expect(page.locator('.history')).toHaveClass(/\bstandalone\b/);
  expect(await historyAtTop(page)).toBe(left);
  await railIcon(page, /^History/).click();
  await expect(page.locator('.history')).toBeHidden();
  await page.locator('#term-placeholder').getByRole('button', { name: 'Show history' }).click();
  expect(await historyAtTop(page)).toBe(end);
});
