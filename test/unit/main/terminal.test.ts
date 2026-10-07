import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

// The IPC handlers terminal.ts registers, captured so the tests can call them the way the renderer does.
const { handlers, spawned, seq, logged } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  spawned: [] as FakePty[],
  // Never reset, unlike `spawned`: terminal.ts keeps its own map of live ptys across tests, and a recycled pid would have one test's signals counted against another's process.
  seq: { pid: 4000 },
  /** Every log line, as `level area message`; the log itself is not started in tests. */
  logged: [] as string[],
}));

vi.mock('../../../src/main/log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/main/log')>()),
  log: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
}));

/** Enough of node-pty's IPty to drive the stop paths: a pid to signal, the writes to inspect, and an exit we fire by hand — plus what it was spawned with, for the tests that pin that. */
interface FakePty {
  pid: number;
  file: string;
  args: string[];
  options: { cwd: string; env: Record<string, string> };
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
  shell: {},
}));
vi.mock('node-pty', () => ({
  spawn: (file: string, args: string[], options: FakePty['options']) => {
    let onExit: (e: { exitCode: number }) => void = () => {};
    const proc: FakePty = {
      pid: seq.pid++,
      file,
      args,
      options,
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

import { claudeArgs, describeLaunch, registerTerminalIpc, terminateAll } from '../../../src/main/terminal';
import { KILL_GRACE_MS } from '../../../src/main/shell';

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

  it('puts a first prompt last, after -- and after the user’s own flags, so a flag taking several values cannot swallow it', () => {
    expect(claudeArgs({ settingsFile: null, sessionId: 's1', name: 'Review #1', prompt: '/review 1', extra: ['--allowedTools', 'Grep,Glob'] })).toEqual([
      '--session-id',
      's1',
      '--name',
      'Review #1',
      '--allowedTools',
      'Grep,Glob',
      '--',
      '/review 1',
    ]);
    // A prompt that starts with a dash is still the prompt.
    expect(claudeArgs({ settingsFile: null, prompt: '-v is not a flag here' }).slice(-2)).toEqual(['--', '-v is not a flag here']);
    expect(claudeArgs({ settingsFile: null, prompt: '' })).toEqual([]);
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
  let kill: MockInstance<typeof process.kill>;

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
   * A folder that is no longer there is REFUSED.
   * It used to be swapped for the home directory in silence, so a session whose worktree had been removed ran in `~` and then wrote its transcript under the home project, moving in the sidebar.
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
    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS);
    expect(signals(proc.pid)).toEqual(['SIGTERM', 'SIGTERM', 'SIGKILL', 'SIGKILL']);
  });

  // The whole point of reading the pty's exit rather than assuming the signal worked: a session that left politely must not then be killed, because by then the pid may belong to somebody else.
  it('does not escalate against a session that has already exited', async () => {
    const { proc, id } = await start();
    handlers.get('terminal:kill')!(null, id);
    proc.exit();
    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS);
    expect(signals(proc.pid)).not.toContain('SIGKILL');
  });

  // A worktree session left on SIGTERM in 0.75 to 1.52 s across five runs, which a 1.2 s grace cut short.
  it('gives a session as slow to leave as any measured its time before killing it', async () => {
    const { proc, id } = await start();
    handlers.get('terminal:kill')!(null, id);
    await vi.advanceTimersByTimeAsync(1600);
    expect(signals(proc.pid)).not.toContain('SIGKILL');
    proc.exit();
    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS);
    expect(signals(proc.pid)).not.toContain('SIGKILL');
  });

  // Claude may answer an exit with a question, a worktree's keep-or-remove, and waits for the answer: a deadline here would kill the question, and nothing tells asking from slow.
  it('asks claude to leave with Ctrl-C twice, and then waits however long it takes', async () => {
    const { proc, id } = await start();
    handlers.get('terminal:close')!(null, id, false);
    expect(proc.written).toEqual(['\x03']);
    await vi.advanceTimersByTimeAsync(500);
    expect(proc.written).toEqual(['\x03', '\x03']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(proc.written).toEqual(['\x03', '\x03']);
    expect(signals(proc.pid)).toEqual([]);
  });

  // Mid-turn, the first Ctrl-C interrupts the turn and only the next two leave.
  it('presses a third time for a session mid-turn', async () => {
    const { proc, id } = await start();
    handlers.get('terminal:close')!(null, id, true);
    await vi.advanceTimersByTimeAsync(500);
    expect(proc.written).toEqual(['\x03', '\x03']);
    await vi.advanceTimersByTimeAsync(400);
    expect(proc.written).toEqual(['\x03', '\x03', '\x03']);
    expect(signals(proc.pid)).toEqual([]);
  });

  it('writes nothing more once the session has gone', async () => {
    const { proc, id } = await start();
    handlers.get('terminal:close')!(null, id, true);
    proc.exit();
    await vi.advanceTimersByTimeAsync(1000);
    expect(proc.written).toEqual(['\x03']);
  });

  it('forces out a session it has already asked, when told to', async () => {
    const { proc, id } = await start();
    handlers.get('terminal:close')!(null, id, false);
    await vi.advanceTimersByTimeAsync(5000);
    handlers.get('terminal:kill')!(null, id);
    expect(signals(proc.pid)).toEqual(['SIGTERM', 'SIGTERM']);
    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS);
    expect(signals(proc.pid)).toContain('SIGKILL');
  });

  it('ignores a second ask while the first is still pressing', async () => {
    const { proc, id } = await start();
    handlers.get('terminal:close')!(null, id, false);
    handlers.get('terminal:close')!(null, id, false);
    await vi.advanceTimersByTimeAsync(500);
    expect(proc.written).toEqual(['\x03', '\x03']);
  });

  // Esc at claude's question on the way out calls the exit off, and the session works on: a later stop is a new ask, and has to press again.
  it('asks again once the first ask has had its presses', async () => {
    const { proc, id } = await start();
    handlers.get('terminal:close')!(null, id, false);
    await vi.advanceTimersByTimeAsync(5000);
    handlers.get('terminal:close')!(null, id, true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(proc.written).toEqual(['\x03', '\x03', '\x03', '\x03', '\x03']);
  });

  it('ignores a second force rather than starting a second escalation', async () => {
    const { proc, id } = await start();
    handlers.get('terminal:kill')!(null, id);
    handlers.get('terminal:kill')!(null, id);
    expect(signals(proc.pid)).toEqual(['SIGTERM', 'SIGTERM']);
  });

  it('asks nothing of a session it is already forcing out', async () => {
    const { proc, id } = await start();
    handlers.get('terminal:kill')!(null, id);
    handlers.get('terminal:close')!(null, id, false);
    expect(proc.written).toEqual([]);
  });

  /** Start a panel's shell the way the renderer does. */
  const CONTEXT = { projectRoot: '/repo', cwd: process.cwd(), sessionId: 'sess-1' };
  async function startShell(): Promise<{ proc: FakePty; id: number }> {
    const sender = { isDestroyed: () => false, send: vi.fn() };
    const id = (await handlers.get('terminal:startShell')!({ sender }, process.cwd(), CONTEXT)) as number;
    return { proc: spawned[spawned.length - 1], id };
  }

  it('starts a panel shell as the plain interactive login shell, with the context and without the session marker', async () => {
    const { proc } = await startShell();
    expect(proc.file).toBe(process.env.SHELL ?? '/bin/bash');
    // No `-c`: nothing to run, the prompt is the user's own.
    expect(proc.args).toEqual(['-l', '-i']);
    expect(proc.options.cwd).toBe(process.cwd());
    expect(proc.options.env).toMatchObject({
      COLORTERM: 'truecolor',
      CLAUDE_UI_PROJECT_ROOT: '/repo',
      CLAUDE_UI_CWD: process.cwd(),
      CLAUDE_UI_SESSION_ID: 'sess-1',
    });
    // The marker fires the status hooks, so a `claude` typed into the panel must not carry it.
    expect(proc.options.env).not.toHaveProperty('CLAUDE_UI');
  });

  it('a session still carries the marker, which the shell start above must not have loosened', async () => {
    const { proc } = await start();
    expect(proc.args.slice(0, 3)).toEqual(['-l', '-i', '-c']);
    expect(proc.options.env.CLAUDE_UI).toBe('1');
  });

  it('refuses to start a panel shell in a folder that is not there', async () => {
    const sender = { isDestroyed: () => false, send: vi.fn() };
    await expect(handlers.get('terminal:startShell')!({ sender }, '/definitely/not/here', CONTEXT)).rejects.toThrow(/MISSING_CWD/);
    expect(spawned).toHaveLength(0);
  });

  it('stops and sweeps a panel shell exactly as a session', async () => {
    const shell = await startShell();
    handlers.get('terminal:kill')!(null, shell.id);
    expect(signals(shell.proc.pid)).toEqual(['SIGTERM', 'SIGTERM']);
    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS);
    expect(signals(shell.proc.pid)).toContain('SIGKILL');
    const other = await startShell();
    terminateAll();
    expect(signals(other.proc.pid)).toEqual(['SIGTERM', 'SIGTERM']);
  });

  // Quitting used to be its own path, sending one SIGTERM and clearing the table in the same breath — so the app exited without ever checking.
  it('takes every session down the same path when the app quits', async () => {
    const a = await start();
    const b = await start();
    terminateAll();
    expect(signals(a.proc.pid)).toEqual(['SIGTERM', 'SIGTERM']);
    expect(signals(b.proc.pid)).toEqual(['SIGTERM', 'SIGTERM']);
    await vi.advanceTimersByTimeAsync(KILL_GRACE_MS);
    expect(signals(a.proc.pid)).toContain('SIGKILL');
    expect(signals(b.proc.pid)).toContain('SIGKILL');
  });
});

