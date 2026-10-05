import { ipcMain, type WebContents } from 'electron';
import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { configRoot } from './paths';
import { resolvePath } from './config';
import { inheritedEnv, loginShell, shellCommand, terminateGroup, type ShellInvocation } from './shell';
import { log } from './log';
import { formatDuration } from './stamp';
import {
  OPTION_NAME,
  PANEL_OUTPUT_CAP,
  PANEL_TIMEOUT_MS,
  type PanelContext,
  type PanelRunEvent,
  type PanelRunRequest,
  type PanelSource,
  type PanelStderr,
  type PanelStopReason,
} from '../shared/panels';

/**
 * Runs a `command` panel's command and streams what it prints, then makes sure it is gone.
 *
 * NON-INTERACTIVE, SPAWN AND READ: no pty, stdout and stderr in one pipe, a cap on the output and a timeout on the run.
 * A process that never exits by design (a dev server, a watcher) is not this panel type.
 */

/**
 * What the login shell runs for a panel: the command in either form an entry can take, behind a first act that decides where its output goes.
 *
 * The shell is the same interactive login shell a session gets (shell.ts), so `PATH` is identical — and MEASURED without a tty it prints two lines of job-control noise on stderr first, and `logout` on the way out if it is still the parent when the command ends.
 * Both are dealt with by the shape of these lines rather than by filtering text: the shell's own stderr is discarded by the spawn below, the script's first act sends the COMMAND's streams where they belong, and the command is `exec`ed in the shell's place, so nothing is left to say `logout`.
 * MERGED, for a panel that shows what was printed: the command's stderr joins its stdout in the one pipe (`exec 2>&1`), which is also what puts the two streams in true arrival order.
 * APART, for a panel that parses what was printed: the command's stdout and stderr go to pipes of their own, fds 3 and 4, closed again before it runs, and the shell's own stdout is discarded as its stderr is, so nothing an rc file prints can land in front of the result (MEASURED 2026-09-29: rc output on either stream reaches neither pipe).
 * A command LINE is run by a fresh copy of the same shell, so it is parsed as the user typed it; it reaches that shell as `$2`, an argument, never interpolated into either script.
 * A script PATH is `$1`, passed whole: a space in it is nothing to the shell.
 */
const FIRST: Record<PanelStderr, string> = { merged: 'exec 2>&1; ', apart: 'exec 1>&3 2>&4 3>&- 4>&-; ' };
const RUN_LINE = 'exec "$1" -c "$2"';
const RUN_SCRIPT = 'exec "$1"';

/** The spawn's descriptors for each: stdin closed so nothing can wait on it, the shell's own stderr discarded (and, apart, its stdout), and the pipes the first act above writes to. */
const STDIO: Record<PanelStderr, StdioOptions> = { merged: ['ignore', 'pipe', 'ignore'], apart: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] };

/** `$0` for the shell: names the process in any error the shell itself prints. */
const ARG0 = 'claude-ui-panel';

/**
 * The exact spawn for a source.
 * Pure, so a test can pin what reaches the shell.
 */
export function panelInvocation(source: PanelSource, stderr: PanelStderr = 'merged'): ShellInvocation {
  if ('command' in source) return shellCommand(FIRST[stderr] + RUN_LINE, [loginShell(), source.command], ARG0);
  return shellCommand(FIRST[stderr] + RUN_SCRIPT, [resolvePath(source.script, 'config')], ARG0);
}

/**
 * A panel command's environment: the session's minus its marker, plus plain-text output and the context.
 *
 * `CLAUDE_UI` is deliberately NOT set — it is what fires the app's status hooks, and a panel that happens to run `claude -p` must not report as a session.
 * `NO_COLOR` and `TERM=dumb` ask for plain text; the renderer strips escape sequences on top for the tools that do not listen.
 */
export function panelEnv(context: PanelContext, options: Record<string, string> = {}): Record<string, string> {
  const env = inheritedEnv();
  delete env.COLORTERM;
  env.NO_COLOR = '1';
  env.TERM = 'dumb';
  return { ...env, ...contextEnv(context), ...optionEnv(options) };
}

/**
 * A type's options as `CLAUDE_UI_OPTION_<NAME>`, so a script reads them the way it reads the context.
 * A name that could not make a variable's is left out: the renderer's check already refused it, and this is the one place that builds the name.
 */
