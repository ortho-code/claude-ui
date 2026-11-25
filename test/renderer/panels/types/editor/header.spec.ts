import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../../../support/harness';
import { bootDiff, diffToggle, editor, file, fileDiff, menuRows, position, rows, summary } from '../explorer/explorer';

// The diff header: the file on a row of its own, under it the view's menu, the two switches and the stepper.

const edited = fileDiff('src/a.ts', [{ old: 1, new: 1, rows: ['-old', '+new'] }], ['new']);
const listed = summary({ files: [file('src/a.ts', { added: 1, deleted: 1 }), file('src/b.ts')] });

const header = (page: Page): Locator => editor(page).locator('.diff-file-header');
/** Give the header a width of its own, the Editor's layout aside, as the Editor's panel would at that width. */
const setHeaderWidth = async (page: Page, width: number): Promise<void> => {
  await header(page).evaluate((element, px) => {
    element.style.width = `${px}px`;
  }, width);
};
const box = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
  const found = await locator.boundingBox();
  if (!found) throw new Error('not on screen');
  return found;
};

test('the view menu offers only the three views, the two switches standing beside it', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited } });
  await rows(page).first().click();
  await editor(page).locator('.diff-view-button').click();
  await expect(menuRows(page)).toHaveText(['Fit', 'Split', 'Unified']);
  await expect(diffToggle(page, 'Hide whitespace')).toBeVisible();
  await expect(diffToggle(page, 'Changes only')).toBeVisible();
});

test('each switch shows whether it is on, as kept for the window and as pressed', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited }, editor: { ignoreWs: true } });
  await rows(page).first().click();
  await expect(diffToggle(page, 'Hide whitespace')).toHaveAttribute('aria-pressed', 'true');
  await expect(diffToggle(page, 'Hide whitespace')).toHaveClass(/active/);
  await expect(diffToggle(page, 'Changes only')).toHaveAttribute('aria-pressed', 'false');
  await expect(diffToggle(page, 'Changes only')).not.toHaveClass(/active/);
  await diffToggle(page, 'Changes only').click();
  await expect(diffToggle(page, 'Changes only')).toHaveAttribute('aria-pressed', 'true');
  await diffToggle(page, 'Hide whitespace').click();
  await expect(diffToggle(page, 'Hide whitespace')).toHaveAttribute('aria-pressed', 'false');
});

test('the file has the first row to itself, and in a wide header the controls and the stepper in words share the second', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited }, editor: { docked: true } });
  await rows(page).first().click();
  await setHeaderWidth(page, 560);
  const path = await box(editor(page).locator('.diff-file-path'));
  const view = await box(editor(page).locator('.diff-view-button'));
  const steps = await box(editor(page).locator('.diff-steps'));
  expect(view.y).toBeGreaterThanOrEqual(path.y + path.height);
  expect(Math.abs(steps.y + steps.height / 2 - (view.y + view.height / 2))).toBeLessThan(2);
  await expect(position(page)).toBeVisible();
  await expect(position(page)).toHaveText('change 1 of 1 · file 1 of 2');
});

test('in a narrow header the position turns to numbers, and the stepper wraps onto a row of its own at the right, the switches keeping their words', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files: { 'src/a.ts': edited }, editor: { docked: true } });
  await rows(page).first().click();
  await setHeaderWidth(page, 320);
  const short = editor(page).locator('.diff-position-short');
  await expect(short).toBeVisible();
  await expect(short).toHaveText('1/1 · 1/2');
  await expect(position(page)).toBeHidden();
  await expect(editor(page).locator('.diff-position')).toHaveAttribute('title', 'change 1 of 1 · file 1 of 2');
  const headerBox = await box(header(page));
  const changesOnly = await box(diffToggle(page, 'Changes only'));
  const steps = await box(editor(page).locator('.diff-steps'));
  expect(steps.y).toBeGreaterThanOrEqual(changesOnly.y + changesOnly.height);
  expect(steps.x + steps.width).toBeGreaterThan(headerBox.x + headerBox.width - 16);
  await expect(diffToggle(page, 'Changes only')).toHaveText('Changes only');
  await expect(diffToggle(page, 'Hide whitespace')).toHaveText('Hide whitespace');
});
