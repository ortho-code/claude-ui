import type { Locator, Page } from '@playwright/test';
import { PROJECT } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { chooseProject } from '../../../support/window';
import { OTHER, railItem, runs, withLayout } from '../../layout/layout';

// A command panel takes `watch: git`, the git working tree of the folder it runs in: it runs again when that tree changes, looked at every 30 s, shown or not.
// In a folder in none, or one git cannot answer for, it says so and does not run.

/** Status watching git, alone in its group, or behind Other, so it is out of sight. */
function withStatus(behind = false): ReturnType<typeof withLayout> {
  const status = { id: 'status', type: 'command', title: 'Status', icon: 'git', options: { command: 'git status --short', watch: 'git' } };
  const other = { id: 'other', type: 'command', title: 'Other', icon: 'check', options: { command: 'make check' } };
  return withLayout({
    version: 2,
    root: {
      id: 'window',
      columns: [
        { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
        { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
        { id: 'right', size: '360px', panels: behind ? [other, status] : [status] },
      ],
    },
  });
}
const layout = withStatus();

const problems = (page: Page): Locator => page.locator('.panel-problems');

const SECOND = 1000;
const POLL = 30 * SECOND;
const askedGit = async (app: App): Promise<number> => (await app.calls('panelTree')).length;

/** The working tree at `dir` as git would now report it, without telling the window. */
const treeIs = (page: Page, dir: string, fingerprint: string): Promise<void> =>
  page.evaluate(([at, print]) => void (window.__claudeUiFixture.trees[at] = print), [dir, fingerprint] as const);

/** Let `looks` looks at the tree go by, one at a time, since each is set when the one before has answered. */
async function looks(page: Page, count: number): Promise<void> {
  for (let at = 0; at < count; at++) await page.clock.fastForward(POLL);
}

/** End Status's latest run. */
async function finish(app: App): Promise<void> {
  const { token } = (await runs(app, 'status')).at(-1)!;
  await app.emit('onPanelRun', 'status', token, { kind: 'exit', code: 0, signal: null });
}

test('a change in the watched tree runs the panel again once the next look finds it still, and not before', async ({ app, page }) => {
  await page.clock.install();
  await app.boot({ ...layout, trees: { [PROJECT]: 'clean' } });
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  await finish(app);

  await treeIs(page, PROJECT, 'edited');
  await looks(page, 1);
  expect(await runs(app, 'status')).toHaveLength(1);
  await looks(page, 1);
  await expect.poll(() => runs(app, 'status')).toHaveLength(2);
});

test('a burst of changes is one run, once the tree has been still for a look', async ({ app, page }) => {
  await page.clock.install();
  await app.boot({ ...layout, trees: { [PROJECT]: 'clean' } });
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  await finish(app);

  for (const print of ['one', 'two', 'three']) {
    await treeIs(page, PROJECT, print);
    await looks(page, 1);
  }
  expect(await runs(app, 'status')).toHaveLength(1);
  await looks(page, 1);
  await expect.poll(() => runs(app, 'status')).toHaveLength(2);
  await finish(app);
  await looks(page, 3);
  expect(await runs(app, 'status')).toHaveLength(2);
});

test('what a run changes in the tree itself runs nothing', async ({ app, page }) => {
  await page.clock.install();
  await app.boot({ ...layout, trees: { [PROJECT]: 'clean' } });
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  await finish(app);
  await looks(page, 1);

  // A formatter, say: the pressed run writes into the tree, and goes on long enough for several looks.
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => runs(app, 'status')).toHaveLength(2);
  await treeIs(page, PROJECT, 'formatted');
  await looks(page, 3);
  expect(await runs(app, 'status')).toHaveLength(2);
  await finish(app);
  await looks(page, 4);
  expect(await runs(app, 'status')).toHaveLength(2);
});

test('a change runs a panel out of sight too', async ({ app, page }) => {
  await page.clock.install();
  await app.boot({ ...withStatus(true), trees: { [PROJECT]: 'clean' } });
  // Behind Other and never shown, so its first look takes the tree as it is.
  await looks(page, 1);
  expect(await runs(app, 'status')).toEqual([]);

  await treeIs(page, PROJECT, 'edited');
  await looks(page, 2);
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  await expect(railItem(page, /^Status/)).not.toHaveClass(/\bshown\b/);
});

test('a switch to another folder is no change: a panel out of sight that ran in the first runs in the second only once shown again', async ({ app, page }) => {
  await page.clock.install();
  await app.boot({ ...withStatus(true), trees: { [PROJECT]: 'clean', [OTHER]: 'other tree' } });
  const folders = async (): Promise<string[]> => (await runs(app, 'status')).map((run) => run.context.cwd);
  await railItem(page, /^Status/).click();
  await expect.poll(folders).toEqual([PROJECT]);
  await finish(app);
  await railItem(page, /^Other/).click();
  await looks(page, 1);

  await chooseProject(page, 'other');
  await looks(page, 4);
  expect(await folders()).toEqual([PROJECT]);

  await railItem(page, /^Status/).click();
  await expect.poll(folders).toEqual([PROJECT, OTHER]);
});

test('a panel taken out of the layout file asks git nothing more', async ({ app, page }) => {
  await page.clock.install();
  await app.boot({ ...layout, trees: { [PROJECT]: 'clean' } });
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  await finish(app);
  const without = withLayout({ version: 2, root: { id: 'window', columns: [{ id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] }, { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] }] } });
  expect(await app.emit('onLayoutChanged', without.layout)).toBe(1);
  const asked = await askedGit(app);
  await looks(page, 5);
  expect(await askedGit(app)).toBe(asked);
});

