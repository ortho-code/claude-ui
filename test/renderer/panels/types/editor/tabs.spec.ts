import { PROJECT, session } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { tab } from '../../../support/window';
import { here } from '../../layout/layout';
import { bootDiff, editor, editorPanel, editorTabs, file, fileDiff, rows, summary } from '../explorer/explorer';

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

test('closing the last tab gives the docked Editor’s room back, and the next file opened takes it again at its size', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files, editor: { docked: true } });
  await rows(page).nth(0).click();
  const width = (await editor(page).boundingBox())!.width;
  await editorTabs(page).first().locator('.tab-close').click();
  await expect(editorPanel(page)).toBeHidden();
  await rows(page).nth(1).click();
  await expect(editorTabs(page)).toHaveText(['b.ts']);
  expect((await editor(page).boundingBox())!.width).toBeCloseTo(width, 0);
});

test('each session tab has its own files in the Editor', async ({ app, page }) => {
  const other = session({ id: '00000000-0000-4000-8000-0000000000e1', title: 'Second here', cwd: PROJECT, repoRoot: PROJECT });
  await bootDiff(app, { since: listed }, { files, also: other, editor: { docked: true } });
  await rows(page).nth(0).click();
  await expect(editorTabs(page)).toHaveText(['a.ts']);
  await tab(page, other.title).click();
  await expect(editorPanel(page)).toBeHidden();
  await rows(page).nth(1).click();
  await expect(editorTabs(page)).toHaveText(['b.ts']);
  await tab(page, here.title).click();
  await expect(editorTabs(page)).toHaveText(['a.ts']);
});

test('a full-screen docked Editor whose last tab closes gives the layout back, and does not fill the window again on the next file', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files, editor: { docked: true } });
  await rows(page).nth(0).click();
  await editor(page).getByRole('button', { name: 'Full screen' }).click();
  await expect(page.locator('#sidebar')).toBeHidden();
  await editorTabs(page).first().locator('.tab-close').click();
  await expect(page.locator('#sidebar')).toBeVisible();
  await rows(page).nth(1).click();
  await expect(editorTabs(page)).toHaveText(['b.ts']);
  await expect(page.locator('#sidebar')).toBeVisible();
});

test("with its tabs on more than one line, the head's own buttons stay on the first line, as the terminal's tab bar keeps its own", async ({ app, page }) => {
  const names = ['form-filler-viewer.component', 'create-review-task-form', 'actor.store', 'workflow-processes-list.component', 'session-panel.renderer'];
  const long = summary({ files: names.map((name) => file(`src/${name}.ts`)) });
  const longFiles = Object.fromEntries(names.map((name) => [`src/${name}.ts`, fileDiff(`src/${name}.ts`, [{ old: 1, new: 1, rows: [`+${name}`] }], [name])]));
  await bootDiff(app, { since: long }, { files: longFiles });
  for (let n = 0; n < names.length; n++) await rows(page).nth(n).dblclick();
  await expect(editorTabs(page)).toHaveCount(names.length);
  const first = (await editorTabs(page).first().boundingBox())!;
  const last = (await editorTabs(page).last().boundingBox())!;
  expect(last.y).toBeGreaterThan(first.y + first.height / 2);
  for (const name of ['Dock beside the session', 'Close all files']) {
    const button = (await editor(page).getByRole('button', { name }).boundingBox())!;
    expect(Math.abs(button.y + button.height / 2 - (first.y + first.height / 2))).toBeLessThanOrEqual(1);
  }
});
