import { PROJECT } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { bootDiff, editorTabs, file, fileDiff, rows, summary } from '../explorer/explorer';

// A file open in the Editor is read again, on its own watch, when its checkout's working tree changes, against the commit its list now measures from; that comparison stays with its tab.

const POLL = 30_000;
const listed = summary({ files: [file('src/a.ts'), file('src/b.ts')] });
const files = Object.fromEntries(['a', 'b'].map((name) => [`src/${name}.ts`, fileDiff(`src/${name}.ts`, [{ old: 1, new: 1, rows: [`+${name} line`] }], [`${name} line`])]));
/** The commit each read of `src/a.ts` was taken against, in order. */
const againstOfA = async (app: App): Promise<unknown[]> => (await app.calls('diffFile')).filter((call) => call[2] === 'src/a.ts').map((call) => call[1]);

test('a file read again against a newer commit keeps that commit when its tab is shown again', async ({ app, page }) => {
  await page.clock.install();
  await bootDiff(app, { since: listed }, { files, tree: 'clean' });
  await rows(page).nth(0).click();
  await editorTabs(page).nth(0).locator('.tab-label').dblclick();
  await rows(page).nth(1).click();
  await expect(editorTabs(page)).toHaveText(['a.ts', 'b.ts']);
  await editorTabs(page).nth(0).locator('.tab-label').click();
  await expect.poll(async () => (await againstOfA(app)).at(-1)).toBe('aaaaaaa');

  await page.evaluate(([dir, now]) => {
    window.__claudeUiFixture.diffs[dir].since = now;
    window.__claudeUiFixture.trees[dir] = 'committed';
  }, [PROJECT, summary({ against: 'bbbbbbb', files: listed.files })] as const);
  await page.clock.fastForward(POLL);
  await page.clock.fastForward(POLL);
  await expect.poll(async () => (await againstOfA(app)).at(-1)).toBe('bbbbbbb');

  await editorTabs(page).nth(1).locator('.tab-label').click();
  await expect(editorTabs(page).nth(1)).toHaveClass(/\bactive\b/);
  await editorTabs(page).nth(0).locator('.tab-label').click();
  await expect(editorTabs(page).nth(0)).toHaveClass(/\bactive\b/);
  await page.clock.fastForward(1_000);
  expect((await againstOfA(app)).at(-1)).toBe('bbbbbbb');
});
