import type { Locator, Page } from '@playwright/test';
import { CONFIG_ROOT } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { overrun, token } from '../../../support/looks';
import { runs, withLayout } from '../../layout/layout';

// What a list row shows of what the script printed: its text and detail stay inside the row, beside its buttons and never under them, and its text shows the tooltip the script gives it.
const TYPE_DIR = `${CONFIG_ROOT}/types/changes`;
const fixture = withLayout({
  version: 2,
  root: {
    id: 'window',
    columns: [
      { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
      { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
      { id: 'right', size: '360px', panels: [{ id: 'changes', type: 'changes' }] },
    ],
  },
});
const review = { label: 'Review', session: { prompt: 'Review it.' } };
const LIST = {
  version: 1,
  sections: [
    {
      title: 'Staged',
      items: [
        { key: 'a', text: 'FeaturedImageDownloaderTest.php', detail: 'tests/unit/Application/Subscription/ProcessUpdates/Service · modified · +144 −37', actions: [review] },
        { key: 'b', text: 'FeaturedImageDownloaderTestWithAFileNameLongerThanAnyRowIsWide.php', detail: 'src/Domain · modified · +9 −0' },
        { key: 'c', text: 'FQDN.php', detail: 'modified · +9 −0', tooltip: 'src/Domain/ValueObject/Host/FQDN.php', href: 'https://example.com/FQDN.php' },
      ],
    },
  ],
};

/** Boot with the panel, and let its script print `list`. */
async function bootList(app: App, page: Page, list: { version: number; sections: { items: unknown[] }[] } = LIST): Promise<void> {
  await app.boot({ ...fixture, layout: { ...fixture.layout, types: [{ name: 'changes', dir: TYPE_DIR, status: 'read', error: null, json: { version: 1, kind: 'list', title: 'Changes', icon: 'git', run: 'list.mjs' } }] }, paths: { [`${TYPE_DIR}/list.mjs`]: 'executable' }, panelData: { changes: { sessions: {}, lastGroup: {} } } });
  await expect.poll(() => runs(app, 'changes')).toHaveLength(1);
  const { token: run } = (await runs(app, 'changes'))[0];
  await app.emit('onPanelRun', 'changes', run, { kind: 'output', text: JSON.stringify(list) });
  await app.emit('onPanelRun', 'changes', run, { kind: 'exit', code: 0, signal: null });
  await expect(page.locator('.list-row')).toHaveCount(list.sections.reduce((count, { items }) => count + items.length, 0));
}

const row = (page: Page, text: string): Locator => page.locator('.list-row', { hasText: text });

/** The colour of a row's leading edge, or 'none' without one. */
const edgeOf = (target: Locator): Promise<string> => target.evaluate((el) => /rgba?\([^)]*\)/.exec(getComputedStyle(el).boxShadow)?.[0] ?? 'none');

test("a row's tone marks its leading edge in the status colours, and a normal row has no edge", async ({ app, page }) => {
  const tones = { attention: '--waiting', positive: '--idle', danger: '--failed' };
  await bootList(app, page, { version: 1, sections: [{ items: [...Object.keys(tones), 'normal'].map((tone) => ({ key: tone, text: `A ${tone} row`, tone })) }] });
  for (const [tone, colour] of Object.entries(tones)) await expect.poll(() => edgeOf(row(page, `A ${tone} row`))).toBe(await token(page, colour));
  // No shadow at all, not a transparent one, which shifts a dimmed row's corner pixels (list.css).
  expect(await edgeOf(row(page, 'A normal row'))).toBe('none');
});

/** A one-line list of changed files, each with a lead mark and a trailing count, as the `changes` type prints it. */
const FILES = {
  version: 1,
  sections: [
    {
      items: [
        { key: 'm', lead: 'M', leadTone: 'attention', text: 'FQDN.php', trail: '+9 −0', tooltip: 'src/Domain/ValueObject/Host/FQDN.php\nmodified' },
        { key: 'a', lead: 'A', leadTone: 'positive', text: 'FeaturedImageDownloaderTestWithAFileNameLongerThanAnyRowIsWide.php', trail: '+144 −37' },
        { key: 'u', lead: 'U', text: 'composer.lock', tone: 'danger', actions: [{ label: 'Resolve', session: { prompt: 'Resolve it.' } }] },
        { key: 'd', lead: 'D', leadTone: 'danger', text: 'LegacyHost.php', trail: '+0 −52' },
      ],
    },
  ],
};

/** Where an element sits, in px. */
const boxOf = async (target: Locator): Promise<{ left: number; right: number; top: number; bottom: number }> => {
  const box = (await target.boundingBox())!;
  return { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height };
};

test("a row's lead sits in a column of its own before its text, so the texts line up, and its trail at the end of its first line", async ({ app, page }) => {
  await bootList(app, page, FILES);
  const [modified, deleted] = [row(page, 'FQDN.php'), row(page, 'LegacyHost.php')];
  const [lead, title, trail, content] = await Promise.all(['.list-lead', '.card-title', '.list-trail', '.card-content'].map((part) => boxOf(modified.locator(part))));
  expect(lead.right).toBeLessThanOrEqual(title.left);
  expect(Math.round(trail.right)).toBe(Math.round(content.right));
  expect(trail.top).toBeLessThan(title.bottom);
  expect((await boxOf(deleted.locator('.card-title'))).left).toBe(title.left);
});

test("a row's long text gives way to its trail, which stays whole on the first line", async ({ app, page }) => {
  await bootList(app, page, FILES);
  const long = row(page, 'LongerThanAnyRowIsWide');
  await expect.poll(() => overrun(long.locator('.list-trail'))).toBe(0);
  await expect.poll(() => overrun(long.locator('.card-title'))).toBe(0);
  const [title, trail] = await Promise.all([boxOf(long.locator('.card-title')), boxOf(long.locator('.list-trail'))]);
  expect(title.right).toBeLessThanOrEqual(trail.left);
  expect(trail.top).toBeLessThan(title.top + 16);
});

test("a row's lead takes its tone's colour, the meta line's grey without one, never its row's", async ({ app, page }) => {
  await bootList(app, page, FILES);
  const colourOf = (text: string): Promise<string> => row(page, text).locator('.list-lead').evaluate((el) => getComputedStyle(el).color);
  expect(await colourOf('FQDN.php')).toBe(await token(page, '--waiting'));
  expect(await colourOf('LongerThanAnyRowIsWide')).toBe(await token(page, '--idle'));
  expect(await colourOf('LegacyHost.php')).toBe(await token(page, '--failed'));
  // A danger row whose lead has no tone of its own: the edge is red, the lead grey.
  expect(await edgeOf(row(page, 'composer.lock'))).toBe(await token(page, '--failed'));
  expect(await colourOf('composer.lock')).toBe(await token(page, '--muted'));
});

test("a row's text keeps to two lines beside its lead and trail, as a session title does", async ({ app, page }) => {
  const words = 'Fix the login redirect after a session times out, and again after the refresh token expires, on every browser';
  await bootList(app, page, { version: 1, sections: [{ items: [{ key: 'long', lead: 'M', text: words, trail: '+1 −1' }] }] });
  // The lines in view, counted by where the text's own boxes start, and whether more was cut off below them.
  const lines = await row(page, 'Fix the login')
    .locator('.card-title')
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const bottom = el.getBoundingClientRect().bottom;
      const tops = new Set([...range.getClientRects()].filter((rect) => rect.top < bottom - 1).map((rect) => Math.round(rect.top)));
      return { shown: tops.size, cut: el.scrollHeight > el.clientHeight };
    });
  expect(lines).toEqual({ shown: 2, cut: true });
});

