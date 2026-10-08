import type { Locator, Page } from '@playwright/test';
import { type BridgeFixture, CONFIG_ROOT, PROJECT } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { runs, withLayout } from '../../layout/layout';

// A list panel takes `watch: git` as a command panel does, by the one declaration and the one check (`prepare`).
const QUEUE_DIR = `${CONFIG_ROOT}/types/reviews`;

function fixture(trees: Record<string, string> = {}): Partial<BridgeFixture> {
  const base = withLayout({
    version: 2,
    root: {
      id: 'window',
      columns: [
        { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
        { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
        { id: 'right', size: '360px', panels: [{ id: 'queue', type: 'reviews', options: { watch: 'git' } }] },
      ],
    },
  });
  return {
    ...base,
    layout: { ...base.layout, types: [{ name: 'reviews', dir: QUEUE_DIR, status: 'read', error: null, json: { version: 1, kind: 'list', title: 'Reviews', icon: 'eye', run: 'list.sh' } }] },
    paths: { [`${QUEUE_DIR}/list.sh`]: 'executable' },
    panelData: { queue: { sessions: {}, lastGroup: {} } },
    trees,
  };
}

// On show, since the panel keeps a box of the same class for a run that gave no list.
const problems = (page: Page): Locator => page.locator('.panel-problems:visible');

test('a list panel watching git in a folder in no working tree says so, and does not run', async ({ app, page }) => {
  await app.boot(fixture());
  await expect(problems(page)).toHaveText(`watch: git, but ${PROJECT} is not in a git working tree; press Refresh once it is.`);
  expect(await runs(app, 'queue')).toEqual([]);
});

test('a list panel watching git in a working tree runs as any other does', async ({ app, page }) => {
  await app.boot(fixture({ [PROJECT]: 'clean' }));
  await expect.poll(() => runs(app, 'queue')).toHaveLength(1);
  await expect(problems(page)).toHaveCount(0);
});
