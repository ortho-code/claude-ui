import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { EventEmitter } from 'node:events';

// The IPC handlers panels.ts registers, and every child it spawns, captured so the tests can drive them the way the renderer and the OS do.
const { handlers, spawned, seq, logged } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  spawned: [] as FakeChild[],
  // Never reset: panels.ts keeps its own map of live runs across tests, and a recycled pid would have one test's signals counted against another's process.
  seq: { pid: 7000 },
  /** Every log line as `level area message`; the log itself is not started in tests. */
  logged: [] as string[],
}));

vi.mock('./log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./log')>()),
  log: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
}));

/** Enough of a ChildProcess to drive a run: a pid to signal, a stdout to feed, and an exit we fire by hand. */
interface FakeChild extends EventEmitter {
  pid: number;
  file: string;
  args: string[];
  options: { cwd: string; env: Record<string, string>; detached: boolean; stdio: unknown };
  stdout: EventEmitter & { destroy: () => void };
  /** What the OS would do: the process ends, `exit` first and `close` once the pipe drains. */
  end: (code: number | null, signal?: NodeJS.Signals | null) => void;
}

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/claude-ui-test', setPath: () => {} },
  ipcMain: {
    handle: (channel: string, fn: (...a: unknown[]) => unknown) => handlers.set(channel, fn),
    on: (channel: string, fn: (...a: unknown[]) => unknown) => handlers.set(channel, fn),
  },
  shell: { openPath: async () => '' },
}));
vi.mock('node:child_process', () => ({
  spawn: (file: string, args: string[], options: FakeChild['options']) => {
    const child = new EventEmitter() as FakeChild;
    child.pid = seq.pid++;
    child.file = file;
    child.args = args;
    child.options = options;
    child.stdout = Object.assign(new EventEmitter(), { destroy: vi.fn() });
    child.end = (code, signal = null) => {
      child.emit('exit', code, signal);
      child.emit('close', code, signal);
    };
    spawned.push(child);
    return child;
  },
}));

import { registerPanelsIpc, stopAllPanels, panelInvocation, panelEnv } from './panels';
import { PANEL_OUTPUT_CAP, PANEL_TIMEOUT_MS, type PanelRunEvent, type PanelRunRequest } from '../shared/panels';

const CONTEXT = { projectRoot: process.cwd(), cwd: process.cwd(), sessionId: 'sess-1' };
const SHELL = process.env.SHELL ?? '/bin/bash';

describe('what reaches the shell', () => {
  it('runs a command line through the interactive login shell, as an argument to a fresh copy of it', () => {
    const line = 'git status --short; echo "done" | wc -l';
    expect(panelInvocation({ command: line })).toEqual({
      file: SHELL,
      // `$1` is the shell that parses the line, `$2` the line itself: nothing here was assembled from it.
      args: ['-l', '-i', '-c', 'exec 2>&1; exec "$1" -c "$2"', 'claude-ui-panel', SHELL, line],
    });
  });

  it('passes a script path as ONE argument, resolved against the config folder, spaces and all', () => {
    const { args } = panelInvocation({ script: 'scripts/my status.sh' });
    // The mocked `app.getPath` answers `/tmp/claude-ui-test` for the data directory, so the config folder sits right under it.
    expect(args.slice(-2)).toEqual(['claude-ui-panel', '/tmp/claude-ui-test/config/scripts/my status.sh']);
    expect(args[3]).toBe('exec 2>&1; exec "$1"');
  });

  it('leaves an absolute script path where it is', () => {
    const { args } = panelInvocation({ script: '/opt/tools/status' });
    expect(args.at(-1)).toBe('/opt/tools/status');
  });

  it('asks for plain text, names the context, and does NOT mark the run as a claude-ui session', () => {
    const env = panelEnv({ projectRoot: '/repo', cwd: '/repo/wt', sessionId: 'abc' });
    expect(env).toMatchObject({
      NO_COLOR: '1',
      TERM: 'dumb',
      CLAUDE_UI_PROJECT_ROOT: '/repo',
      CLAUDE_UI_CWD: '/repo/wt',
      CLAUDE_UI_SESSION_ID: 'abc',
      CLAUDE_UI_CONFIG_ROOT: '/tmp/claude-ui-test/config',
    });
    // The marker is what fires the status hooks; a panel that runs `claude -p` must not report as a session.
    expect(env).not.toHaveProperty('CLAUDE_UI');
    expect(env).not.toHaveProperty('COLORTERM');
  });
});