describe('describeLaunch', () => {
  it('names the kind of start and the sessions in it', () => {
    expect(describeLaunch({ sessionId: 'new-1' }, [])).toBe('new session new-1');
    expect(describeLaunch({ resumeSessionId: 'old-1' }, [])).toBe('resume old-1');
    expect(describeLaunch({ sessionId: 'new-2', resumeSessionId: 'old-1', fork: true }, [])).toBe('fork new-2 of old-1');
  });

  it('says a worktree is new but never its name, nor the session name', () => {
    const line = describeLaunch({ sessionId: 'new-1', name: 'Payroll rewrite', worktree: 'payroll' }, []);
    expect(line).toBe('new session new-1, in a new worktree');
    expect(describeLaunch({ sessionId: 'new-1', worktree: '' }, [])).toBe('new session new-1, in a new worktree');
  });

  it('says a session has a first prompt, never what it says', () => {
    expect(describeLaunch({ sessionId: 'new-1', prompt: '/review 35743' }, [])).toBe('new session new-1, with a first prompt');
  });

  it('lists the user flags by name, never their values', () => {
    expect(describeLaunch({ resumeSessionId: 'old-1' }, ['--model', 'opus', '--append-system-prompt=private words'])).toBe(
      'resume old-1, flags --model --append-system-prompt',
    );
  });
});

