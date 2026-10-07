import type { TerminalLaunch } from '../../../../src/shared/types';
import { PROJECT, session } from '../../support/fixture';
import { type App, expect, test } from '../../support/harness';
import { chooseProject, tab, tabLabel, tabLabels } from '../../support/window';
import { LAYOUT, OTHER, railItem, runs, withLayout } from './layout';

test('a change to the layout file keeps a running shell and does not run a command again', async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT));
  await expect.poll(() => app.calls('startShell')).toHaveLength(1);
  await expect.poll(() => runs(app, 'status')).toHaveLength(1);

  const right = LAYOUT.root.columns[2] as { panels: object[] };
  const edited = structuredClone(LAYOUT);
  (edited.root.columns[2] as typeof right).panels = [...right.panels, { id: 'notes', type: 'command', title: 'Notes', icon: 'book', options: { command: 'cat NOTES' } }];
  expect(await app.emit('onLayoutChanged', withLayout(edited).layout)).toBe(1);
  await expect(railItem(page, /^Notes/)).toBeVisible();

  expect(await app.calls('startShell')).toHaveLength(1);
  expect([...(await app.calls('killTerminal')), ...(await app.calls('closeTerminal'))]).toEqual([]);
  expect(await runs(app, 'status')).toHaveLength(1);
  expect(await runs(app, 'notes')).toEqual([]);
});

test('a hidden command does not run on a project switch, runs once when shown somewhere new, and not at all when shown back where it last ran', async ({ app, page }) => {
  await app.boot(withLayout(LAYOUT));
  const folders = async (entry: string): Promise<string[]> => (await runs(app, entry)).map((run) => run.context.cwd);
  await expect.poll(() => folders('status')).toEqual([PROJECT]);
  await railItem(page, /^Checks/).click();
  await expect.poll(() => folders('checks')).toEqual([PROJECT]);

  // Checks on show follows the project; Status behind it stays put.
  await chooseProject(page, 'other');
  await expect.poll(() => folders('checks')).toEqual([PROJECT, OTHER]);
  await chooseProject(page, 'demo');
  await expect.poll(() => folders('checks')).toEqual([PROJECT, OTHER, PROJECT]);
  expect(await folders('status')).toEqual([PROJECT]);

  // Shown in the folder it last ran in: nothing to run again.
  await railItem(page, /^Status/).click();
  await expect(railItem(page, /^Status/)).toHaveClass(/\bshown\b/);
  await chooseProject(page, 'other');
  await expect.poll(() => folders('status')).toEqual([PROJECT, OTHER]);
  // Shown after the project moved while it was hidden: once, in the new folder.
  await railItem(page, /^Checks/).click();
  await expect.poll(() => folders('checks')).toEqual([PROJECT, OTHER, PROJECT, OTHER]);
  expect(await folders('status')).toEqual([PROJECT, OTHER]);
});

// A command beside claude and no shell, so the claudes are the only terminals, numbered from 1 in the order they start.
const besideClaude = {
  version: 2,
  root: {
    id: 'window',
    columns: [
      { id: 'sidebar', size: '320px', panels: [{ id: 'sessions', type: 'sessions' }] },
      { id: 'main', panels: [{ id: 'cli', type: 'claude' }] },
      { id: 'right', size: '360px', panels: [{ id: 'status', type: 'command', title: 'Status', icon: 'git', options: { command: 'git status --short' } }] },
    ],
  },
};

/** Where the Status command has run, in order. */
const foldersOf = async (app: App): Promise<string[]> => (await runs(app, 'status')).map((run) => run.context.cwd);

/** Under which session the Status command has run, in order: none while no tab is on show. */
const sessionsOf = async (app: App): Promise<string[]> => (await runs(app, 'status')).map((run) => run.context.sessionId);

test('the tab on show closing hands the command to the next tab: one run, in its folder, and none in between', async ({ app, page }) => {
  const a = session({ id: '00000000-0000-4000-8000-0000000000d2', title: 'In a', cwd: `${PROJECT}/a` });
  const b = session({ id: '00000000-0000-4000-8000-0000000000d3', title: 'In b', cwd: `${PROJECT}/b` });
  await app.boot({ ...withLayout(besideClaude), sessions: [a, b], activeProject: PROJECT, openSessions: [a.id, b.id], history: { [a.id]: [], [b.id]: [] } });
  const folders = (): Promise<string[]> => foldersOf(app);
  await expect.poll(folders).toEqual([PROJECT]);

  // b running, then a running and on show.
  for (const s of [b, a]) await tabLabel(page, s.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(2);
  await expect.poll(folders).toEqual([PROJECT, b.cwd, a.cwd]);

  // a's claude ending by itself, long after its start, closes its tab, and b comes on show.
  await page.clock.setSystemTime(Date.now() + 60_000);
  expect(await app.emit('onTerminalExit', 2, 0)).toBe(1);
  await expect(tab(page, b.title)).toHaveClass(/\bactive\b/);
  await expect.poll(folders).toEqual([PROJECT, b.cwd, a.cwd, b.cwd]);
});

// The tab on show can be given another session under it: a `/clear` hands the same tab to the session claude goes on as, and a refresh can find the tab's session moved to another folder.
// The command beside it follows, as it does a switch of tab.
test("a /clear in the tab on show runs the command beside it again, once, under the session it goes on as", async ({ app, page }) => {
  const a = session({ id: '00000000-0000-4000-8000-0000000000d4', title: 'Cleared' });
  const next = '00000000-0000-4000-8000-0000000000d5';
  await app.boot({ ...withLayout(besideClaude), sessions: [a], activeProject: PROJECT, openSessions: [a.id], history: { [a.id]: [], [next]: [] } });
  await expect.poll(() => sessionsOf(app)).toEqual(['']);
  await tabLabel(page, a.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await expect.poll(() => sessionsOf(app)).toEqual(['', a.id]);

  const [[, launch]] = (await app.calls('startTerminal')) as [string, TerminalLaunch][];
  expect(await app.emit('onTerminalData', 1, 'claude is here')).toBe(1);
  expect(await app.emit('onSessionStatus', next, 'start', launch.tabToken ?? '', 'SessionStart')).toBe(1);
  await expect(tabLabels(page)).toHaveText(['New: demo']);
  await expect.poll(() => sessionsOf(app)).toEqual(['', a.id, next]);
});

test("the tab on show's session found in another folder runs the command beside it again, there", async ({ app, page }) => {
  const a = session({ id: '00000000-0000-4000-8000-0000000000d6', title: 'Moving' });
  const moved = { ...a, cwd: `${PROJECT}/worktrees/feature`, worktree: 'feature' };
  await app.boot({ ...withLayout(besideClaude), sessions: [a], activeProject: PROJECT, openSessions: [a.id], history: { [a.id]: [] } });
  await tabLabel(page, a.title).click();
  await expect.poll(() => app.calls('startTerminal')).toHaveLength(1);
  await expect.poll(() => foldersOf(app)).toEqual([PROJECT, a.cwd]);

  await app.listOnDisk([moved]);
  await expect.poll(() => foldersOf(app)).toEqual([PROJECT, a.cwd, moved.cwd]);
});
