import { PROJECT, session } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { tab } from '../../../support/window';
import { here } from '../../layout/layout';
import { bootDiff, editor, editorTabs, file, fileDiff, rows, summary } from '../diff/diff';

// The Editor's tabs: a press opens a preview the next press takes the place of, a double click keeps one, each session tab has its own, and the Editor takes no room once the last closes.

const listed = summary({ files: [file('src/a.ts'), file('src/b.ts'), file('src/c.ts')] });
const files = Object.fromEntries(['a', 'b', 'c'].map((name) => [`src/${name}.ts`, fileDiff(`src/${name}.ts`, [{ old: 1, new: 1, rows: [`+${name} line`] }], [`${name} line`])]));

test('a press opens a preview, in italics, which the next press takes the place of', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files });
  await rows(page).nth(0).click();
  await expect(editorTabs(page)).toHaveText(['a.ts']);
  await expect(editorTabs(page).first()).toHaveClass(/\bpreview\b/);
  expect(await editorTabs(page).first().locator('.tab-label').evaluate((el) => getComputedStyle(el).fontStyle)).toBe('italic');
  await rows(page).nth(1).click();
  await expect(editorTabs(page)).toHaveText(['b.ts']);
});

test('a double click on a row, or on its tab, keeps the file, so the next press opens a tab of its own', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files });
  // The Editor open first, so the double click is not held up by the layout making room for it.
  await rows(page).nth(2).click();
  await expect(editorTabs(page)).toHaveText(['c.ts']);
  await rows(page).nth(0).dblclick();
  await expect(editorTabs(page)).toHaveText(['a.ts']);
  await expect(editorTabs(page).first()).not.toHaveClass(/\bpreview\b/);
  await rows(page).nth(1).click();
  await expect(editorTabs(page)).toHaveText(['a.ts', 'b.ts']);
  await editorTabs(page).nth(1).locator('.tab-label').dblclick();
  await expect(editorTabs(page).nth(1)).not.toHaveClass(/\bpreview\b/);
  await rows(page).nth(2).click();
  await expect(editorTabs(page)).toHaveText(['a.ts', 'b.ts', 'c.ts']);
});

test('closing the last tab gives the Editor’s room back, and the next file opened takes it again at its size', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files });
  await rows(page).nth(0).click();
  const width = (await editor(page).boundingBox())!.width;
  await editorTabs(page).first().locator('.tab-close').click();
  await expect(editor(page)).toHaveCount(0);
  await rows(page).nth(1).click();
  await expect(editorTabs(page)).toHaveText(['b.ts']);
  expect((await editor(page).boundingBox())!.width).toBeCloseTo(width, 0);
});

test('each session tab has its own files in the Editor', async ({ app, page }) => {
  const other = session({ id: '00000000-0000-4000-8000-0000000000e1', title: 'Second here', cwd: PROJECT, repoRoot: PROJECT });
  await bootDiff(app, { since: listed }, { files, also: other });
  await rows(page).nth(0).click();
  await expect(editorTabs(page)).toHaveText(['a.ts']);
  await tab(page, other.title).click();
  await expect(editor(page)).toHaveCount(0);
  await rows(page).nth(1).click();
  await expect(editorTabs(page)).toHaveText(['b.ts']);
  await tab(page, here.title).click();
  await expect(editorTabs(page)).toHaveText(['a.ts']);
});

test('a full-screen Editor whose last tab closes gives the layout back, and does not fill the window again on the next file', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files });
  await rows(page).nth(0).click();
  await page.locator('.panel-group', { has: editor(page) }).getByRole('button', { name: 'Full screen' }).click();
  await expect(page.locator('#sidebar')).toBeHidden();
  await editorTabs(page).first().locator('.tab-close').click();
  await expect(page.locator('#sidebar')).toBeVisible();
  await rows(page).nth(1).click();
  await expect(editorTabs(page)).toHaveText(['b.ts']);
  await expect(page.locator('#sidebar')).toBeVisible();
});