describe('a run', () => {
  let kill: MockInstance<typeof process.kill>;
  let sent: { entryId: string; token: string; event: PanelRunEvent }[];
  const sender = {
    isDestroyed: () => false,
    send: (_channel: string, entryId: string, token: string, event: PanelRunEvent) => sent.push({ entryId, token, event }),
  };
  let tokens = 0;

  /** Start a run the way the renderer does, and hand back its child and token. */
  function start(over: Partial<PanelRunRequest> = {}): { child: FakeChild; token: string } {
    const token = `run-${++tokens}`;
    handlers.get('panel:run')!({ sender }, { entryId: 'status', token, source: { command: 'true' }, context: CONTEXT, ...over });
    return { child: spawned[spawned.length - 1], token };
  }
  const signals = (pid: number): string[] =>
    kill.mock.calls.filter((c) => c[0] === -pid || c[0] === pid).map((c) => String(c[1]));
  const events = (token: string): PanelRunEvent[] => sent.filter((s) => s.token === token).map((s) => s.event);
  const text = (token: string): string =>
    events(token)
      .map((e) => (e.kind === 'output' ? e.text : ''))
      .join('');

  beforeEach(() => {
    vi.useFakeTimers();
    handlers.clear();
    spawned.length = 0;
    sent = [];
    logged.length = 0;
    registerPanelsIpc();
    kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });
  afterEach(() => {
    stopAllPanels();
    kill.mockRestore();
    vi.useRealTimers();
  });

  it('spawns detached in the context directory with the shell’s own stderr discarded', () => {
    const { child } = start();
    expect(child.options.cwd).toBe(process.cwd());
    expect(child.options.detached).toBe(true);
    expect(child.options.stdio).toEqual(['ignore', 'pipe', 'ignore']);
  });

  it('forwards output under the run’s token and reports the exit code', () => {
    const { child, token } = start();
    child.stdout.emit('data', Buffer.from(' M tracked\n'));
    child.stdout.emit('data', Buffer.from('?? untracked\n'));
    child.end(3);
    expect(events(token)).toEqual([
      { kind: 'output', text: ' M tracked\n' },
      { kind: 'output', text: '?? untracked\n' },
      { kind: 'exit', code: 3, signal: null },
    ]);
  });

  it('decodes a multibyte character split across two reads', () => {
    const { child, token } = start();
    const bytes = Buffer.from('é');
    child.stdout.emit('data', bytes.subarray(0, 1));
    child.stdout.emit('data', bytes.subarray(1));
    child.end(0);
    expect(text(token)).toBe('é');
  });

  it('cuts the output at the cap, says so, and stops the process', () => {
    const { child, token } = start();
    child.stdout.emit('data', Buffer.alloc(PANEL_OUTPUT_CAP - 10, 'a'));
    child.stdout.emit('data', Buffer.alloc(100, 'b'));
    // The chunk that crosses the cap is cut at it, not dropped and not forwarded whole.
    expect(text(token)).toHaveLength(PANEL_OUTPUT_CAP);
    expect(events(token).at(-1)).toEqual({ kind: 'truncated' });
    expect(signals(child.pid)).toEqual(['SIGTERM', 'SIGTERM']);
    // Anything more is dropped while the stop lands.
    child.stdout.emit('data', Buffer.from('late'));
    expect(text(token)).toHaveLength(PANEL_OUTPUT_CAP);
    child.end(null, 'SIGTERM');
    expect(events(token).at(-1)).toEqual({ kind: 'stopped', reason: 'truncated' });
  });

  it('stops a run that is still going at the timeout, and reports why', async () => {
    const { child, token } = start();
    await vi.advanceTimersByTimeAsync(PANEL_TIMEOUT_MS - 1);
    expect(signals(child.pid)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(signals(child.pid)).toEqual(['SIGTERM', 'SIGTERM']);
    child.end(null, 'SIGTERM');
    expect(events(token).at(-1)).toEqual({ kind: 'stopped', reason: 'timeout' });
  });

  it('escalates to SIGKILL when the process ignores the ask, and not when it has left', async () => {
    const stubborn = start({ entryId: 'a' });
    const polite = start({ entryId: 'b' });
    await vi.advanceTimersByTimeAsync(PANEL_TIMEOUT_MS);
    polite.child.end(null, 'SIGTERM');
    await vi.advanceTimersByTimeAsync(2000);
    expect(signals(stubborn.child.pid)).toEqual(['SIGTERM', 'SIGTERM', 'SIGKILL', 'SIGKILL']);
    // By now that pid may belong to somebody else.
    expect(signals(polite.child.pid)).toEqual(['SIGTERM', 'SIGTERM']);
  });

  it('a re-run stops the run before it and silences its tail', () => {
    const first = start();
    const second = start();
    expect(signals(first.child.pid)).toEqual(['SIGTERM', 'SIGTERM']);
    expect(signals(second.child.pid)).toEqual([]);
    // Output the old process still had in flight belongs to nobody now; the new run's is the entry's.
    first.child.stdout.emit('data', Buffer.from('stale'));
    second.child.stdout.emit('data', Buffer.from('fresh'));
    first.child.end(null, 'SIGTERM');
    expect(events(first.token)).toEqual([]);
    expect(text(second.token)).toBe('fresh');
  });

  it('stops an entry’s run on request', () => {
    const { child, token } = start();
    handlers.get('panel:stop')!(null, 'status');
    expect(signals(child.pid)).toEqual(['SIGTERM', 'SIGTERM']);
    child.end(null, 'SIGTERM');
    expect(events(token).at(-1)).toEqual({ kind: 'stopped', reason: 'request' });
  });

  it('takes every live run down at quit, superseded ones included', () => {
    const a = start({ entryId: 'a' });
    const b = start({ entryId: 'b' });
    const c = start({ entryId: 'b' });
    kill.mockClear();
    stopAllPanels();
    expect(signals(a.child.pid)).toEqual(['SIGTERM', 'SIGTERM']);
    // `b` was already asked to leave by `c` replacing it; asking twice would restart its escalation.
    expect(signals(b.child.pid)).toEqual([]);
    expect(signals(c.child.pid)).toEqual(['SIGTERM', 'SIGTERM']);
  });

  it('refuses a context directory that is not there, naming it, and spawns nothing', () => {
    const { token } = start({ context: { ...CONTEXT, cwd: '/definitely/not/here' } });
    expect(spawned).toHaveLength(0);
    expect(events(token)).toEqual([{ kind: 'exit', code: null, signal: null, error: '/definitely/not/here is not there' }]);
  });

  it('reports a spawn that fails as an exit with the error', () => {
    const { child, token } = start();
    child.emit('error', new Error('spawn /bin/bash ENOENT'));
    expect(events(token)).toEqual([{ kind: 'exit', code: null, signal: null, error: 'spawn /bin/bash ENOENT' }]);
  });

  it('logs a failing run by its panel id and how long it took, and a clean one not at all', async () => {
    const clean = start({ entryId: 'clean' });
    clean.child.end(0);
    const failing = start({ entryId: 'failing', source: { command: 'secret-tool lookup token' } });
    await vi.advanceTimersByTimeAsync(1500);
    failing.child.end(2);
    expect(logged).toEqual(['warn panel failing failed: code 2, after 1.5 s']);
    // The command line is the user's own words.
    expect(logged.join('\n')).not.toContain('secret-tool');
  });

  it('logs a timeout, a spawn that fails and a refused folder', async () => {
    const slow = start({ entryId: 'slow' });
    await vi.advanceTimersByTimeAsync(PANEL_TIMEOUT_MS);
    slow.child.end(null, 'SIGTERM');
    start({ entryId: 'broken' }).child.emit('error', new Error('spawn /bin/bash ENOENT'));
    start({ entryId: 'nowhere', context: { ...CONTEXT, cwd: '/definitely/not/here' } });
    expect(logged).toEqual([
      'warn panel slow still running at 30.0 s, stopped',
      'warn panel broken could not run: spawn /bin/bash ENOENT',
      'warn panel nowhere refused: /definitely/not/here is not there',
    ]);
  });

  it('logs nothing for a run the app stopped on purpose', () => {
    const first = start();
    start();
    first.child.end(null, 'SIGTERM');
    handlers.get('panel:stop')!(null, 'status');
    spawned[spawned.length - 1].end(null, 'SIGTERM');
    expect(logged).toEqual([]);
  });

  it('ends the run a moment after the process when something it started keeps the pipe open', async () => {
    const { child, token } = start();
    child.stdout.emit('data', Buffer.from('out\n'));
    child.emit('exit', 0, null);
    expect(events(token).at(-1)).toEqual({ kind: 'output', text: 'out\n' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(events(token).at(-1)).toEqual({ kind: 'exit', code: 0, signal: null });
    expect(child.stdout.destroy).toHaveBeenCalled();
    // The leader is gone, so the timeout must not signal a pid that may have been reused.
    await vi.advanceTimersByTimeAsync(PANEL_TIMEOUT_MS);
    expect(signals(child.pid)).toEqual([]);
  });

  it('sends nothing to a window that has gone', () => {
    const gone = { isDestroyed: () => true, send: vi.fn() };
    handlers.get('panel:run')!({ sender: gone }, { entryId: 'x', token: 't', source: { command: 'true' }, context: CONTEXT });
    spawned[0].stdout.emit('data', Buffer.from('hi'));
    spawned[0].end(0);
    expect(gone.send).not.toHaveBeenCalled();
  });
});
