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