describe('what a terminal logs', () => {
  const sender = { isDestroyed: () => false, send: vi.fn() };
  const lines = (id: number): string[] => logged.filter((line) => line.startsWith(`info terminal ${id} `) || line.startsWith(`warn terminal ${id} `));

  beforeEach(() => {
    vi.useFakeTimers();
    handlers.clear();
    spawned.length = 0;
    logged.length = 0;
    registerTerminalIpc();
    vi.spyOn(process, 'kill').mockImplementation(() => true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('its start with the pid, and an exit nobody asked for with a failing code as a warning', async () => {
    const id = (await handlers.get('terminal:start')!({ sender }, process.cwd(), { resumeSessionId: 'old-1' })) as number;
    const proc = spawned[spawned.length - 1];
    await vi.advanceTimersByTimeAsync(2500);
    proc.exit(1);
    expect(lines(id)).toEqual([`info terminal ${id} started, pid ${proc.pid}: resume old-1 in ${process.cwd()}`, `warn terminal ${id} ended: code 1, after 2.5 s`]);
  });

  it('a stop, the SIGKILL it needed, and the exit as asked', async () => {
    const id = (await handlers.get('terminal:start')!({ sender }, process.cwd(), {})) as number;
    const proc = spawned[spawned.length - 1];
    handlers.get('terminal:kill')!(null, id);
    await vi.advanceTimersByTimeAsync(3500);
    proc.exit(137);
    expect(lines(id).slice(1)).toEqual([`info terminal ${id} stopping`, `info terminal ${id} ended: code 137, after 3.5 s, as asked`]);
    expect(logged).toContain(`warn process pid ${proc.pid} still running 3000 ms after SIGTERM, sending SIGKILL`);
  });

  it('an ask to leave, how many presses it took, and the exit as asked', async () => {
    const id = (await handlers.get('terminal:start')!({ sender }, process.cwd(), {})) as number;
    const proc = spawned[spawned.length - 1];
    handlers.get('terminal:close')!(null, id, true);
    await vi.advanceTimersByTimeAsync(4000);
    proc.exit(0);
    expect(lines(id).slice(1)).toEqual([`info terminal ${id} asked to leave, Ctrl-C 3 times`, `info terminal ${id} ended: code 0, after 4.0 s, as asked`]);
  });

  it('a start refused because its folder is not there', async () => {
    await expect(handlers.get('terminal:start')!({ sender }, '/definitely/not/here', {})).rejects.toThrow(/MISSING_CWD/);
    expect(logged).toEqual(['warn terminal refused to start: /definitely/not/here is not there']);
  });
});
