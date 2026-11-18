import { expect, test } from '../../../support/harness';
import { bootDiff, diffLayout, editor, editorTabs, file, fileDiff, note, rows, summary } from '../diff/diff';

// The Editor switched off in the layout: a file pressed in the diff panel opens nowhere; its row is marked, and the list says once where files open.

const listed = summary({ files: [file('src/a.ts'), file('src/b.ts')] });
const files = { 'src/a.ts': fileDiff('src/a.ts', [{ old: 1, new: 1, rows: ['+a line'] }], ['a line']) };
const NO_EDITOR = 'Files open in the Editor, which this layout switches off.';

test('with the Editor switched off, a press or a double click marks the row, says where files open, and opens nothing', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files, editorOff: true });
  await rows(page).nth(0).click();
  await expect(rows(page).nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(note(page)).toHaveText(NO_EDITOR);
  await rows(page).nth(1).dblclick();
  await expect(rows(page).nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(note(page)).toHaveText(NO_EDITOR);
  await expect(editor(page)).toHaveCount(0);
  expect(await app.calls('diffFile')).toEqual([]);
});

test('switching the Editor back on in the layout takes the note away, and the next press opens the file', async ({ app, page }) => {
  await bootDiff(app, { since: listed }, { files, editorOff: true });
  await rows(page).nth(0).click();
  await expect(note(page)).toHaveText(NO_EDITOR);
  await app.emit('onLayoutChanged', diffLayout('480px', false).layout);
  await expect(note(page)).toBeHidden();
  await rows(page).nth(0).click();
  await expect(editorTabs(page)).toHaveText(['a.ts']);
});