test("a row's tooltip shows over the whole of its first line, its lead and trail too", async ({ app, page }) => {
  await bootList(app, page, FILES);
  for (const part of ['.list-lead', '.list-trail']) {
    await row(page, 'FQDN.php').locator(part).hover();
    await expect(page.locator('#tooltip')).toHaveText('src/Domain/ValueObject/Host/FQDN.php\nmodified');
    await page.mouse.move(0, 0);
    await expect(page.locator('#tooltip')).toBeHidden();
  }
});

/** FILES as a compact list, with a row that has a link. */
const COMPACT = { ...FILES, compact: true, sections: [{ items: [...FILES.sections[0].items, { key: 'l', lead: 'M', text: 'linked.md', trail: '+1 −0', href: 'https://example.com/linked.md' }] }] };

test('a compact list draws a row without a detail as one line, without the card around it or the gap between rows', async ({ app, page }) => {
  await bootList(app, page, COMPACT);
  const [short, long] = [row(page, 'FQDN.php'), row(page, 'LongerThanAnyRowIsWide')];
  expect(await short.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect((await boxOf(long)).top).toBe((await boxOf(short)).bottom);
  // A text too long for its line is cut short on that one line, and its trail stays whole beside it.
  expect((await boxOf(long.locator('.card-title'))).bottom - (await boxOf(long.locator('.card-title'))).top).toBe((await boxOf(short.locator('.card-title'))).bottom - (await boxOf(short.locator('.card-title'))).top);
  expect(await long.locator('.card-title').evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis');
  await expect.poll(() => overrun(long.locator('.list-trail'))).toBe(0);
});

test('a compact row with a link still lights under the pointer', async ({ app, page }) => {
  await bootList(app, page, COMPACT);
  const linked = row(page, 'linked.md');
  await linked.hover();
  await expect.poll(() => linked.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await token(page, '--surface-hover'));
});

test("a row's detail with a word longer than its line stays beside the row's button, not under it", async ({ app, page }) => {
  await bootList(app, page);
  await expect.poll(() => overrun(row(page, 'FeaturedImageDownloaderTest.php').locator('.card-meta'))).toBe(0);
});

test("a row's text with a word longer than its line stays inside the row", async ({ app, page }) => {
  await bootList(app, page);
  await expect.poll(() => overrun(row(page, 'LongerThanAnyRowIsWide').locator('.card-title'))).toBe(0);
});

test("a row's text shows its tooltip, and the rest of a row with a link still shows where the link goes", async ({ app, page }) => {
  await bootList(app, page);
  const fqdn = row(page, 'FQDN.php');
  await fqdn.locator('.card-title').hover();
  await expect(page.locator('#tooltip')).toHaveText('src/Domain/ValueObject/Host/FQDN.php');
  await fqdn.locator('.card-meta').hover();
  await expect(page.locator('#tooltip')).toHaveText('https://example.com/FQDN.php');
});
