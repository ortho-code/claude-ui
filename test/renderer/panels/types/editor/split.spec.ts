import type { Locator, Page } from '@playwright/test';
import type { SessionSummary } from '../../../../../src/shared/types';
import { PROJECT, session } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { tab } from '../../../support/window';
import { here } from '../../layout/layout';
import { bootDiff, editor, editorTabs, file, fileDiff, menuRows, rows, summary } from '../explorer/explorer';

// The Editor split side by side: a tab moved to the other side from its menu or dragged into the other row, a file opening on the side last pressed, a divider sharing the width, and a side whose last tab closes giving its room back.

const names = ['a', 'b', 'c'];
const listed = summary({ files: names.map((name) => file(`src/${name}.ts`)) });
const files = Object.fromEntries(names.map((name) => [`src/${name}.ts`, fileDiff(`src/${name}.ts`, [{ old: 1, new: 1, rows: [`+${name} line`] }], [`${name} line`])]));

const sides = (page: Page): Locator => editor(page).locator('.editor-group');
/** A side's tabs, without the copy that follows the pointer during a drag, which the library places in the row the drag started in. */
const sideTabs = (page: Page, side: number): Locator => sides(page).nth(side).locator('.panel-tabs .tab:not(.sortable-fallback)');
const divider = (page: Page): Locator => editor(page).locator('.editor-divider');

/** Open a.ts and b.ts, both kept, docked, b.ts on show. */
async function twoKept(app: Parameters<typeof bootDiff>[0], page: Page, also?: SessionSummary): Promise<void> {
  await bootDiff(app, { since: listed }, { files, editor: { docked: true }, ...(also ? { also } : {}) });
  await rows(page).nth(0).dblclick();
  await rows(page).nth(1).dblclick();
  await expect(editorTabs(page)).toHaveText(['a.ts', 'b.ts']);
}

/** As `twoKept`, in a window wide enough for a docked Editor of 900px, whose sides have room for their 280px floor and more. */
async function twoKeptWide(app: Parameters<typeof bootDiff>[0], page: Page, also?: SessionSummary): Promise<void> {
  await page.setViewportSize({ width: 1800, height: 800 });
  await bootDiff(app, { since: listed }, { files, editor: { docked: true }, width: '900px', ...(also ? { also } : {}) });
  await rows(page).nth(0).dblclick();
  await rows(page).nth(1).dblclick();
  await expect(editorTabs(page)).toHaveText(['a.ts', 'b.ts']);
}

/** Move the tab `name` to the other side from its menu. */
async function moveAcross(page: Page, name: string): Promise<void> {
  await editorTabs(page).filter({ hasText: name }).click({ button: 'right' });
  await menuRows(page).filter({ hasText: 'Move to the other side' }).click();
}

test('Move to the other side splits the Editor, the moved file on show on the right, which is last pressed and holds the Editor’s buttons', async ({ app, page }) => {
  await twoKept(app, page);
  await expect(sides(page)).toHaveCount(1);
  await expect(divider(page)).toHaveCount(0);
  await moveAcross(page, 'b.ts');
  await expect(sides(page)).toHaveCount(2);
  await expect(sideTabs(page, 0)).toHaveText(['a.ts']);
  await expect(sideTabs(page, 1)).toHaveText(['b.ts']);
  await expect(divider(page)).toBeVisible();
  await expect(sides(page).nth(1)).toHaveClass(/\bfocused\b/);
  await expect(sides(page).nth(0)).not.toHaveClass(/\bfocused\b/);
  // The accent edge marks the tab on show on the side last pressed only.
  const edge = (side: number): Promise<string> => sideTabs(page, side).first().evaluate((el) => getComputedStyle(el).boxShadow);
  expect(await edge(0)).not.toBe(await edge(1));
  await expect(sides(page).nth(1).getByRole('button', { name: 'Close all files' })).toBeVisible();
  await expect(sides(page).nth(0).getByRole('button', { name: 'Close all files' })).toHaveCount(0);
  await expect(sides(page).nth(0).locator('.diff-file-path')).toContainText('a.ts');
  await expect(sides(page).nth(1).locator('.diff-file-path')).toContainText('b.ts');
});

