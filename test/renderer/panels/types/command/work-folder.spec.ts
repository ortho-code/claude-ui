import type { Locator, Page } from '@playwright/test';
import { type BridgeFixture, HOME, PROJECT, session } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { runs, withLayout } from '../../layout/layout';

// A panel without a folder of its own runs where its tab's session works: the checkout of the newest file claude changed, which main reads from the transcript (`workCwd`), and the session's own folder while that is where it works.
// A command line, since one without a `cwd` asks main nothing before it runs.

const WORKTREE = `${PROJECT}/.claude/worktrees/fix`;

/** The session on show, in the project's main checkout, working in `workCwd`. */
const working = (workCwd: string): ReturnType<typeof session> => session({ workCwd });

/** Booted with `one` open and on show, its history empty, as a tab on show reads it. */
const onShow = (one: ReturnType<typeof session>): Partial<BridgeFixture> => ({ sessions: [one], openSessions: [one.id], activeSession: one.id, history: { [one.id]: [] } });

const layout = withLayout({
  version: 2,
  root: {
    id: 'window',
    columns: [
      { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
      { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
      { id: 'right', size: '360px', panels: [{ id: 'status', type: 'command', title: 'Status', icon: 'git', options: { command: 'git status --short' } }] },
    ],
  },
});

/** The mark in the panel's header naming the folder it looks in. */
const mark = (page: Page): Locator => page.locator('.panel-header .panel-folder');

/** The folders Status's runs went to, in order, and the project each was handed. */
const places = async (app: App): Promise<string[]> => (await runs(app, 'status')).map(({ context }) => `${context.cwd} in ${context.projectRoot}`);

/** End Status's latest run, so the next is a run of its own rather than a restart. */
async function finish(app: App): Promise<void> {
  const { token } = (await runs(app, 'status')).at(-1)!;
  await app.emit('onPanelRun', 'status', token, { kind: 'exit', code: 0, signal: null });
}

test('a panel runs in the worktree its tab’s session works in, handed the project it belongs to', async ({ app }) => {
  const one = working(WORKTREE);
  await app.boot({ ...layout, ...onShow(one) });
  await expect.poll(() => places(app)).toEqual([`${WORKTREE} in ${PROJECT}`]);
});

test('a panel follows its tab’s session into the worktree it starts working in, and back out', async ({ app }) => {
  const one = working('');
  await app.boot({ ...layout, ...onShow(one) });
  await expect.poll(() => places(app)).toEqual([`${PROJECT} in ${PROJECT}`]);
  await finish(app);

  await app.listOnDisk([working(WORKTREE)]);
  await expect.poll(() => places(app)).toEqual([`${PROJECT} in ${PROJECT}`, `${WORKTREE} in ${PROJECT}`]);
  await finish(app);

  await app.listOnDisk([working('')]);
  await expect.poll(() => places(app)).toEqual([`${PROJECT} in ${PROJECT}`, `${WORKTREE} in ${PROJECT}`, `${PROJECT} in ${PROJECT}`]);
});

// Where the panel looks is named in its header, always, so it says so before anything has moved as well as after.

test('a panel names the worktree it looks in, in the accent with the worktree mark, with its whole path on hover', async ({ app, page }) => {
  await app.boot({ ...layout, ...onShow(working(WORKTREE)) });
  await expect(mark(page)).toHaveText('fix');
  await expect(mark(page)).not.toHaveClass(/\bmain\b/);
  await expect(mark(page).locator('svg')).toBeVisible();
  await expect(mark(page)).toHaveAttribute('data-tooltip', WORKTREE);
});

test('a panel names the main checkout it looks in, muted and without the mark, and the worktree once its session works there', async ({ app, page }) => {
  await app.boot({ ...layout, ...onShow(working('')) });
  await expect(mark(page)).toHaveText('demo');
  await expect(mark(page)).toHaveClass(/\bmain\b/);
  await expect(mark(page).locator('svg')).toBeHidden();
  await expect(mark(page)).toHaveAttribute('data-tooltip', PROJECT);

  await app.listOnDisk([working(WORKTREE)]);
  await expect(mark(page)).toHaveText('fix');
  await expect(mark(page)).not.toHaveClass(/\bmain\b/);
});

test('a panel with a folder of its own names none, since no tab moves it', async ({ app, page }) => {
  const notes = `${HOME}/notes`;
  const fixed = withLayout({
    version: 2,
    root: {
      id: 'window',
      columns: [
        { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
        { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
        { id: 'right', size: '360px', panels: [{ id: 'status', type: 'command', title: 'Status', icon: 'git', options: { command: 'git status --short', cwd: '~/notes' } }] },
      ],
    },
  });
  await app.boot({ ...fixed, ...onShow(working(WORKTREE)), paths: { [notes]: 'directory' } });
  await expect.poll(() => places(app)).toEqual([`${notes} in ${PROJECT}`]);
  await expect(mark(page)).toBeHidden();
});
