import type { Locator, Page } from '@playwright/test';
import type { NodeState } from '../../../../../src/shared/panels';
import type { Found } from '../../../../../src/shared/pathcheck';
import { CONFIG_ROOT } from '../../../support/fixture';
import { expect, test } from '../../../support/harness';
import { chooseProject } from '../../../support/window';
import { railItem, runs, withLayout } from '../../layout/layout';

// How a command panel's runs start and end, whatever asked for them: each is checked first, and once a run starts, the run it replaced lands nothing more.
// A script, since a command line without a `cwd` asks main nothing, so its check never waits on main and never finds anything missing.
const SCRIPT = `${CONFIG_ROOT}/scripts/status.sh`;

/** Status alone in its group, or on show with Other behind it, so either can be put out of sight; with `nodes`, the app's file beside the layout holding them. */
function layout(behind = false, nodes?: Record<string, NodeState>): ReturnType<typeof withLayout> {
  const status = { id: 'status', type: 'command', title: 'Status', icon: 'git', options: { script: 'scripts/status.sh' } };
  const other = { id: 'other', type: 'command', title: 'Other', icon: 'check', options: { command: 'make check' } };
  return withLayout(
    {
      version: 2,
      root: {
        id: 'window',
        columns: [
          { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
          { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
          { id: 'right', size: '360px', panels: behind ? [status, other] : [status] },
        ],
      },
    },
    nodes,
  );
}

const withScript = (behind = false): ReturnType<typeof withLayout> & { paths: Record<string, Found> } => ({ ...layout(behind), paths: { [SCRIPT]: 'executable' } });

/** What main finds at Status's script from now on, without telling the window. */
const scriptIs = (page: Page, found: Found): Promise<void> => page.evaluate(([path, what]) => void (window.__claudeUiFixture.paths[path] = what), [SCRIPT, found] as const);

const problems = (page: Page): Locator => page.locator('.panel-problems');
const output = (page: Page): Locator => page.locator('.panel-output:visible');

// A run asked for while the one before it is still being checked takes its place, and the one it overtook never starts.
test('a command run overtaken while main is still answering its check never starts', async ({ app, page }) => {
  await app.boot(withScript());
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);

  const checked = (await app.calls('checkPath')).length;
  await app.hold('checkPath');
  const refresh = page.getByRole('button', { name: 'Refresh' });
  await refresh.click();
  await refresh.click();
  await expect.poll(async () => (await app.calls('checkPath')).length).toBe(checked + 2);
  await app.release('checkPath');

  // Only the second press's run starts: both checks are answered at once, in order, so an overtaken run that started would already be there beside it.
  await expect.poll(() => runs(app, 'status')).toHaveLength(2);
  expect(await runs(app, 'status')).toHaveLength(2);
});

test('a command panel that could not run runs once a change in the config folder finds it can', async ({ app, page }) => {
  await app.boot(layout());
  await expect(problems(page)).toHaveText('scripts/status.sh not found.');
  expect(await runs(app, 'status')).toEqual([]);

  await scriptIs(page, 'executable');
  expect(await app.emit('onLayoutChanged', layout().layout)).toBe(1);
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  await expect(problems(page)).toBeHidden();
});

test('a command panel that cannot run looks again when it is shown, and runs once it can', async ({ app, page }) => {
  await app.boot(withScript(true));
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);

  // Out of sight, its script goes, and a change in the config folder has it check again, which changes its icon.
  await railItem(page, /^Other/).click();
  await expect(railItem(page, /^Other/)).toHaveClass(/\bshown\b/);
  const icon = (): Promise<string> => railItem(page, /^Status/).locator('svg').innerHTML();
  const own = await icon();
  await scriptIs(page, 'missing');
  // The app's file holding what the click kept: Other as the pick.
  expect(await app.emit('onLayoutChanged', layout(true, { right: { active: 'other' } }).layout)).toBe(1);
  await expect.poll(icon).not.toBe(own);
  await expect(railItem(page, /^Other/)).toHaveClass(/\bshown\b/);

  // Its script back with nothing said: being shown is what looks again, and it runs again.
  await scriptIs(page, 'executable');
  await railItem(page, /^Status/).click();
  await expect.poll(() => runs(app, 'status')).toHaveLength(2);
  await expect(problems(page)).toBeHidden();
});

test('a command panel with nowhere to run says so, and runs once a project is picked', async ({ app, page }) => {
  await app.boot({ ...withScript(), activeProject: null });
  const pick = page.getByText('Pick a project to run this in.');
  await expect(pick).toBeVisible();
  expect(await runs(app, 'status')).toEqual([]);

  await chooseProject(page, 'demo');
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  await expect(pick).toBeHidden();
});

test('a command panel taken out of the layout file while it runs stops its run, and one whose run has ended stops nothing', async ({ app, page }) => {
  await app.boot(withScript(true));
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  await railItem(page, /^Other/).click();
  await expect.poll(() => runs(app, 'other')).toHaveLength(1);
  const { token } = (await runs(app, 'other')).at(-1)!;
  expect(await app.emit('onPanelRun', 'other', token, { kind: 'exit', code: 0, signal: null })).toBe(1);

  // Both gone from the file, Status still running and Other done.
  const without = withLayout({ version: 2, root: { id: 'window', columns: [{ id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] }, { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] }] } });
  expect(await app.emit('onLayoutChanged', without.layout)).toBe(1);
  await expect(railItem(page, /^Status/)).toHaveCount(0);
  expect(await app.calls('stopPanel')).toEqual([['status']]);
});

test("a replaced run's late output and end never land in the panel", async ({ app, page }) => {
  await app.boot(withScript(true));
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  const [first] = await runs(app, 'status');
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => runs(app, 'status')).toHaveLength(2);
  const second = (await runs(app, 'status')).at(-1)!;

  await app.emit('onPanelRun', 'status', first.token, { kind: 'output', text: 'from the first\n' });
  await app.emit('onPanelRun', 'status', first.token, { kind: 'exit', code: 1, signal: null });
  await app.emit('onPanelRun', 'status', second.token, { kind: 'output', text: 'from the second\n' });
  await expect(output(page)).toHaveText('from the second\n');
  await expect(page.locator('.panel-end')).toHaveText('');
  await expect(railItem(page, /^Status/).locator('.nudge')).toBeHidden();
});