test('in the drawer the two sides stand side by side too', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files });
  await rows(page).nth(0).dblclick();
  await rows(page).nth(1).dblclick();
  await expect(page.locator('.drawer .editor-view')).toBeVisible();
  await moveAcross(page, 'b.ts');
  await expect(sides(page)).toHaveCount(2);
  const left = (await sides(page).nth(0).boundingBox())!;
  const right = (await sides(page).nth(1).boundingBox())!;
  expect(right.y).toBe(left.y);
  expect(right.x).toBeGreaterThan(left.x + left.width - 1);
});

test('a tab alone in an Editor that is not split offers no move', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files, editor: { docked: true } });
  await rows(page).nth(0).click();
  await editorTabs(page).first().click({ button: 'right' });
  await expect(menuRows(page).filter({ hasText: 'Copy path' })).toBeVisible();
  await expect(menuRows(page).filter({ hasText: 'Move to the other side' })).toHaveCount(0);
});

test('a file opens on the side last pressed, and the Explorer marks the file on show there', async ({ app, page }) => {
  await twoKept(app, page);
  await moveAcross(page, 'b.ts');
  await rows(page).nth(2).click();
  await expect(sideTabs(page, 1)).toHaveText(['b.ts', 'c.ts']);
  await expect(rows(page).nth(2)).toHaveAttribute('aria-current', 'true');
  await sides(page).nth(0).locator('.editor-body').click();
  await expect(sides(page).nth(0)).toHaveClass(/\bfocused\b/);
  await expect(rows(page).nth(0)).toHaveAttribute('aria-current', 'true');
  // The keys moving to the other side's file, as Tab moves them, make that side the one last pressed too.
  await sides(page).nth(1).locator('.diff-hunks').focus();
  await expect(sides(page).nth(1)).toHaveClass(/\bfocused\b/);
  await expect(rows(page).nth(2)).toHaveAttribute('aria-current', 'true');
  await sides(page).nth(0).locator('.editor-body').click();
  await rows(page).nth(1).click();
  // b.ts has its tab on the right already, so it is put on show there, and that side is last pressed again.
  await expect(sideTabs(page, 0)).toHaveText(['a.ts']);
  await expect(sides(page).nth(1)).toHaveClass(/\bfocused\b/);
});

test('a side whose last tab closes goes, and the other takes its room', async ({ app, page }) => {
  await twoKept(app, page);
  const whole = (await editor(page).boundingBox())!.width;
  await moveAcross(page, 'b.ts');
  await sideTabs(page, 1).first().locator('.tab-close').click();
  await expect(sides(page)).toHaveCount(1);
  await expect(divider(page)).toHaveCount(0);
  await expect(editorTabs(page)).toHaveText(['a.ts']);
  expect((await sides(page).first().boundingBox())!.width).toBeCloseTo(whole, 0);
  await expect(editor(page).getByRole('button', { name: 'Close all files' })).toBeVisible();
});

test('Close all files closes both sides, pressed while the other side was last pressed too', async ({ app, page }) => {
  await twoKept(app, page);
  await moveAcross(page, 'b.ts');
  await sides(page).nth(0).locator('.editor-body').click();
  await expect(sides(page).nth(0)).toHaveClass(/\bfocused\b/);
  await sides(page).nth(1).getByRole('button', { name: 'Close all files' }).click();
  await expect(editorTabs(page)).toHaveCount(0);
});

