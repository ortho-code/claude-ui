import { expect, test } from '../../../support/harness';
import { bootDiff, editor, editorPanel, editorTabs, file, fileDiff, rows, summary } from '../explorer/explorer';

// The Editor panel switched off in the layout: the Editor never docks, and a file pressed in the Explorer still opens, in the drawer over the terminal area, with no Dock to offer.

const listed = summary({ files: [file('src/a.ts'), file('src/b.ts')] });
const files = { 'src/a.ts': fileDiff('src/a.ts', [{ old: 1, new: 1, rows: ['+a line'] }], ['a line']) };

test('with the Editor panel switched off, a pressed file opens in the drawer, with no Dock', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files, editorOff: true });
  await rows(page).nth(0).click();
  await expect(editorTabs(page)).toHaveText(['a.ts']);
  await expect(page.locator('.drawer .editor-view')).toBeVisible();
  await expect(editor(page).locator('.editor-dock')).toBeHidden();
  await expect(editorPanel(page)).toHaveCount(0);
});

test('with the Editor panel switched off, a Editor kept as docked opens in the drawer all the same', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files, editorOff: true, editor: { docked: true } });
  await rows(page).nth(0).click();
  await expect(page.locator('.drawer .editor-view')).toBeVisible();
});
