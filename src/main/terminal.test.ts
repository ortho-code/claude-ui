import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The IPC handlers terminal.ts registers, captured so the tests can call them the way the renderer does.
const { handlers, spawned, seq } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  spawned: [] as FakePty[],
  // Never reset, unlike `spawned`: terminal.ts keeps its own map of live ptys across tests, and a recycled pid would have one test's signals counted against another's process.
  seq: { pid: 4000 },
}));

/** Enough of node-pty's IPty to drive the stop paths: a pid to signal, the writes to inspect, and an exit we fire by hand. */
interface FakePty {
  pid: number;
  written: string[];
  exit: (code?: number) => void;
  onData: (cb: (d: string) => void) => void;
  onExit: (cb: (e: { exitCode: number }) => void) => void;
  write: (d: string) => void;
  resize: () => void;
  kill: () => void;
}

// terminal.ts reaches electron and node-pty at import time, and through status.ts it reaches paths.ts, which pins the userData path on import.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/claude-ui-test', setPath: () => {} },
  ipcMain: {
    handle: (channel: string, fn: (...a: unknown[]) => unknown) => handlers.set(channel, fn),
    on: (channel: string, fn: (...a: unknown[]) => unknown) => handlers.set(channel, fn),
  },
}));
vi.mock('node-pty', () => ({
  spawn: () => {
    let onExit: (e: { exitCode: number }) => void = () => {};
    const proc: FakePty = {
      pid: seq.pid++,
      written: [],
      exit: (code = 0) => onExit({ exitCode: code }),
      onData: () => {},
      onExit: (cb) => {
        onExit = cb;
      },
      write: (d: string) => proc.written.push(d),
      resize: () => {},
      kill: () => {},
    };
    spawned.push(proc);
    return proc;
  },
}));

import { claudeArgs, registerTerminalIpc, terminateAll } from './terminal';

const SETTINGS = '/home/u/.config/claude-ui/claude-settings.json';

describe('claudeArgs', () => {
  it('passes the settings file when there is one', () => {
    expect(claudeArgs({ settingsFile: SETTINGS })).toEqual(['--settings', SETTINGS]);
  });

  it('launches bare while the settings file has not been written yet', () => {
    expect(claudeArgs({ settingsFile: null })).toEqual([]);
  });

  it('creates a session under the id it is given', () => {
    const id = '0a945f9c-209b-4758-bf8e-30474af5826c';
    expect(claudeArgs({ settingsFile: null, sessionId: id })).toEqual(['--session-id', id]);
  });

  // A fork is the one launch that carries both ids: claude honours --session-id while resuming, so the copy lands on an id the app chose rather than one it has to be told afterwards.
  it('forks the parent into a session id of our own', () => {
    const id = '994a9944-ebf8-4586-95eb-3bb9fed20f96';
    expect(claudeArgs({ settingsFile: null, sessionId: id, resumeSessionId: 'parent-1', fork: true })).toEqual([
      '--session-id',
      id,
      '--resume',
      'parent-1',
      '--fork-session',
    ]);
  });

  it('resumes a session, and forks only when asked', () => {
    expect(claudeArgs({ settingsFile: null, resumeSessionId: 'abc-123' })).toEqual(['--resume', 'abc-123']);
    expect(claudeArgs({ settingsFile: null, resumeSessionId: 'abc-123', fork: true })).toEqual([
      '--resume',
      'abc-123',
      '--fork-session',
    ]);
  });

  it('ignores a fork with nothing to fork from', () => {
    expect(claudeArgs({ settingsFile: null, fork: true })).toEqual([]);
  });

  it('drops a session id that is not filename-safe, rather than passing it on', () => {
    for (const id of ['a b', 'a;rm -rf /', '../x', '--version', '-w', '']) {
      expect(claudeArgs({ settingsFile: null, resumeSessionId: id })).toEqual([]);
    }
  });

  it('tells the three worktree cases apart', () => {
    expect(claudeArgs({ settingsFile: null, worktree: 'feature' })).toEqual(['-w', 'feature']);
    expect(claudeArgs({ settingsFile: null, worktree: '' })).toEqual(['-w']);
    expect(claudeArgs({ settingsFile: null })).toEqual([]);
  });

  it('keeps a name with spaces and quotes as ONE argument, unescaped', () => {
    // The whole point of passing argv rather than a shell string: no quoting happens here, so none has to be undone later.
    const name = "it's a \"long\" name";
    expect(claudeArgs({ settingsFile: null, name })).toEqual(['--name', name]);
  });

  it('keeps a settings path containing a space intact (macOS Application Support)', () => {
    const mac = '/Users/u/Library/Application Support/claude-ui/claude-settings.json';
    expect(claudeArgs({ settingsFile: mac })).toEqual(['--settings', mac]);
  });

  it('omits an empty name, which claude would reject', () => {
    expect(claudeArgs({ settingsFile: null, name: '' })).toEqual([]);
  });

  it('orders the flags settings, session id, resume, name, worktree', () => {
    expect(
      claudeArgs({
        settingsFile: SETTINGS,
        sessionId: 'new-id',
        resumeSessionId: 'abc',
        fork: true,
        name: 'my thing',
        worktree: 'wt',
      }),
    ).toEqual([
      '--settings',
      SETTINGS,
      '--session-id',
      'new-id',
      '--resume',
      'abc',
      '--fork-session',
      '--name',
      'my thing',
      '-w',
      'wt',
    ]);
  });
});

