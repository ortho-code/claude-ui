import type { Locator, Page } from '@playwright/test';
import type { NodeState } from '../../../../../src/shared/panels';
import type { Found } from '../../../../../src/shared/pathcheck';
import { type BridgeFixture, CONFIG_ROOT } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { chooseProject } from '../../../support/window';
import { railItem, runs, withLayout } from '../../layout/layout';

// How a list panel's runs start and end, whatever asked for them: each is checked first, and once a run starts, the run it replaced lands nothing more.
const QUEUE_DIR = `${CONFIG_ROOT}/types/reviews`;
const SCRIPT = `${QUEUE_DIR}/list.sh`;

/** The queue alone in its group, or on show with a command behind it, so either can be put out of sight; with `nodes`, the app's file beside the layout holding them. */
function layout(behind = false, nodes?: Record<string, NodeState>): ReturnType<typeof withLayout> {
  const queue = { id: 'queue', type: 'reviews' };
  const other = { id: 'other', type: 'command', title: 'Other', icon: 'check', options: { command: 'make check' } };
  const base = withLayout(
    {
      version: 2,
      root: {
        id: 'window',
        columns: [
          { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
          { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
          { id: 'right', size: '360px', panels: behind ? [queue, other] : [queue] },
        ],
      },
    },
    nodes,
  );
  const manifest = { version: 1, kind: 'list', title: 'Reviews', icon: 'eye', run: 'list.sh' };
  return { ...base, layout: { ...base.layout, types: [{ name: 'reviews', dir: QUEUE_DIR, status: 'read', error: null, json: manifest }] } };
}

/** The queue's layout with its data, and its script there unless `found` says otherwise. */
const fixture = (behind = false, found: Found = 'executable'): Partial<BridgeFixture> => ({ ...layout(behind), paths: { [SCRIPT]: found }, panelData: { queue: { sessions: {}, lastGroup: {} } } });

/** What main finds at the queue's script from now on, without telling the window. */
const scriptIs = (page: Page, found: Found): Promise<void> => page.evaluate(([path, what]) => void (window.__claudeUiFixture.paths[path] = what), [SCRIPT, found] as const);

/** A list of one row, as the queue's script prints it. */
const listOf = (text: string): string => JSON.stringify({ version: 1, sections: [{ items: [{ key: text, text }] }] });

/** Send run `token` of the queue a list of one row and its end. */
async function finish(app: App, token: string, text: string): Promise<void> {
  await app.emit('onPanelRun', 'queue', token, { kind: 'output', text: listOf(text) });
  await app.emit('onPanelRun', 'queue', token, { kind: 'exit', code: 0, signal: null });
}

// On show, since the panel keeps a box of the same class for a run that gave no list.
const problems = (page: Page): Locator => page.locator('.panel-problems:visible');

// A run asked for while the one before it is still being checked takes its place, and the one it overtook never starts.
test('a list run overtaken while main is still answering its check never starts', async ({ app, page }) => {
  await app.boot(fixture());
  await expect.poll(() => runs(app, 'queue')).toHaveLength(1);

  const checked = (await app.calls('checkPath')).length;
  await app.hold('checkPath');
  const refresh = page.getByRole('button', { name: 'Refresh' });
  await refresh.click();
  await refresh.click();
  await expect.poll(async () => (await app.calls('checkPath')).length).toBe(checked + 2);
  await app.release('checkPath');

  // Only the second press's run starts: both checks are answered at once, in order, so an overtaken run that started would already be there beside it.
  await expect.poll(() => runs(app, 'queue')).toHaveLength(2);
  expect(await runs(app, 'queue')).toHaveLength(2);
});

test('a list panel without an interval that could not run runs once a change in the config folder finds it can', async ({ app, page }) => {
  await app.boot(fixture(false, 'missing'));
  await expect(problems(page)).toHaveText('types/reviews: run list.sh not found.');
  expect(await runs(app, 'queue')).toEqual([]);

  await scriptIs(page, 'executable');
  expect(await app.emit('onLayoutChanged', layout().layout)).toBe(1);
  await expect.poll(() => runs(app, 'queue')).toHaveLength(1);
  await expect(problems(page)).toBeHidden();
});

test('a list panel that cannot run looks again when it is shown, and runs once it can', async ({ app, page }) => {
  await app.boot(fixture(true));
  await expect.poll(() => runs(app, 'queue')).toHaveLength(1);

  // Out of sight, its script goes, and a change in the config folder has it check again, which changes its icon.
  await railItem(page, /^Other/).click();
  await expect(railItem(page, /^Other/)).toHaveClass(/\bshown\b/);
  const icon = (): Promise<string> => railItem(page, /^Reviews/).locator('svg').innerHTML();
  const own = await icon();
  await scriptIs(page, 'missing');
  // The app's file holding what the click kept: Other as the pick.
  expect(await app.emit('onLayoutChanged', layout(true, { right: { active: 'other' } }).layout)).toBe(1);
  await expect.poll(icon).not.toBe(own);
  await expect(railItem(page, /^Other/)).toHaveClass(/\bshown\b/);

  // Its script back with nothing said: being shown is what looks again, and it runs again.
  await scriptIs(page, 'executable');
  await railItem(page, /^Reviews/).click();
  await expect.poll(() => runs(app, 'queue')).toHaveLength(2);
  await expect(problems(page)).toBeHidden();
});

test('a list panel with nowhere to run says so, and runs once a project is picked', async ({ app, page }) => {
  await app.boot({ ...fixture(), activeProject: null });
  const pick = page.getByText('Pick a project to run this in.');
  await expect(pick).toBeVisible();
  expect(await runs(app, 'queue')).toEqual([]);

  await chooseProject(page, 'demo');
  await expect.poll(() => runs(app, 'queue')).toHaveLength(1);
  await expect(pick).toBeHidden();
});

test('a list panel taken out of the layout file while it runs stops its run, and one whose run has ended stops nothing', async ({ app, page }) => {
  await app.boot(fixture(true));
  await expect.poll(() => runs(app, 'queue')).toHaveLength(1);
  await railItem(page, /^Other/).click();
  await expect.poll(() => runs(app, 'other')).toHaveLength(1);
  const { token } = (await runs(app, 'other')).at(-1)!;
  expect(await app.emit('onPanelRun', 'other', token, { kind: 'exit', code: 0, signal: null })).toBe(1);

  // Both gone from the file, the queue still running and Other done.
  const without = withLayout({ version: 2, root: { id: 'window', columns: [{ id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] }, { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] }] } });
  expect(await app.emit('onLayoutChanged', without.layout)).toBe(1);
  await expect(railItem(page, /^Reviews/)).toHaveCount(0);
  expect(await app.calls('stopPanel')).toEqual([['queue']]);
});

test("a replaced run's late list and end never land in the panel", async ({ app, page }) => {
  await app.boot(fixture());
  await expect.poll(() => runs(app, 'queue')).toHaveLength(1);
  const [first] = await runs(app, 'queue');
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => runs(app, 'queue')).toHaveLength(2);
  const second = (await runs(app, 'queue')).at(-1)!;

  await finish(app, first.token, 'From the first');
  await expect(page.getByText('Waiting for the first run…')).toBeVisible();
  await finish(app, second.token, 'From the second');
  await expect(page.locator('.list-row')).toHaveText(['From the second']);
});
