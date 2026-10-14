import type { Locator, Page } from '@playwright/test';
import { type BridgeFixture, CONFIG_ROOT } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { runs, withLayout } from '../../layout/layout';

// A type's own options, as its manifest declares them (docs/panel-types.md § An option): checked under the panel by the one checker, and handed to the run as `CLAUDE_UI_OPTION_<NAME>`, a text as written and a list as its JSON.
const STORIES_DIR = `${CONFIG_ROOT}/panel-types/stories`;
const MANIFEST = {
  version: 1,
  kind: 'list',
  title: 'Stories',
  run: 'list.mjs',
  options: [
    { name: 'count', kind: 'text' },
    { name: 'actions', kind: 'list', fields: [{ name: 'button', kind: 'text' }, { name: 'prompt', kind: 'text' }] },
    { name: 'labels', kind: 'list' },
  ],
};

function fixture(options: Record<string, unknown>): Partial<BridgeFixture> {
  const base = withLayout({
    version: 2,
    root: {
      id: 'window',
      columns: [
        { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
        { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
        { id: 'right', size: '360px', panels: [{ id: 'stories', type: 'stories', options }] },
      ],
    },
  });
  return {
    ...base,
    layout: { ...base.layout, types: [{ name: 'stories', dir: STORIES_DIR, status: 'read', error: null, json: MANIFEST }] },
    paths: { [`${STORIES_DIR}/list.mjs`]: 'executable' },
    panelData: { stories: { sessions: {}, lastGroup: {} } },
  };
}

// On show, since the panel keeps a box of the same class for a run that gave no list.
const problems = (page: Page): Locator => page.locator('.panel-problems:visible');

test("a type's options are handed to its run, a text as written and a list as its JSON, of objects or of texts", async ({ app }) => {
  const actions = [{ button: 'Research', prompt: '/research {id}' }, { prompt: '/autopilot {id}' }];
  await app.boot(fixture({ count: '10', actions, labels: ['bug', 'chore'] }));
  await expect.poll(() => runs(app, 'stories')).toHaveLength(1);
  const [run] = await runs(app, 'stories');
  expect(run.options).toEqual({ count: '10', actions: JSON.stringify(actions), labels: '["bug","chore"]' });
});

test('a field a list does not declare is said under the panel, by where it is, and the panel does not run', async ({ app, page }) => {
  await app.boot(fixture({ actions: [{ buton: 'Research', prompt: '/research {id}' }] }));
  await expect(problems(page)).toContainText('actions[0].buton is not a field of actions (it has: button, prompt).');
  expect(await runs(app, 'stories')).toEqual([]);
});