export function optionEnv(options: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(options)) {
    if (OPTION_NAME.test(name) && typeof value === 'string') env[`CLAUDE_UI_OPTION_${name.toUpperCase()}`] = value;
  }
  return env;
}

/** The context as flat variables, the same set for a command panel's run and a terminal panel's shell. */
export function contextEnv(context: PanelContext): Record<string, string> {
  return {
    CLAUDE_UI_PROJECT_ROOT: context.projectRoot,
    CLAUDE_UI_CWD: context.cwd,
    CLAUDE_UI_SESSION_ID: context.sessionId,
    CLAUDE_UI_CONFIG_ROOT: configRoot,
  };
}

interface Run {
  entryId: string;
  token: string;
  child: ChildProcess;
  sender: WebContents;
  /** Bytes forwarded so far, against the cap. */
  bytes: number;
  /** Set when the app ends the run, so its exit reports as `stopped` with this reason rather than as `exit`. */
  stopReason: PanelStopReason | null;
  /** The process is gone (its `exit` fired); the one fact the escalation reads. */
  exited: boolean;
  /** The final event has been sent; nothing more is forwarded. */
  finished: boolean;
  /** Superseded by a re-run: the entry's surface belongs to the new run, so this one says nothing more. */
  muted: boolean;
  timeout: NodeJS.Timeout;
  /** When it was spawned, for how long a failed run lasted. */
  started: number;
}

/**
 * The current run per entry.
 * A superseded run leaves this map at once and lives on only in its own closures until its process is gone.
 */
const runs = new Map<string, Run>();
/** Every run whose process has not exited, current or superseded: what the quit sweep signals. */
const live = new Set<Run>();

function emit(run: Run, event: PanelRunEvent): void {
  if (run.muted || run.finished || run.sender.isDestroyed()) return;
  run.sender.send('panel:run', run.entryId, run.token, event);
}

/**
 * A run's end, as the log says it — failures only, since a panel runs on every tab switch and a clean run is not news.
 * The panel's id names it, never its command line or output, which are the user's own.
 */
function logRunEnd(run: Run, event: PanelRunEvent): void {
  const after = `after ${formatDuration(Date.now() - run.started)}`;
  if (event.kind === 'stopped' && event.reason === 'timeout') log('warn', 'panel', `${run.entryId} still running at ${formatDuration(PANEL_TIMEOUT_MS)}, stopped`);
  else if (event.kind === 'stopped' && event.reason === 'truncated') log('info', 'panel', `${run.entryId} printed more than the cap, stopped ${after}`);
  else if (event.kind === 'exit' && event.error !== undefined) log('warn', 'panel', `${run.entryId} could not run: ${event.error}`);
  else if (event.kind === 'exit' && (event.code !== 0 || event.signal !== null)) {
    log('warn', 'panel', `${run.entryId} failed: code ${event.code}${event.signal ? `, signal ${event.signal}` : ''}, ${after}`);
  }
}

function finish(run: Run, event: PanelRunEvent): void {
  if (run.finished) return;
  logRunEnd(run, event);
  emit(run, event);
  run.finished = true;
  clearTimeout(run.timeout);
  if (runs.get(run.entryId) === run) runs.delete(run.entryId);
}

/** End a run: ask the group to leave and kill it if it does not, reading whether it left from the child's own exit. */
function stopRun(run: Run, reason: PanelStopReason): void {
  if (run.stopReason !== null || run.exited) return;
  run.stopReason = reason;
  if (reason === 'rerun') run.muted = true;
  if (run.child.pid !== undefined) terminateGroup(run.child.pid, () => !run.exited);
}

