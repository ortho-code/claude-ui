import type { Page } from '@playwright/test';
import { CONFIG_ROOT } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { overrun } from '../../../support/looks';
import { runs, withLayout } from '../../layout/layout';

// What a list row shows of what the script printed: its text and detail stay inside the row, beside its buttons and never under them.
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
      ],
    },
  ],
};

async function bootList(app: App, page: Page): Promise<void> {
  await app.boot({ ...fixture, layout: { ...fixture.layout, types: [{ name: 'changes', dir: TYPE_DIR, status: 'read', error: null, json: { version: 1, kind: 'list', title: 'Changes', icon: 'git', run: 'list.mjs' } }] }, paths: { [`${TYPE_DIR}/list.mjs`]: 'executable' }, panelData: { changes: { sessions: {}, lastGroup: {} } } });
  await expect.poll(() => runs(app, 'changes')).toHaveLength(1);
  const { token } = (await runs(app, 'changes'))[0];
  await app.emit('onPanelRun', 'changes', token, { kind: 'output', text: JSON.stringify(LIST) });
  await app.emit('onPanelRun', 'changes', token, { kind: 'exit', code: 0, signal: null });
  await expect(page.locator('.list-row')).toHaveCount(2);
}

test("a row's detail with a word longer than its line stays beside the row's button, not under it", async ({ app, page }) => {
  await bootList(app, page);
  await expect.poll(() => overrun(page.locator('.list-row', { hasText: 'FeaturedImageDownloaderTest.php' }).locator('.card-meta'))).toBe(0);
});

test("a row's text with a word longer than its line stays inside the row", async ({ app, page }) => {
  await bootList(app, page);
  await expect.poll(() => overrun(page.locator('.list-row', { hasText: 'LongerThanAnyRowIsWide' }).locator('.card-title'))).toBe(0);
});