test('a tab dragged into the other side’s row moves there, where it was dropped', async ({ app, page }) => {
  await twoKept(app, page);
  await rows(page).nth(2).dblclick();
  await moveAcross(page, 'c.ts');
  await expect(sideTabs(page, 0)).toHaveText(['a.ts', 'b.ts']);
  // By its label: a short tab's middle is its kebab, which never starts a drag.
  const from = (await sideTabs(page, 0).nth(0).locator('.tab-label').boundingBox())!;
  const to = (await sideTabs(page, 1).nth(0).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 12 });
  // The library looks for the row under the pointer on a timer, so the drop waits until it has carried the tab there.
  await expect(sideTabs(page, 1)).toHaveText(['a.ts', 'c.ts']);
  await page.mouse.up();
  await expect(sideTabs(page, 0)).toHaveText(['b.ts']);
  await expect(sideTabs(page, 1)).toHaveText(['a.ts', 'c.ts']);
  // Moved in what is open, not only on screen: the right side shows it, and the left the one it left behind.
  await expect(sides(page).nth(1).locator('.diff-file-path')).toContainText('a.ts');
  await expect(sides(page).nth(0).locator('.diff-file-path')).toContainText('b.ts');
  await expect(page.locator('.tab-ghost')).toHaveCount(0);
});

test('a tab dragged across lands where it was dropped though the tabs change during the drag', async ({ app, page }) => {
  await page.clock.install();
  await bootDiff(app, { since: listed }, { files, editor: { docked: true }, tree: 'clean' });
  // Kept from the menu rather than by a double click, which the installed clock can split into two presses.
  for (const name of ['a.ts', 'b.ts', 'c.ts']) {
    await rows(page).filter({ hasText: name }).click();
    await editorTabs(page).filter({ hasText: name }).click({ button: 'right' });
    await menuRows(page).filter({ hasText: 'Pin' }).click();
    await expect(editorTabs(page).filter({ hasText: name })).not.toHaveClass(/\bpreview\b/);
  }
  await moveAcross(page, 'c.ts');
  await expect(sideTabs(page, 1)).toHaveText(['c.ts']);
  await expect(sideTabs(page, 0)).toHaveText(['a.ts', 'b.ts']);
  // Hovered through the locator, which waits for the label to stand still, so the press lands on a.ts however late the row settles.
  await sideTabs(page, 0).nth(0).locator('.tab-label').hover();
  const to = (await sideTabs(page, 1).nth(0).boundingBox())!;
  await page.mouse.down();
  await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 12 });
  await expect.poll(async () => {
    await page.clock.runFor(60);
    return sideTabs(page, 1).allTextContents();
  }).toEqual(['a.ts', 'c.ts']);
  // The checkout moves on while the tab is held over the other row, so c.ts, on show there, is read again against the newer commit and its tab changes.
  const reads = (await app.calls('diffFile')).length;
  await page.evaluate(([dir, now]) => {
    window.__claudeUiFixture.diffs[dir].since = now;
    window.__claudeUiFixture.trees[dir] = 'committed';
  }, [PROJECT, summary({ against: 'bbbbbbb', files: listed.files })] as const);
  await page.clock.fastForward(30_000);
  await page.clock.fastForward(30_000);
  await expect.poll(async () => (await app.calls('diffFile')).length).toBeGreaterThan(reads);
  await page.mouse.up();
  await expect(sideTabs(page, 1)).toHaveText(['a.ts', 'c.ts']);
  await expect(sideTabs(page, 0)).toHaveText(['b.ts']);
});

test('the divider shares the width, kept with the split for its session tab, and a double click makes the sides even', async ({ app, page }) => {
  const other = session({ id: '00000000-0000-4000-8000-0000000000e2', title: 'Second here', cwd: PROJECT, repoRoot: PROJECT });
  await twoKeptWide(app, page, other);
  await moveAcross(page, 'b.ts');
  const even = (await sides(page).nth(0).boundingBox())!.width;
  expect((await sides(page).nth(1).boundingBox())!.width).toBeCloseTo(even, -1);
  const handle = (await divider(page).boundingBox())!;
  await page.mouse.move(handle.x + 2, handle.y + 60);
  await page.mouse.down();
  await page.mouse.move(handle.x + 32, handle.y + 60, { steps: 4 });
  await page.mouse.up();
  const dragged = (await sides(page).nth(0).boundingBox())!.width;
  expect(dragged).toBeCloseTo(even + 30, -1);
  await tab(page, other.title).click();
  await tab(page, here.title).click();
  await expect(sides(page)).toHaveCount(2);
  expect((await sides(page).nth(0).boundingBox())!.width).toBeCloseTo(dragged, 0);
  await divider(page).dblclick();
  await expect.poll(async () => (await sides(page).nth(0).boundingBox())!.width).toBeCloseTo(even, 0);
});

