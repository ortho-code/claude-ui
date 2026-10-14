import type { Locator } from '@playwright/test';
import { expect, test } from '../../../support/harness';
import { clickAcross } from '../../../support/press';
import { runs } from '../../layout/layout';
import { bootList, print, row, type PrintedList } from './list';

// What a row's `detail` draws (docs/panel-types.md § An item, § A part): each of its lines under the first, the parts of a line with the separator between them, the row's own, else the list's, else ` · `.

/** How many lines a row's detail takes on screen, by where its text's own boxes start. */
const linesOf = (meta: Locator): Promise<number> =>
  meta.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  });

test("a row's detail draws each of its lines under the first, the parts of a line with ` · ` between them", async ({ app, page }) => {
  await bootList(app, page, { version: 1, sections: [{ items: [{ key: 'a', text: 'Fix the login redirect', detail: [['#1', '3d', { text: 'someone' }], ['2 reviewers']] }] }] });
  const meta = row(page, 'Fix the login redirect').locator('.card-meta');
  expect(await meta.innerText()).toBe('#1 · 3d · someone\n2 reviewers');
  expect(await linesOf(meta)).toBe(2);
});

test("a row's lines take its own separator, else the list's, and an empty one sets the parts side by side", async ({ app, page }) => {
  const parts = [['a', 'b', 'c']];
  await bootList(app, page, {
    version: 1,
    separator: ' / ',
    sections: [
      {
        items: [
          { key: 'list', text: 'The list’s', detail: parts },
          { key: 'own', text: 'Its own', detail: parts, separator: ' | ' },
          { key: 'none', text: 'None at all', detail: parts, separator: '' },
          { key: 'parent', text: 'A parent', separator: ' | ', children: [{ key: 'child', text: 'Its child', detail: parts }] },
        ],
      },
    ],
  });
  const detail = (text: string): Promise<string> => row(page, text).locator('.card-meta').innerText();
  expect(await detail('The list’s')).toBe('a / b / c');
  expect(await detail('Its own')).toBe('a | b | c');
  expect(await detail('None at all')).toBe('abc');
  // A row it holds takes the list's, not its parent's.
  expect(await detail('Its child')).toBe('a / b / c');
});

test("a compact row draws its detail's lines one under another", async ({ app, page }) => {
  await bootList(app, page, { version: 1, compact: true, sections: [{ items: [{ key: 'a', lead: 'M', text: 'FQDN.php', detail: [['src/Domain'], ['modified', '+9 −0']] }] }] });
  expect(await linesOf(row(page, 'FQDN.php').locator('.card-meta'))).toBe(2);
});

test("a press on a row's detail still opens the row's link when the list is drawn again between the press and its release", async ({ app, page }) => {
  const printed = (run: number): PrintedList => ({ version: 1, sections: [{ items: [{ key: 'a', text: 'Fix the login redirect', detail: [[`run ${run}`, '3d']], href: 'https://example.com/pr/1' }] }] });
  await bootList(app, page, printed(1));
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => runs(app, 'changes')).toHaveLength(2);
  const line = row(page, 'Fix the login redirect').locator('.card-meta > *').first();
  await clickAcross(page, line, async () => {
    await print(app, 1, printed(2));
    await expect(line).toHaveText('run 2 · 3d');
  });
  expect(await app.calls('openExternal')).toEqual([['https://example.com/pr/1']]);
});
