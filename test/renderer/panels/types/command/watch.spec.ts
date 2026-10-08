import type { Locator, Page } from '@playwright/test';
import { PROJECT } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { runs, withLayout } from '../../layout/layout';

// A command panel takes `watch: git`, the git working tree of the folder it runs in; in a folder in none, or one git cannot answer for, it says so and does not run.
const layout = withLayout({
  version: 2,
  root: {
    id: 'window',
    columns: [
      { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
      { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
      { id: 'right', size: '360px', panels: [{ id: 'status', type: 'command', title: 'Status', icon: 'git', options: { command: 'git status --short', watch: 'git' } }] },
    ],
  },
});

const problems = (page: Page): Locator => page.locator('.panel-problems');

const SECOND = 1000;
const askedGit = async (app: App): Promise<number> => (await app.calls('panelTree')).length;

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
