import type { Locator, Page } from '@playwright/test';
import { type BridgeFixture, CONFIG_ROOT, PROJECT } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { chooseProject } from '../../../support/window';
import { OTHER, railItem, runs, withLayout } from '../../layout/layout';

// Panels in a folded group, as a layout with its right-hand group folded keeps them: each runs on its interval and on a switch to another folder, and its rail icon's count follows each run.
const QUEUE_DIR = `${CONFIG_ROOT}/panel-types/reviews`;
const TODO_DIR = `${CONFIG_ROOT}/panel-types/todo`;
const MINUTE = 60_000;

const LAYOUT = {
  version: 2,
  root: {
    id: 'window',
    columns: [
      { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
      { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
      {
        id: 'right',
        size: '360px',
        collapsible: true,
        panels: [
          { id: 'queue', type: 'reviews' },
          { id: 'todo', type: 'todo' },
        ],
      },
    ],
  },
};

function folded(): ReturnType<typeof withLayout> {
  const base = withLayout(LAYOUT, { right: { folded: true, active: 'queue' } });
  return {
    ...base,
    layout: {
      ...base.layout,
      types: [
        { name: 'reviews', dir: QUEUE_DIR, status: 'read', error: null, json: { version: 1, kind: 'list', title: 'Reviews', icon: 'eye', run: 'list.sh', interval: '5m' } },
        { name: 'todo', dir: TODO_DIR, status: 'read', error: null, json: { version: 1, kind: 'list', title: 'Todo', icon: 'list', run: 'list.sh', interval: '1m' } },
      ],
    },
  };
}

const fixture = (): Partial<BridgeFixture> => ({
  ...folded(),
  paths: { [`${QUEUE_DIR}/list.sh`]: 'executable', [`${TODO_DIR}/list.sh`]: 'executable' },
  panelData: { queue: { sessions: {}, lastGroup: {} }, todo: { sessions: {}, lastGroup: {} } },
});

/** End `entry`'s latest run with a list counting `badge`. */
async function finish(app: App, entry: string, badge: number): Promise<void> {
  const { token } = (await runs(app, entry)).at(-1)!;
  await app.emit('onPanelRun', entry, token, { kind: 'output', text: JSON.stringify({ version: 1, badge, sections: [{ items: [{ key: 'a', text: 'A row' }] }] }) });
  await app.emit('onPanelRun', entry, token, { kind: 'exit', code: 0, signal: null });
}

const railCount = (page: Page, label: RegExp): Locator => railItem(page, label).locator('.rail-count');

test('panels in a folded group run on their intervals and their rail counts follow each run', async ({ app, page }) => {
  await page.clock.install();
  await app.boot(fixture());
  await expect.poll(() => runs(app, 'queue')).toHaveLength(1);
  await expect.poll(() => runs(app, 'todo')).toHaveLength(1);
  await finish(app, 'queue', 3);
  await finish(app, 'todo', 1);
  await expect(railCount(page, /^Reviews/)).toHaveText('3');
  await expect(railCount(page, /^Todo/)).toHaveText('1');

  await page.clock.fastForward(MINUTE);
  await expect.poll(() => runs(app, 'todo')).toHaveLength(2);
  await finish(app, 'todo', 4);
  await expect(railCount(page, /^Todo/)).toHaveText('4');

  await page.clock.fastForward(5 * MINUTE);
  await expect.poll(() => runs(app, 'queue')).toHaveLength(2);
  await finish(app, 'queue', 0);
  await expect(railCount(page, /^Reviews/)).toHaveText('0');
});

test("a panel that has run follows a switch to another folder out of sight, so its count is the new folder's", async ({ app, page }) => {
  await page.clock.install();
  // A list watching git, with no interval, beside a command: it runs only on show, on Refresh, on a change in its tree and on a switch.
  const base = withLayout({
    version: 2,
    root: {
      id: 'window',
      columns: [
        { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
        { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
        {
          id: 'right',
          size: '360px',
          collapsible: true,
          panels: [
            { id: 'todo', type: 'todo', options: { watch: 'git' } },
            { id: 'other', type: 'command', title: 'Other', icon: 'check', options: { command: 'make check' } },
          ],
        },
      ],
    },
  });
  await app.boot({
    ...base,
    layout: { ...base.layout, types: [{ name: 'todo', dir: TODO_DIR, status: 'read', error: null, json: { version: 1, kind: 'list', title: 'Todo', icon: 'list', run: 'list.sh' } }] },
    paths: { [`${TODO_DIR}/list.sh`]: 'executable' },
    panelData: { todo: { sessions: {}, lastGroup: {} } },
    trees: { [PROJECT]: 'clean', [OTHER]: 'other tree' },
  });
  const folders = async (): Promise<string[]> => (await runs(app, 'todo')).map((run) => run.context.cwd);
  await expect.poll(folders).toEqual([PROJECT]);
  await finish(app, 'todo', 0);
  await expect(railCount(page, /^Todo/)).toHaveText('0');
  // The shown panel's icon folds the group.
  await railItem(page, /^Todo/).click();
  await expect(railItem(page, /^Todo/)).not.toHaveClass(/\bshown\b/);

  await chooseProject(page, 'other');
  await expect.poll(folders).toEqual([PROJECT, OTHER]);
  await finish(app, 'todo', 1);
  await expect(railCount(page, /^Todo/)).toHaveText('1');
  await expect(railItem(page, /^Todo/)).not.toHaveClass(/\bshown\b/);
});

test("a folded group's counts outlast a change to the app's file beside the layout", async ({ app, page }) => {
  await page.clock.install();
  await app.boot(fixture());
  await expect.poll(() => runs(app, 'queue')).toHaveLength(1);
  await expect.poll(() => runs(app, 'todo')).toHaveLength(1);
  await finish(app, 'queue', 3);
  await finish(app, 'todo', 1);
  await expect(railCount(page, /^Todo/)).toHaveText('1');

  // Another node's state changing, as a resize of the sidebar writes it.
  const next = withLayout(LAYOUT, { right: { folded: true, active: 'queue' }, sidebar: { size: '300px' } });
  expect(await app.emit('onLayoutChanged', { ...next.layout, types: folded().layout.types })).toBe(1);
  await expect(railCount(page, /^Reviews/)).toHaveText('3');
  await expect(railCount(page, /^Todo/)).toHaveText('1');

  await page.clock.fastForward(MINUTE);
  await expect.poll(() => runs(app, 'todo')).toHaveLength(2);
  await finish(app, 'todo', 2);
  await expect(railCount(page, /^Todo/)).toHaveText('2');
});