test('a side keeps at least 280px when the Editor narrows after a drag that made the other wide', async ({ app, page }) => {
  await twoKeptWide(app, page);
  await moveAcross(page, 'b.ts');
  await editor(page).getByRole('button', { name: 'Full screen' }).click();
  await expect(page.locator('#sidebar')).toBeHidden();
  const handle = (await divider(page).boundingBox())!;
  await page.mouse.move(handle.x + 2, handle.y + 60);
  await page.mouse.down();
  await page.mouse.move(handle.x + 400, handle.y + 60, { steps: 4 });
  await page.mouse.up();
  await editor(page).getByRole('button', { name: 'Back to the layout' }).click();
  await expect(page.locator('#sidebar')).toBeVisible();
  expect((await sides(page).nth(1).boundingBox())!.width).toBeGreaterThanOrEqual(279);
});

test('at its narrowest a side’s head fits its tab and the Editor’s buttons, the tab’s name giving way', async ({ app, page }) => {
  // A name long enough for its tab to reach the cap on a tab's width.
  const long = 'src/scienta-error-content.helper.ts';
  const longFiles = { ...files, [long]: fileDiff(long, [{ old: 1, new: 1, rows: ['+long line'] }], ['long line']) };
  await bootDiff(app, { since: summary({ files: [file('src/a.ts'), file(long)] }) }, { files: longFiles, editor: { docked: true } });
  await rows(page).nth(0).dblclick();
  await rows(page).nth(1).dblclick();
  await expect(editorTabs(page)).toHaveText(['a.ts', 'scienta-error-content.helper.ts']);
  await moveAcross(page, 'scienta-error-content.helper.ts');
  await editor(page).getByRole('button', { name: 'Full screen' }).click();
  await expect(page.locator('#sidebar')).toBeHidden();
  const handle = (await divider(page).boundingBox())!;
  await page.mouse.move(handle.x + 2, handle.y + 60);
  await page.mouse.down();
  await page.mouse.move(handle.x + 1200, handle.y + 60, { steps: 4 });
  await page.mouse.up();
  const side = (await sides(page).nth(1).boundingBox())!;
  const tabBox = (await sideTabs(page, 1).first().boundingBox())!;
  for (const name of ['Undock', 'Back to the layout', 'Close all files']) {
    const button = (await sides(page).nth(1).getByRole('button', { name }).boundingBox())!;
    expect(button.x).toBeGreaterThanOrEqual(tabBox.x + tabBox.width - 1);
    expect(button.x + button.width).toBeLessThanOrEqual(side.x + side.width + 1);
  }
  expect(tabBox.x + tabBox.width).toBeLessThanOrEqual(side.x + side.width + 1);
});

test('Fit measures each side on its own: a side narrowed under 600px draws unified while the other stays split', async ({ app, page }) => {
  await twoKept(app, page);
  await moveAcross(page, 'b.ts');
  // Full screen pressed while the other side was last pressed, so the press itself moves which side that is.
  await sides(page).nth(0).locator('.editor-body').click();
  await editor(page).getByRole('button', { name: 'Full screen' }).click();
  await expect(page.locator('#sidebar')).toBeHidden();
  const hunks = (side: number): Locator => sides(page).nth(side).locator('.diff-hunks');
  await expect(hunks(0)).toHaveClass(/split/);
  await expect(hunks(1)).toHaveClass(/split/);
  const handle = (await divider(page).boundingBox())!;
  await page.mouse.move(handle.x + 2, handle.y + 60);
  await page.mouse.down();
  await page.mouse.move(handle.x + 202, handle.y + 60, { steps: 4 });
  await page.mouse.up();
  await expect(hunks(0)).toHaveClass(/split/);
  await expect(hunks(1)).not.toHaveClass(/split/);
});