/**
 * Stopping a session, which is the one thing here that has to be true rather than attempted.
 * A single signal is a REQUEST — `SIGHUP` most of all, which a Node program may decline — and the app used to send one and forget the process, so a stop could report success over a session that was still running.
 */
describe('stopping a session', () => {
  let kill: ReturnType<typeof vi.spyOn>;

  /** Start a session the way the renderer does, and hand back its pty and terminal id. */
  async function start(): Promise<{ proc: FakePty; id: number }> {
    const sender = { isDestroyed: () => false, send: vi.fn() };
    const id = (await handlers.get('terminal:start')!({ sender }, '/tmp', {})) as number;
    return { proc: spawned[spawned.length - 1], id };
  }
  const signals = (pid: number): string[] =>
    kill.mock.calls.filter((c) => c[0] === -pid || c[0] === pid).map((c) => String(c[1]));

  beforeEach(() => {
    vi.useFakeTimers();
    handlers.clear();
    spawned.length = 0;
    registerTerminalIpc();
    // Nothing here has a real process behind it, so the signals are recorded rather than sent.
    kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
  });
  afterEach(() => {
    kill.mockRestore();
    vi.useRealTimers();
  });

  /**
   * A folder that is no longer there is REFUSED. It used to be swapped for the home directory in silence, so a session whose worktree had been removed ran in `~` and then wrote its transcript under the home project, moving in the sidebar.
   * `claude -w` removes its own tree when the session ends, so this is the ordinary fate of a worktree session rather than an edge case.
   */
  it.each([['/definitely/not/here'], ['']])('refuses to start in a folder that is not there (%s)', async (cwd) => {
    const sender = { isDestroyed: () => false, send: vi.fn() };
    await expect(handlers.get('terminal:start')!({ sender }, cwd, {})).rejects.toThrow(/MISSING_CWD/);
    // Nothing was spawned, so there is no pty to leak and nothing to stop.
    expect(spawned).toHaveLength(0);
  });

  it('starts in a folder that IS there', async () => {
    const sender = { isDestroyed: () => false, send: vi.fn() };
    await expect(handlers.get('terminal:start')!({ sender }, process.cwd(), {})).resolves.toEqual(expect.any(Number));
    expect(spawned).toHaveLength(1);
  });

  it('signals the process GROUP, not just the process it spawned', async () => {
    const { proc, id } = await start();
    handlers.get('terminal:kill')!(null, id);
    // The app talks to a shell, not to claude, and claude's MCP servers are below that — so the negative pid is the only form that reaches what we mean to stop.
    expect(kill).toHaveBeenCalledWith(-proc.pid, 'SIGTERM');
  });

  it('escalates to SIGKILL when the session ignores the ask', async () => {
    const { proc, id } = await start();
    handlers.get('terminal:kill')!(null, id);
    expect(signals(proc.pid)).toEqual(['SIGTERM', 'SIGTERM']);
    await vi.advanceTimersByTimeAsync(2000);
    expect(signals(proc.pid)).toEqual(['SIGTERM', 'SIGTERM', 'SIGKILL', 'SIGKILL']);
  });

  // The whole point of reading the pty's exit rather than assuming the signal worked: a session that left politely must not then be killed, because by then the pid may belong to somebody else.
  it('does not escalate against a session that has already exited', async () => {
    const { proc, id } = await start();
    handlers.get('terminal:kill')!(null, id);
    proc.exit();
    await vi.advanceTimersByTimeAsync(2000);
    expect(signals(proc.pid)).not.toContain('SIGKILL');
  });

  it('lets claude exit on its own first when the tab is closed, then insists', async () => {
    const { proc, id } = await start();
    handlers.get('terminal:close')!(null, id);
    // Ctrl-C twice is claude's own way out, which is what writes the transcript.
    expect(proc.written).toEqual(['\x03']);
    await vi.advanceTimersByTimeAsync(500);
    expect(proc.written).toEqual(['\x03', '\x03']);
    expect(signals(proc.pid)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1400);
    expect(signals(proc.pid)).toEqual(['SIGTERM', 'SIGTERM']);
    await vi.advanceTimersByTimeAsync(1300);
    expect(signals(proc.pid)).toContain('SIGKILL');
  });

  it('ignores a second stop rather than starting a second escalation', async () => {
    const { proc, id } = await start();
    handlers.get('terminal:close')!(null, id);
    handlers.get('terminal:close')!(null, id);
    await vi.advanceTimersByTimeAsync(500);
    expect(proc.written).toEqual(['\x03', '\x03']);
  });

  // Quitting used to be its own path, sending one SIGTERM and clearing the table in the same breath — so the app exited without ever checking.
  it('takes every session down the same path when the app quits', async () => {
    const a = await start();
    const b = await start();
    terminateAll();
    expect(signals(a.proc.pid)).toEqual(['SIGTERM', 'SIGTERM']);
    expect(signals(b.proc.pid)).toEqual(['SIGTERM', 'SIGTERM']);
    await vi.advanceTimersByTimeAsync(2000);
    expect(signals(a.proc.pid)).toContain('SIGKILL');
    expect(signals(b.proc.pid)).toContain('SIGKILL');
  });
});
