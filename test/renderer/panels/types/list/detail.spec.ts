import type { Locator } from '@playwright/test';
import { expect, test } from '../../../support/harness';
import { token } from '../../../support/looks';
import { clickAcross } from '../../../support/press';
import { runs } from '../../layout/layout';
import { bootList, print, row, type PrintedList } from './list';

// What a row's `detail` draws (docs/panel-types.md § An item, § A part): each of its lines under the first, the parts of a line with the separator between them, the row's own, else the list's, else ` · `; a part that links opens its own link, says on hover where it goes, and a part takes the colour of its tone.

const STORY = 'https://example.com/story/1';
const EPIC = 'https://example.com/epic/9';
const OBJECTIVE = 'https://example.com/objective/3';

/** A story row whose link is its own, with its epic and its objective linked on its second line, and a priority that says what it is on hover. */
const linked = (id = 'sc-1'): PrintedList => ({
  version: 1,
  sections: [
    {
      items: [
        {
          key: 'sc-1',
          text: 'Fix the importer',
          href: STORY,
          detail: [
            [id, '3d'],
            [{ text: 'Login revamp', href: EPIC, tooltip: 'Its epic' }, { text: 'Q4 platform', href: OBJECTIVE }, { text: 'High', tooltip: 'Its priority' }],
          ],
        },
      ],
    },
  ],
});

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

test("a link in a row's detail opens its own link from a click and from a middle-click, and not the row's", async ({ app, page }) => {
  await bootList(app, page, linked());
  const epic = row(page, 'Fix the importer').getByRole('link', { name: 'Login revamp' });
  await epic.click();
  await epic.click({ button: 'middle' });
  expect(await app.calls('openExternal')).toEqual([[EPIC], [EPIC]]);
  expect(await row(page, 'Fix the importer').locator('.card-meta').innerText()).toBe('sc-1 · 3d\nLogin revamp · Q4 platform · High');
});

test("hovering a link in a row's detail shows its tooltip and where it goes, or where it goes alone; a part that is not a link, its tooltip, else the row's link", async ({ app, page }) => {
  await bootList(app, page, linked());
  const story = row(page, 'Fix the importer');
  const hovered = async (part: Locator): Promise<string> => {
    await part.hover();
    await expect(page.locator('#tooltip')).toBeVisible();
    const said = await page.locator('#tooltip').innerText();
    await page.mouse.move(0, 0);
    await expect(page.locator('#tooltip')).toBeHidden();
    return said;
  };
  expect(await hovered(story.getByRole('link', { name: 'Login revamp' }))).toBe(`Its epic\n${EPIC}`);
  expect(await hovered(story.getByRole('link', { name: 'Q4 platform' }))).toBe(OBJECTIVE);
  expect(await hovered(story.getByText('High', { exact: true }))).toBe('Its priority');
  expect(await hovered(story.getByText('sc-1', { exact: true }))).toBe(STORY);
});

test("a part takes its tone's colour, a link's in place of the accent, a muted part is dimmed, and a part without one keeps the line's grey whatever its row's tone", async ({ app, page }) => {
  await bootList(app, page, {
    version: 1,
    sections: [
      {
        items: [
          {
            key: 'a',
            text: 'A failing row',
            tone: 'danger',
            detail: [[{ text: 'waiting', tone: 'attention' }, { text: 'failed', href: EPIC, tone: 'danger' }, { text: 'linked', href: OBJECTIVE }, 'plain', { text: 'quiet', tone: 'muted' }]],
          },
        ],
      },
    ],
  });
  const failing = row(page, 'A failing row');
  const colourOf = (part: Locator): Promise<string> => part.evaluate((el) => getComputedStyle(el).color);
  expect(await colourOf(failing.getByText('waiting', { exact: true }))).toBe(await token(page, '--waiting'));
  expect(await colourOf(failing.getByRole('link', { name: 'failed' }))).toBe(await token(page, '--failed'));
  expect(await colourOf(failing.getByRole('link', { name: 'linked' }))).toBe(await token(page, '--accent'));
  expect(await colourOf(failing.getByText('plain', { exact: true }))).toBe(await token(page, '--muted'));
  const quiet = failing.getByText('quiet', { exact: true });
  expect(await colourOf(quiet)).toBe(await token(page, '--muted'));
  // As numbers, since the minified bundle writes the token as ".55" (base.css has 0.55) and the opacity reads back as computed ("0.55").
  expect(Number(await quiet.evaluate((el) => getComputedStyle(el).opacity))).toBe(Number(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dimmed'))));
});

test("a press on a link in a row's detail still opens it when the list is drawn again between the press and its release", async ({ app, page }) => {
  await bootList(app, page, linked('sc-1'));
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => runs(app, 'changes')).toHaveLength(2);
  const story = row(page, 'Fix the importer');
  await clickAcross(page, story.getByRole('link', { name: 'Login revamp' }), async () => {
    await print(app, 1, linked('sc-1 again'));
    await expect(story.getByText('sc-1 again', { exact: true })).toBeVisible();
  });
  expect(await app.calls('openExternal')).toEqual([[EPIC]]);
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
