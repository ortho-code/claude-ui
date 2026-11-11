import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, promises as fs, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('electron', async () => (await import('./sessions-home')).electronStub);
vi.mock('../../../../src/main/logs/log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/main/logs/log')>()),
  ...(await import('./sessions-home')).logStub,
}));
vi.mock('node:os', async () => (await import('./sessions-home')).osStub);

import { listSessions } from '../../../../src/main/sessions/sessions';
import type { SessionCheckout } from '../../../../src/shared/types';
import { jsonl, logged, projectsDir } from './sessions-home';

// The folder a session works in, which a panel without a `cwd` of its own runs in: the checkout of the newest file claude changed with a file tool.
// Against a real repository with linked worktrees in the temp folder, since which checkout a file is in, and whether git ignores it there, are git's own answers.
describe('the folder a session works in', () => {
  // The person's git config is kept out, the global and the system one and the global excludes file, which would add their own ignores (`~/.config/git/ignore`) to the test repository's.
  const saved: Record<string, string | undefined> = {};
  let repo = '';
  let outside = '';
  let config = '';
  let second = 0;

  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-C', repo, ...args], { stdio: 'ignore' });
  };
  const worktree = (name: string): string => path.join(repo, '.claude', 'worktrees', name);
  const at = (): string => new Date(Date.UTC(2026, 9, 26, 10, 0, second++)).toISOString();
  const change = (file: string, name = 'Edit'): Record<string, unknown> => ({
    type: 'assistant',
    uuid: `work-a${second}`,
    cwd: repo,
    timestamp: at(),
    message: { content: [{ type: 'tool_use', id: `work-t${second}`, name, input: name === 'NotebookEdit' ? { notebook_path: file, new_source: '' } : { file_path: file } }] },
  });
  const enter = (name: string): Record<string, unknown> => ({ type: 'worktree-state', worktreeSession: { originalCwd: repo, worktreePath: worktree(name), worktreeName: name, hookBased: false } });
  const exit = { type: 'worktree-state', worktreeSession: null };
  const sessionIn = (id: string, cwd: string, ...events: unknown[]): Promise<void> =>
    fs.writeFile(path.join(projectsDir, '-work', `${id}.jsonl`), jsonl({ type: 'user', uuid: `work-u-${id}`, cwd, timestamp: at(), message: { content: 'work' } }, ...events));
  const session = (id: string, ...events: unknown[]): Promise<void> => sessionIn(id, repo, ...events);
  const workCwd = async (id: string): Promise<string | undefined> => (await listSessions()).find((s) => s.id === id)?.workCwd;
  const listed = async (id: string): Promise<SessionCheckout[] | undefined> => (await listSessions()).find((s) => s.id === id)?.checkouts;
  // The time each change below was made, by name, for the lists that carry it.
  const stamps: Record<string, string> = {};
  const stamped = (name: string, event: Record<string, unknown>): Record<string, unknown> => {
    stamps[name] = event.timestamp as string;
    return event;
  };

  beforeAll(async () => {
    config = mkdtempSync(path.join(os.tmpdir(), 'claude-ui-work-config-'));
    for (const [name, value] of Object.entries({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', XDG_CONFIG_HOME: config })) {
      saved[name] = process.env[name];
      process.env[name] = value;
    }
    repo = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'claude-ui-work-')));
    git('init', '-q');
    writeFileSync(path.join(repo, '.gitignore'), 'ignored.txt\n/.claude/worktrees\n');
    mkdirSync(path.join(repo, 'src'));
    writeFileSync(path.join(repo, 'src', 'a.txt'), 'a\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'first');
    for (const name of ['wt-a', 'wt-b', 'wt-c', 'wt-d', 'wt-gone']) git('worktree', 'add', '-q', '-b', name, worktree(name));
    // Removed by hand, so git still lists it, as prunable.
    rmSync(worktree('wt-gone'), { recursive: true, force: true });
    // A folder git does not know as a worktree, as one left behind looks.
    mkdirSync(path.join(worktree('wt-left'), 'src'), { recursive: true });
    // A link out of the repository, as a folder of notes kept elsewhere is linked into a checkout.
    outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'claude-ui-work-outside-')));
    symlinkSync(outside, path.join(repo, 'plans'));

    await fs.mkdir(path.join(projectsDir, '-work'), { recursive: true });
    const inA = path.join(worktree('wt-a'), 'src', 'a.txt');
    const inB = path.join(worktree('wt-b'), 'src', 'a.txt');
    // b11ed876's week: its worktree left, as the record claude writes for an exit says, then the work going on in it by path.
    const week = [enter('wt-a'), change(inA), exit, change(inA, 'MultiEdit')];
    await session('work-week', ...week);
    await session('work-ignored', ...week, change(path.join(repo, 'ignored.txt')));
    await session('work-outside', ...week, change(path.join(outside, 'plan.md'), 'Write'), change(path.join(repo, 'plans', 'plan.md')));
    await session('work-tracked', ...week, change(path.join(repo, 'src', 'a.txt')));
    await session('work-own', change(path.join(repo, 'src', 'a.txt')));
    await session('work-entered', change(inA), enter('wt-b'));
    // Claude Code writes an entered state again with each turn while the session is in its worktree.
    await session('work-repeat', enter('wt-a'), change(path.join(repo, 'src', 'a.txt')), enter('wt-a'));
    await session('work-blob', { type: 'api-request-blob', hash: 'h', message: { content: [{ type: 'tool_use', id: 'work-blob-t', name: 'Edit', input: { file_path: inA } }] } });
    await session('work-none', { type: 'assistant', uuid: 'work-none-a', timestamp: at(), message: { content: 'nothing changed' } });
    await session('work-notebook', change(path.join(worktree('wt-b'), 'n.ipynb'), 'NotebookEdit'));
    await session('work-gone', change(inB, 'Write'), change(path.join(worktree('wt-gone'), 'src', 'a.txt')));
    await session('work-left', change(inB), change(path.join(worktree('wt-left'), 'src', 'a.txt')));
    await session('work-removed', change(path.join(worktree('wt-c'), 'src', 'a.txt')));
    // The checkouts a session's worktree mark lists.
    const inMain = path.join(repo, 'src', 'a.txt');
    await session('list-two', stamped('two-a', change(inA)), stamped('two-b', change(inB)));
    await sessionIn('list-own', worktree('wt-a'), stamped('own-main', change(inMain)), stamped('own-b', change(inB)));
    await session('list-left-main', enter('wt-b'), exit, stamped('left-main', change(inMain)));
    await sessionIn('list-left-folder', worktree('wt-left'), change(path.join(worktree('wt-left'), 'src', 'a.txt')));
    await session('list-removed', change(path.join(worktree('wt-d'), 'src', 'a.txt')), change(inA));
    // Its paths reach a worktree, so it is not passed over before git is asked, but git ignores the file it changed there.
    await session('list-ignored-elsewhere', change(inMain), change(path.join(worktree('wt-a'), 'ignored.txt')));
    // A session in a worktree of a repository deleted since, which claude's `.claude/worktrees/` layout still files under that repository.
    const gone = `${repo}-deleted`;
    await fs.writeFile(
      path.join(projectsDir, '-work', 'work-repo-gone.jsonl'),
      jsonl({ type: 'user', uuid: 'work-u-repo-gone', cwd: path.join(gone, '.claude', 'worktrees', 'wt'), timestamp: at(), message: { content: 'work' } }, change(path.join(gone, 'src', 'a.txt'))),
    );
  });

  afterAll(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    for (const dir of [repo, outside, config]) rmSync(dir, { recursive: true, force: true });
  });

  it('follows a session into the worktree it changes files in by path after leaving it, and moves nothing else', async () => {
    const week = (await listSessions()).find((s) => s.id === 'work-week');
    expect(week?.workCwd).toBe(worktree('wt-a'));
    expect([week?.cwd, week?.worktree, week?.leftWorktree]).toEqual([repo, '', 'wt-a']);
  });

  it('passes over a file git ignores, one outside the repository, and one behind a link out of it', async () => {
    expect(await workCwd('work-ignored')).toBe(worktree('wt-a'));
    expect(await workCwd('work-outside')).toBe(worktree('wt-a'));
  });

  it('is the folder the session runs in once it changes a tracked file in that checkout', async () => {
    expect(await workCwd('work-tracked')).toBe('');
    expect(await workCwd('work-own')).toBe('');
  });

  it('gives way to a worktree entered after the last change, but not to an entry repeated', async () => {
    expect(await workCwd('work-entered')).toBe('');
    expect(await workCwd('work-repeat')).toBe(repo);
  });

  it("counts the file tools in claude's own messages, each of them, and not in a request replayed", async () => {
    expect(await workCwd('work-notebook')).toBe(worktree('wt-b'));
    expect(await workCwd('work-blob')).toBe('');
    expect(await workCwd('work-none')).toBe('');
  });

  it('is the folder the session runs in, not an older checkout, when its newest change is in a worktree that is gone', async () => {
    expect(await workCwd('work-gone')).toBe('');
    expect(await workCwd('work-left')).toBe('');
  });

  it('asks git nothing about a repository that is gone, and is the folder the session runs in', async () => {
    expect(await workCwd('work-repo-gone')).toBe('');
    expect(logged.filter((line) => line.includes('checkouts'))).toEqual([]);  });

  it('is the folder the session runs in once the checkout it found is removed', async () => {
    expect(await workCwd('work-removed')).toBe(worktree('wt-c'));
    rmSync(worktree('wt-c'), { recursive: true, force: true });
    expect(await workCwd('work-removed')).toBe('');
  });

  it('lists every checkout a session changed a file in, newest first, each at its newest change there', async () => {
    expect(await listed('list-two')).toEqual([
      { root: worktree('wt-b'), at: stamps['two-b'], gone: false, own: false },
      { root: worktree('wt-a'), at: stamps['two-a'], gone: false, own: false },
    ]);
  });

  it('lists the worktree its badge names, where it runs or that it left, and the main checkout only for a change git shows', async () => {
    expect(await listed('list-own')).toEqual([
      { root: worktree('wt-b'), at: stamps['own-b'], gone: false, own: false },
      { root: repo, at: stamps['own-main'], gone: false, own: false },
      { root: worktree('wt-a'), at: '', gone: false, own: true },
    ]);
    expect(await listed('list-left-main')).toEqual([
      { root: repo, at: stamps['left-main'], gone: false, own: false },
      { root: worktree('wt-b'), at: '', gone: false, own: true },
    ]);
    expect((await listed('work-tracked'))?.map(({ root, own }) => [root, own])).toEqual([[repo, false], [worktree('wt-a'), true]]);
    expect(await listed('work-ignored')).toEqual([]);
  });

  it('lists nothing when there is nothing besides the worktree its badge names, or without a badge the checkout it runs in', async () => {
    expect(await listed('work-week')).toEqual([]);
    expect(await listed('list-left-folder')).toEqual([]);
    expect(await listed('work-own')).toEqual([]);
    expect(await listed('work-none')).toEqual([]);
    expect(await listed('list-ignored-elsewhere')).toEqual([]);
  });

  it('says a checkout removed since the transcript was read is gone, at the next listing', async () => {
    const roots = async (): Promise<[string, boolean][] | undefined> => (await listed('list-removed'))?.map(({ root, gone }) => [root, gone]);
    expect(await roots()).toEqual([[worktree('wt-a'), false], [worktree('wt-d'), false]]);
    rmSync(worktree('wt-d'), { recursive: true, force: true });
    expect(await roots()).toEqual([[worktree('wt-a'), false], [worktree('wt-d'), true]]);
  });
});
