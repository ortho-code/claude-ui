import { PROJECT } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { bootDiff, file, menuRows, note, panel, questionButton, rows, summary } from './diff';

// The diff panel lists the files that changed in the checkout it looks in, for one of three questions, flat or as a tree.

const changed = summary({
  files: [file('src/app/main.ts', { added: 3, deleted: 1 }), file('src/app/new-name.ts', { status: 'R', from: 'src/old-name.ts' }), file('README.md', { status: 'U' }), file('logo.png', { binary: true })],
});

test('lists each changed file with its letter, its name after its folder, and what it adds and removes', async ({ app, page }) => {
  await bootDiff(app, { since: changed });
  await expect(rows(page)).toHaveText(['Msrc/app/main.ts+3 −1', 'Rsrc/app/new-name.ts+1 −0', 'UREADME.mdnew', 'Mlogo.pngbinary']);
  await expect(page.locator('.panel-header .panel-count')).toHaveText('4');
});

test("a renamed file's tooltip names where it came from", async ({ app, page }) => {
  await bootDiff(app, { since: changed });
  await expect(rows(page).nth(1).locator('.card-title')).toHaveAttribute('title', 'src/old-name.ts → src/app/new-name.ts');
});

test('the file tree puts each file under its folders, a folder holding only one folder sharing its row, folders first and each level by name', async ({ app, page }) => {
  await bootDiff(app, { since: changed });
  await page.locator('.panel-header .panel-view').nth(1).click();
  await expect(rows(page)).toHaveText(['src/app2', 'Mmain.ts+3 −1', 'Rnew-name.ts+1 −0', 'Mlogo.pngbinary', 'UREADME.mdnew']);
});

test('a folder of the tree folds from its chevron and from a press on it, and unfolds again, its count still showing', async ({ app, page }) => {
  await bootDiff(app, { since: changed });
  await page.locator('.panel-header .panel-view').nth(1).click();
  await rows(page).filter({ hasText: 'src/app' }).locator('.list-fold').click();
  await expect(rows(page)).toHaveText(['src/app2', 'Mlogo.pngbinary', 'UREADME.mdnew']);
  await expect(rows(page).first().locator('.list-fold')).toHaveAttribute('aria-expanded', 'false');
  await rows(page).filter({ hasText: 'src/app' }).click();
  await expect(rows(page)).toHaveCount(5);
});

test('the question menu lines its labels up, the ones with a count and the one without', async ({ app, page }) => {
  await bootDiff(app, { since: changed });
  await questionButton(page).click();
  // Where each label's text starts: a counted row's label span, or a plain row's own text after its tick.
  const starts = await menuRows(page).evaluateAll((buttons) =>
    buttons.map((button) => {
      const range = document.createRange();
      range.selectNodeContents(button.querySelector('.menu-item-label') ?? [...button.childNodes].find((node) => node.nodeType === Node.TEXT_NODE)!);
      return Math.round(range.getBoundingClientRect().left);
    }),
  );
  expect(new Set(starts).size).toBe(1);
});

test('the header names what the list is measured from, and says a guessed base is guessed', async ({ app, page }) => {
  await bootDiff(app, { since: summary({ counts: { ahead: 2, behind: 5, unpushed: 1 } }) });
  await expect(panel(page).locator('.diff-base')).toHaveText('from upstream/main · guessed · 5 behind');
});

test("a base kept for the branch is named without the guess, and a kept one that is gone says so", async ({ app, page }) => {
  await bootDiff(app, { since: summary({ base: { ref: 'origin/main', source: 'convention' }, missing: 'origin/gone' }) });
  await expect(panel(page).locator('.diff-base')).toHaveText('origin/gone is gone; from origin/main · guessed');
});

test('the question menu offers the three, the one on show ticked, with the commits each counts', async ({ app, page }) => {
  await bootDiff(app, { since: changed });
  await questionButton(page).click();
  await expect(menuRows(page)).toHaveText([/Since branched\s*2/, /Unpushed\s*1/, /Uncommitted/]);
  await expect(menuRows(page).locator('.menu-tick svg')).toHaveCount(1);
  await expect(menuRows(page).nth(0).locator('.menu-tick svg')).toHaveCount(1);
});

test('picking another question lists its files, and keeps the pick for the panel', async ({ app, page }) => {
  await bootDiff(app, { since: changed, uncommitted: summary({ files: [file('only.txt')] }) });
  await expect(rows(page)).toHaveCount(4);
  await questionButton(page).click();
  await menuRows(page).filter({ hasText: 'Uncommitted' }).click();
  await expect(rows(page)).toHaveText(['Monly.txt+1 −0']);
  await expect(questionButton(page)).toHaveText('Uncommitted');
  expect(await app.calls('setDiffPicks')).toEqual([['changes', { question: 'uncommitted' }]]);
  expect((await app.calls('diffSummary')).at(-1)).toEqual([PROJECT, 'uncommitted']);
});

test('a question kept for the panel is the one it opens on', async ({ app, page }) => {
  await bootDiff(app, { since: changed, unpushed: summary({ files: [file('pushed.txt')] }) }, { data: { sessions: {}, lastGroup: {}, diff: { question: 'unpushed' } } });
  await expect(questionButton(page)).toHaveText('Unpushed');
  await expect(rows(page)).toHaveText(['Mpushed.txt+1 −0']);
});

test('nothing to list says so in words, by question', async ({ app, page }) => {
  await bootDiff(app, { since: summary(), unpushed: summary() });
  await expect(note(page)).toHaveText('Nothing changed since upstream/main.');
  await questionButton(page).click();
  await menuRows(page).filter({ hasText: 'Unpushed' }).click();
  await expect(note(page)).toHaveText('Nothing to push.');
  await expect(page.locator('.panel-header .panel-count')).toHaveText('0');
});

test('Since branched without a base says why, and that the other two still work', async ({ app, page }) => {
  await bootDiff(app, { since: summary({ base: null, against: null }) });
  await expect(note(page)).toContainText('No base to measure from');
  await expect(note(page)).toContainText('Unpushed and Uncommitted still work.');
});

test('untracked files past those listed are counted under the list', async ({ app, page }) => {
  await bootDiff(app, { since: summary({ files: [file('a.txt', { status: 'U' })], untrackedLeftOut: 1200 }) });
  await expect(note(page)).toHaveText('And 1200 more untracked files, not listed.');
});

test("a folder git cannot read says so in git's words", async ({ app, page }) => {
  await bootDiff(app, {});
  await expect(note(page)).toHaveText('Git could not read the changes here: fatal: not a git repository (or any of the parent directories): .git.');
  await expect(rows(page)).toHaveCount(0);
});