test('a command panel watching git in a folder in no working tree says so, asks nothing again on its own, and runs on a Refresh once it is one', async ({ app, page }) => {
  await page.clock.install();
  await app.boot(layout);
  await expect(problems(page)).toHaveText(`watch: git, but ${PROJECT} is not in a git working tree; press Refresh once it is.`);
  expect(await runs(app, 'status')).toEqual([]);
  // A definite answer: nothing asks again on its own.
  const asked = await askedGit(app);
  await page.clock.fastForward(10 * 60 * SECOND);
  expect(await askedGit(app)).toBe(asked);

  await page.evaluate((dir) => void (window.__claudeUiFixture.trees[dir] = 'clean'), PROJECT);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  await expect(problems(page)).toHaveCount(0);
});

test('a command panel whose git does not answer says why, in git’s words, asks again every 30 s three times, then waits for a Refresh, which asks afresh', async ({ app, page }) => {
  await page.clock.install();
  await app.boot({ ...layout, trees: { [PROJECT]: { error: 'fatal: bad config line 1 in file .git/config' } } });
  await expect(problems(page)).toContainText(`watch: git, but git could not look at ${PROJECT}: fatal: bad config line 1 in file .git/config.`);
  await expect(problems(page)).toContainText('Trying again in 30 s (retry 1 of 3).');
  // Once each 30 s, and not again on the redraw each new line brings.
  let asked = await askedGit(app);
  for (const retry of [2, 3]) {
    await page.clock.fastForward(30 * SECOND);
    await expect(problems(page)).toContainText(`Trying again in 30 s (retry ${retry} of 3).`);
    expect(await askedGit(app)).toBe(asked + 1);
    asked += 1;
  }
  await page.clock.fastForward(30 * SECOND);
  await expect(problems(page)).toContainText('Tried 3 more times; press Refresh to try again.');
  expect(await askedGit(app)).toBe(asked + 1);
  asked += 1;

  await page.clock.fastForward(10 * 60 * SECOND);
  expect(await askedGit(app)).toBe(asked);
  expect(await runs(app, 'status')).toEqual([]);

  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(problems(page)).toContainText('Trying again in 30 s (retry 1 of 3).');
});

test('a command panel whose git answers on a retry runs, and its problem goes', async ({ app, page }) => {
  await page.clock.install();
  await app.boot({ ...layout, trees: { [PROJECT]: { error: 'error: timed out' } } });
  await expect(problems(page)).toContainText('Trying again in 30 s (retry 1 of 3).');
  await page.evaluate((dir) => void (window.__claudeUiFixture.trees[dir] = 'clean'), PROJECT);
  await page.clock.fastForward(30 * SECOND);
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  await expect(problems(page)).toHaveCount(0);
});

test('a command panel watching git in a working tree runs as any other does', async ({ app, page }) => {
  await app.boot({ ...layout, trees: { [PROJECT]: 'clean' } });
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);
  await expect(problems(page)).toHaveCount(0);
});