/** Start a run for an entry, stopping the one it replaces first. */
export function run(sender: WebContents, request: PanelRunRequest): void {
  const previous = runs.get(request.entryId);
  if (previous) {
    runs.delete(request.entryId);
    stopRun(previous, 'rerun');
  }
  const { cwd } = request.context;
  const tell = (event: PanelRunEvent): void => {
    if (!sender.isDestroyed()) sender.send('panel:run', request.entryId, request.token, event);
  };
  // Refused rather than left to the spawn, whose error would name the shell rather than the folder.
  if (!cwd || !existsSync(cwd)) {
    const error = `${cwd || 'the context directory'} is not there`;
    log('warn', 'panel', `${request.entryId} refused: ${error}`);
    tell({ kind: 'exit', code: null, signal: null, error });
    return;
  }
  // Anything but `apart` is the one pipe, as every run was before the choice existed.
  const stderr: PanelStderr = request.stderr === 'apart' ? 'apart' : 'merged';
  const { file, args } = panelInvocation(request.source, stderr);
  // `detached` puts the child in a session of its own, so its pid is a group id the stop can signal (shell.ts).
  const child = spawn(file, args, {
    cwd,
    env: panelEnv(request.context, request.options),
    detached: true,
    stdio: STDIO[stderr],
  });
  const current: Run = {
    entryId: request.entryId,
    token: request.token,
    child,
    sender,
    bytes: 0,
    stopReason: null,
    exited: false,
    finished: false,
    muted: false,
    timeout: setTimeout(() => stopRun(current, 'timeout'), PANEL_TIMEOUT_MS),
    started: Date.now(),
  };
  runs.set(request.entryId, current);
  live.add(current);

  // Merged, the one pipe is the shell's stdout; apart, the command's two are fds 3 and 4 (see FIRST).
  const sources: [Readable, 'output' | 'stderr'][] =
    stderr === 'merged'
      ? [[child.stdout!, 'output']]
      : [
          [child.stdio[3] as Readable, 'output'],
          [child.stdio[4] as Readable, 'stderr'],
        ];
  // One decoder per pipe across its chunks, so a multibyte character split between two reads still decodes.
  const pipes = sources.map(([stream, kind]) => ({ stream, kind, decoder: new StringDecoder('utf8') }));
  for (const { stream, kind, decoder } of pipes) {
    stream.on('data', (chunk: Buffer) => {
      // One cap for the run, whichever pipe the bytes came down.
      if (current.bytes >= PANEL_OUTPUT_CAP || current.finished) return;
      const room = PANEL_OUTPUT_CAP - current.bytes;
      const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
      current.bytes += kept.length;
      const text = decoder.write(kept);
      if (text) emit(current, { kind, text });
      if (current.bytes >= PANEL_OUTPUT_CAP) {
        emit(current, { kind: 'truncated' });
        stopRun(current, 'truncated');
      }
    });
  }
  child.on('error', (error) => {
    current.exited = true;
    live.delete(current);
    finish(current, { kind: 'exit', code: null, signal: null, error: error.message });
  });
  const ended = (code: number | null, signal: NodeJS.Signals | null): void => {
    for (const { kind, decoder } of pipes) {
      const tail = decoder.end();
      if (tail) emit(current, { kind, text: tail });
    }
    if (current.stopReason !== null) finish(current, { kind: 'stopped', reason: current.stopReason });
    else finish(current, { kind: 'exit', code, signal });
  };
  // `close` is the end of the OUTPUT, which is when the final line has been forwarded; `exit` is the end of the PROCESS, which is what the escalation reads.
  // The two part when something the command started outlives it holding a pipe (a daemon it forked): the leader is gone, so nothing may be signalled any more, and after a moment the pipes are closed from this end so the panel is not left waiting on a process that is not the one it ran.
  let closed = false;
  child.on('close', (code, signal) => {
    closed = true;
    ended(code, signal);
  });
  child.on('exit', (code, signal) => {
    current.exited = true;
    live.delete(current);
    setTimeout(() => {
      if (closed) return;
      for (const { stream } of pipes) stream.destroy();
      ended(code, signal);
    }, 1000);
  });
}

/** Stop an entry's current run, because its panel was hidden or removed. */
export function stop(entryId: string): void {
  const current = runs.get(entryId);
  if (current) stopRun(current, 'request');
}

/** Stop every run that is still going as the app quits, down the same path as any other stop. */
export function stopAllPanels(): void {
  for (const current of [...live]) stopRun(current, 'quit');
}

export function registerPanelsIpc(): void {
  ipcMain.on('panel:run', (event, request: PanelRunRequest) => run(event.sender, request));
  ipcMain.on('panel:stop', (_event, entryId: string) => stop(entryId));
}
