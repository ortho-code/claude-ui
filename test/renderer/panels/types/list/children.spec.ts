import { expect, test } from '../../../support/harness';
import { runs } from '../../layout/layout';
import { bootList, row, type PrintedList } from './list';

// A row can hold rows (`children`): they sit under it, indented, and it folds them away and back from its chevron, or from a press on the row when the row has no link of its own.
// A section counts the rows that hold none, since those are the things listed; the rows holding them are only how they are grouped.

const TREE: PrintedList = {
  version: 1,
  sections: [
    {
      title: 'Changed',
      items: [
        {
          key: 'src',
          text: 'src/renderer',
          children: [
            { key: 'src/list.ts', lead: 'M', text: 'list.ts' },
            { key: 'src/types', text: 'types', shut: true, children: [{ key: 'src/types/a.ts', lead: 'A', text: 'a.ts' }] },
          ],
        },
        { key: 'docs', text: 'docs', href: 'https://example.com/docs', children: [{ key: 'docs/x.md', lead: 'M', text: 'x.md' }] },
        { key: 'readme', lead: 'M', text: 'README.md' },
      ],
    },
  ],
};

const leftOf = async (text: string, page: Parameters<typeof row>[0]): Promise<number> => (await row(page, text).locator('.card-title').boundingBox())!.x;

test("a row's children sit under it, further in, in the order they were printed, and a shut one's stay hidden", async ({ app, page }) => {
  await bootList(app, page, TREE);
  await expect(page.locator('.list-row .card-title')).toHaveText(['src/renderer', 'list.ts', 'types', 'docs', 'x.md', 'README.md']);
  expect(await leftOf('list.ts', page)).toBeGreaterThan(await leftOf('src/renderer', page));
  expect(await leftOf('README.md', page)).toBeLessThan(await leftOf('list.ts', page));
});

test("a row folds its children away and back from its chevron, and says which it is doing", async ({ app, page }) => {
  await bootList(app, page, TREE);
  const fold = row(page, 'src/renderer').locator('.list-fold');
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await fold.click();
  await expect(page.locator('.list-row .card-title')).toHaveText(['src/renderer', 'docs', 'x.md', 'README.md']);
  await expect(fold).toHaveAttribute('aria-expanded', 'false');
  await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
  await expect(fold).toHaveAttribute('aria-label', 'Fold src/renderer');
  await row(page, 'types').locator('.list-fold').click();
  await expect(page.locator('.list-row .card-title')).toHaveText(['src/renderer', 'list.ts', 'types', 'a.ts', 'docs', 'x.md', 'README.md']);
});

test('a press on a row with children and no link folds it; on one with a link it opens the link, and only the chevron folds', async ({ app, page }) => {
  await bootList(app, page, TREE);
  await row(page, 'src/renderer').locator('.card-title').click();
  await expect(row(page, 'list.ts')).toHaveCount(0);
  await row(page, 'docs').locator('.card-title').click();
  await expect.poll(() => app.calls('openExternal')).toEqual([['https://example.com/docs']]);
  await expect(row(page, 'x.md')).toHaveCount(1);
  await row(page, 'docs').locator('.list-fold').click();
  await expect(row(page, 'x.md')).toHaveCount(0);
  expect(await app.calls('openExternal')).toHaveLength(1);
});

test('a fold outlasts the next run, which prints the same rows again', async ({ app, page }) => {
  await bootList(app, page, TREE);
  await row(page, 'src/renderer').locator('.list-fold').click();
  await expect(row(page, 'list.ts')).toHaveCount(0);
  await page.locator('.panel-header .icon-btn').last().click();
  await expect.poll(() => runs(app, 'changes')).toHaveLength(2);
  const { token } = (await runs(app, 'changes'))[1];
  await app.emit('onPanelRun', 'changes', token, { kind: 'output', text: JSON.stringify({ ...TREE, sections: [{ ...TREE.sections[0], items: [...TREE.sections[0].items, { key: 'new', text: 'NEW.md' }] }] }) });
  await app.emit('onPanelRun', 'changes', token, { kind: 'exit', code: 0, signal: null });
  await expect(row(page, 'NEW.md')).toHaveCount(1);
  await expect(row(page, 'list.ts')).toHaveCount(0);
});

test('a section counts the rows that hold none, folded away or not', async ({ app, page }) => {
  await bootList(app, page, TREE);
  await expect(page.locator('.list-section .heading-count')).toHaveText('4');
});
