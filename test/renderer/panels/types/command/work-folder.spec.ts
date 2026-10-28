import type { Locator, Page } from '@playwright/test';
import type { SessionCheckout, TerminalLaunch } from '../../../../../src/shared/types';
import { type BridgeFixture, HOME, PROJECT, session } from '../../../support/fixture';
import { type App, expect, test } from '../../../support/harness';
import { row, tabLabel } from '../../../support/window';
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

/** The worktree icon the mark leads with, apart from the star a pick adds. */
const worktreeIcon = (page: Page): Locator => mark(page).locator('.badge-icon:not(.panel-folder-picked) svg');

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
  await expect(worktreeIcon(page)).toBeVisible();
  await expect(mark(page)).toHaveAttribute('data-tooltip', WORKTREE);
});

test('a panel names the main checkout it looks in, muted and without the mark, and the worktree once its session works there', async ({ app, page }) => {
  await app.boot({ ...layout, ...onShow(working('')) });
  await expect(mark(page)).toHaveText('demo');
  await expect(mark(page)).toHaveClass(/\bmain\b/);
  await expect(worktreeIcon(page)).toBeHidden();
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

// A pick from the session's worktree list points the panels at that checkout instead while the session is on show, until "Follow the session" there; while the checkout is gone, it is ignored.

const OTHER = `${PROJECT}/.claude/worktrees/other`;
const checkout = (root: string, at: string, gone = false): SessionCheckout => ({ root, at, gone, own: false });

/** The session on show, in the main checkout, working in `workCwd`, with two worktrees and the main checkout in its list. */
const listing = (workCwd = WORKTREE, otherGone = false): ReturnType<typeof session> =>
  session({ workCwd, checkouts: [checkout(WORKTREE, '2026-10-26T10:00:00.000Z'), checkout(OTHER, '2026-10-26T09:00:00.000Z', otherGone), checkout(PROJECT, '2026-10-26T08:00:00.000Z')] });

/** An entry of the list the session's worktree mark opens. */
const entry = (page: Page, label: string | RegExp): Locator => page.locator('.kebab-menu button', { hasText: label });

/** Open the session's worktree list from its row. */
const openList = (page: Page): Promise<void> => row(page, listing().title).locator('.worktree-badge').click();

/** The star a held pick wears in the panel's header. */
const star = (page: Page): Locator => mark(page).locator('.panel-folder-picked');

test('a pick from the worktree list runs the panel in that checkout, named with a star, and holds while the session works elsewhere, until Follow the session', async ({ app, page }) => {
  await app.boot({ ...layout, ...onShow(listing()) });
  await expect.poll(() => places(app)).toEqual([`${WORKTREE} in ${PROJECT}`]);
  await expect(star(page)).toBeHidden();
  await finish(app);

  await openList(page);
  await entry(page, /^other · /).click();
  await expect.poll(() => places(app)).toEqual([`${WORKTREE} in ${PROJECT}`, `${OTHER} in ${PROJECT}`]);
  await expect(mark(page)).toHaveText('other');
  await expect(star(page)).toBeVisible();
  await expect(mark(page)).toHaveAttribute('data-tooltip', `${OTHER}\nPicked from the session's worktree list; Follow the session there lets go`);
  await finish(app);

  // Claude changes a file in the main checkout: the row's mark says so, and the panel stays where it was picked.
  await app.listOnDisk([listing('')]);
  await expect(row(page, listing().title).locator('.worktree-badge')).toHaveAttribute('data-tooltip', '3 checkouts it worked in — click to list them');
  expect(await places(app)).toHaveLength(2);
  await expect(mark(page)).toHaveText('other');

  await openList(page);
  await expect(entry(page, /^other · /).locator('.menu-tick svg')).toBeVisible();
  await expect(entry(page, 'Follow the session').locator('.menu-tick svg')).toHaveCount(0);
  await entry(page, 'Follow the session').click();
  await expect.poll(() => places(app)).toEqual([`${WORKTREE} in ${PROJECT}`, `${OTHER} in ${PROJECT}`, `${PROJECT} in ${PROJECT}`]);
  await expect(mark(page)).toHaveText('demo');
  await expect(star(page)).toBeHidden();
});

test('a pick is ignored once the listing finds its checkout gone, and the list ticks Follow the session, the gone entry in line', async ({ app, page }) => {
  await app.boot({ ...layout, ...onShow(listing()) });
  await expect.poll(() => places(app)).toHaveLength(1);
  await finish(app);
  await openList(page);
  await entry(page, /^other · /).click();
  await expect.poll(() => places(app)).toHaveLength(2);
  await finish(app);

  await app.listOnDisk([listing(WORKTREE, true)]);
  await expect.poll(() => places(app)).toEqual([`${WORKTREE} in ${PROJECT}`, `${OTHER} in ${PROJECT}`, `${WORKTREE} in ${PROJECT}`]);
  await expect(star(page)).toBeHidden();
  await openList(page);
  await expect(entry(page, 'Follow the session').locator('.menu-tick svg')).toBeVisible();
  await expect(entry(page, /^other · /)).toHaveClass(/\bunavailable\b/);
  await expect(entry(page, /^other · /)).toHaveAttribute('data-tooltip', 'Its folder is gone');
  await expect(entry(page, /^other · /).locator('.menu-tick')).toHaveCount(1);
});

// A `/clear` goes on in a new session, claude's own `/resume` in one that exists (claude-resume.spec.ts); either way the pick was the session before's, so the panels follow the one the tab holds now.
for (const source of ['clear', 'resume']) {
  test(`a pick stays with its session when a /${source} puts another session in the tab`, async ({ app, page }) => {
    const one = listing();
    const next = session({ id: '00000000-0000-4000-8000-0000000000cf', title: 'Another one' });
    await app.boot({ ...layout, ...onShow(one), sessions: [one, next], history: { [one.id]: [], [next.id]: [] } });
    await expect.poll(() => places(app)).toHaveLength(1);
    await finish(app);
    await openList(page);
    await entry(page, /^other · /).click();
    await expect.poll(() => places(app)).toHaveLength(2);
    await finish(app);

    await tabLabel(page, one.title).click();
    await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
    const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
    expect(await app.emit('onTerminalData', 1, 'claude is here')).toBe(1);
    expect(await app.emit('onSessionStart', next.id, launch.tabToken ?? '', source)).toBe(1);
    await expect.poll(async () => (await places(app)).at(-1)).toBe(`${PROJECT} in ${PROJECT}`);
    await expect(star(page)).toBeHidden();
    await finish(app);

    // The session before keeps its pick: on show again, in a tab of its own, the panels look where it was picked.
    await row(page, one.title).click();
    await expect.poll(async () => (await places(app)).at(-1)).toBe(`${OTHER} in ${PROJECT}`);
    await expect(star(page)).toBeVisible();
  });
}

// The pick is the session's, not its tab's, so it is made the same from every surface, a tab or none.
test('a pick for a session without a tab holds once the session is on show', async ({ app, page }) => {
  const one = listing();
  await app.boot({ ...layout, sessions: [one], activeProject: PROJECT, history: { [one.id]: [] } });
  await expect.poll(() => places(app)).toEqual([`${PROJECT} in ${PROJECT}`]);
  await finish(app);
  await openList(page);
  await expect(page.locator('.kebab-menu .menu-header-line')).toHaveText(['Where the panels look', 'A pick holds them there until you follow the session again']);
  await entry(page, /^other · /).click();

  await row(page, one.title).click();
  await expect.poll(async () => (await places(app)).at(-1)).toBe(`${OTHER} in ${PROJECT}`);
  await expect(star(page)).toBeVisible();
});
