import { ipcMain, type WebContents } from 'electron';
import * as pty from 'node-pty';
import { existsSync } from 'node:fs';
import { SCOPE_ENV, TAB_ENV, statusSettingsFile } from './status';
import { inheritedEnv, loginShell, shellCommand, terminateGroup } from './shell';
import { contextEnv } from './panels';
import { flagNames, parseLaunchFlags } from '../shared/flags';
import { settingsNow } from './settings';
import { log } from './log';
import { formatDuration } from './stamp';
import type { TerminalLaunch } from '../shared/types';
import type { PanelContext } from '../shared/panels';

const terminals = new Map<number, pty.IPty>();
/** Sessions asked to leave since they started, so their exit is logged as asked for. */
const asked = new Set<number>();
/** Sessions whose ask is still pressing, so a second ask cannot add presses to the first. */
const pressing = new Set<number>();
/** Sessions being forced out, so a second force cannot restart the escalation behind the first. */
const forced = new Set<number>();
let nextId = 1;

/** How far apart the presses of an ask to leave are: inside the window in which claude takes a second Ctrl-C as "exit". */
const PRESS_GAP_MS = 400;

/**
 * Ask a session to leave the way it is left in a terminal, and wait for it to go, however long that takes.
 *
 * Ctrl-C twice is claude's own way out from its prompt; mid-turn the first press interrupts the turn instead, so `interrupt` adds one in front.
 * NO DEADLINE, deliberately: claude can answer an exit with a question — a worktree with changes asks whether to keep it — and waits for the answer (still asking after 15 s, the longest measured), and nothing it sends tells asking from slow.
 * A timer here once sent `SIGTERM` 1.8 s after the first press, which killed that question, and ended every stop of a session mid-turn, which the two presses alone did not end in either run probed.
 * So a session that has not gone is the user's to force (`forceOut`).
 * The presses are bytes written to the pty, which claude reads as keys while it holds the terminal in raw mode.
 * Only one ask presses at a time, since presses added to a question already on screen would answer it; once they are done, another ask presses again, because Esc at that question calls the exit off and the session works on.
 */
function askToLeave(id: number, interrupt: boolean): void {
  const proc = terminals.get(id);
  if (!proc || pressing.has(id) || forced.has(id)) return;
  asked.add(id);
  pressing.add(id);
  const presses = interrupt ? 3 : 2;
  log('info', 'terminal', `${id} asked to leave, Ctrl-C ${presses} times`);
  proc.write('\x03');
  for (let press = 1; press < presses; press++) {
    setTimeout(() => {
      // Gone already: a key sent after the exit would reach nothing, or a pty node-pty has closed.
      if (terminals.has(id)) proc.write('\x03');
      if (press === presses - 1) pressing.delete(id);
    }, press * PRESS_GAP_MS);
  }
}

/**
 * End a session or a shell outright, and make sure it actually ended: `SIGTERM` to the group, and `SIGKILL` for anything still there after the grace period.
 *
 * ONE implementation for every way a process here is ended without being asked — a forced stop, a panel shell's stop, and the sweep at app quit.
 * They used to differ, and each sent a single signal and forgot the process: `SIGHUP` by default, which a Node program is entitled to decline, leaving the app certain it had stopped something that was still running.
 * Whether it worked is read from `terminals`, which only the pty's own exit removes from — so the escalation is driven by the process actually being gone, not by having sent something.
 * A session already asked to leave can still be forced: that is what forcing is for.
 */
function forceOut(id: number): void {
  const proc = terminals.get(id);
  if (!proc || forced.has(id)) return;
  forced.add(id);
  log('info', 'terminal', `${id} stopping`);
  terminateGroup(proc.pid, () => terminals.has(id));
}

/** What anything in a pty gets: the inherited environment, advertising 24-bit colour so claude emits its full TUI styling (e.g. the select-menu highlight) instead of a degraded fallback; the frontend xterm renders truecolor fine. */
function ptyEnv(): Record<string, string> {
  const env = inheritedEnv();
  env.COLORTERM = 'truecolor';
  return env;
}

/** A session's environment: a pty's, marked as claude-ui's so the status hook reports it. */
function sessionEnv(): Record<string, string> {
  const env = ptyEnv();
  env[SCOPE_ENV] = '1';
  return env;
}

/**
 * Give a spawned pty an id, route its output and exit to the window that asked, and record it as live.
 * ONE place for a session's `claude` and a panel's shell alike, so both are stopped by the same escalation and swept at quit by the same pass — and logged the same way, `what` saying which it is.
 */
function spawnPty(sender: WebContents, what: string, file: string, args: string[], cwd: string, env: Record<string, string>): number {
  const id = nextId++;
  const started = Date.now();
  const proc = pty.spawn(file, args, {
    // xterm.js speaks 256-colour/truecolor; the old 'xterm-color' (8-colour) terminfo made claude pick a degraded palette for its TUI.
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd,
    env,
  });
  terminals.set(id, proc);
  // The pid is what the stop escalation's own lines name (shell.ts), so it is here to match them against.
  log('info', 'terminal', `${id} started, pid ${proc.pid}: ${what} in ${cwd}`);
  proc.onData((data) => {
    if (!sender.isDestroyed()) sender.send('terminal:data', id, data);
  });
  // The pty's own exit is the ONE place a session is recorded as over.
  // Everything that stops one reads this rather than assuming its signal worked.
  proc.onExit(({ exitCode, signal }) => {
    const expected = asked.has(id) || forced.has(id);
    terminals.delete(id);
    asked.delete(id);
    pressing.delete(id);
    forced.delete(id);
    // An exit nobody asked for, with a failing code, is the one worth finding again; a stop's code is whatever the signal left.
    const how = `code ${exitCode}${signal ? `, signal ${signal}` : ''}, after ${formatDuration(Date.now() - started)}`;
    log(expected || exitCode === 0 ? 'info' : 'warn', 'terminal', `${id} ended: ${how}${expected ? ', as asked' : ''}`);
    if (!sender.isDestroyed()) sender.send('terminal:exit', id, exitCode);
  });
  return id;
}

/**
 * How a session's start reads in the log: which kind of start, the sessions involved, and the user's own flags by NAME.
 * A session's name and a worktree's are the user's words, like its prompts, so neither is written; nor is a flag's value.
 */
export function describeLaunch(launch: TerminalLaunch, extra: string[]): string {
  let what: string;
  if (launch.fork && launch.resumeSessionId) what = `fork ${launch.sessionId ?? '(no id)'} of ${launch.resumeSessionId}`;
  else if (launch.resumeSessionId) what = `resume ${launch.resumeSessionId}`;
  else what = `new session ${launch.sessionId ?? '(no id)'}`;
  if (launch.worktree !== undefined) what += ', in a new worktree';
  // That there is one, never what it says.
  if (launch.prompt) what += ', with a first prompt';
  const names = flagNames(extra);
  if (names.length > 0) what += `, flags ${names.join(' ')}`;
  return what;
}

/** A start refused because its folder is not there, logged before the renderer is told. */
function refuseMissing(cwd: string): never {
  log('warn', 'terminal', `refused to start: ${cwd ? `${cwd} is not there` : 'no folder given'}`);
  throw new Error(`MISSING_CWD:${cwd}`);
}

/** What a session is launched with: the renderer's request plus the parts only the main process knows. */
export interface LaunchOptions extends TerminalLaunch {
  /** claude-ui's own settings file, or null when it has not been written yet. */
  settingsFile: string | null;
  /**
   * The user's default flags, already parsed (see flags.ts).
   * Appended last.
   */
  extra?: string[];
}

/**
 * The argument list handed to `claude`, in order.
 *
 * These are real argv entries, never a shell string, so nothing here needs quoting or escaping: a name with a space or an apostrophe, and macOS's `~/Library/Application Support` path, all arrive as one argument each.
 * Pure so it can be tested without spawning anything.
 */
export function claudeArgs(opts: LaunchOptions): string[] {
  const args: string[] = [];
  // Load claude-ui's status hooks from its own settings file (merges with the user's ~/.claude hooks) so we never write into the user's settings.json.
  if (opts.settingsFile) args.push('--settings', opts.settingsFile);
  // The id the session is CREATED under, so the app never has to ask claude which session a tab is running.
  // claude documents this as `<uuid>` and refuses an id that is already in use, so the caller passes one only for a session that does not exist yet — a uuid it minted, never a value read back off disk.
  if (opts.sessionId) args.push('--session-id', opts.sessionId);
  // Session ids are filename-derived; only pass through safe characters.
  // The first character must be alphanumeric: `-` is legal later in an id, but an id that STARTS with one would reach claude as a flag rather than as the value of --resume.
  const safeId =
    opts.resumeSessionId && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(opts.resumeSessionId) ? opts.resumeSessionId : null;
  if (safeId) {
    args.push('--resume', safeId);
    // `--fork-session` copies the resumed transcript into a new session id (a fork); it needs an id to resume from, so it only applies when we have one.
    if (opts.fork) args.push('--fork-session');
  }
  // `--name` sets the session's display name (claude writes it as a custom-title, so the sidebar picks it up).
  if (opts.name) args.push('--name', opts.name);
  // `-w` starts the session in a new git worktree: a non-empty string names it, `''` lets claude auto-name, `undefined` means no worktree.
  if (opts.worktree !== undefined) {
    args.push('-w');
    if (opts.worktree) args.push(opts.worktree);
  }
  // The user's own flags go last, so a repeated flag resolves in their favour on any flag claude takes last-wins.
  // The ones that would break the app are refused before they can be saved, so nothing here can displace what is above.
  if (opts.extra) args.push(...opts.extra);
  // The first prompt is the positional argument, after `--` and after everything else: a flag taking several values (`--allowedTools Grep,Glob`) swallows a prompt that follows it without one, and a prompt starting with `-` would read as a flag (both MEASURED 2026-09-29).
  if (opts.prompt) args.push('--', opts.prompt);
  return args;
}

/**
 * What the pty's shell runs (an interactive login shell, see shell.ts — that is what runs the rc files that put mise, direnv and the MCP servers' tools on `PATH`, like a real terminal).
 *
 * `"$@"` is the whole point: the flags reach claude as the shell's positional parameters (passed after this string, with `claude` standing in as `$0`) rather than being interpolated into this command, so no user-supplied value is ever parsed as shell syntax.
 * When claude exits, the shell exits too (no trailing `exec bash`), so the pty closes and the renderer can close the tab instead of leaving a bare shell behind.
 */
const SHELL_COMMAND = 'claude "$@"';

export function registerTerminalIpc(): void {
  // Async only for the settings read: the user's default flags live in meta.json, and a session has to be launched with the flags as they are NOW, not as they were when the app started.
  ipcMain.handle('terminal:start', async (event, cwd: string, launch: TerminalLaunch): Promise<number> => {
    // A DIRECTORY THAT IS NOT THERE IS REFUSED, never quietly swapped for the home directory.
    // The old fallback did exactly that, and said nothing: a session whose folder had been removed started in `~`, and then wrote its transcript under the HOME project, so it moved in the sidebar as well.
    // The only visible sign was Claude Code asking for workspace trust on a directory nobody had chosen.
    // HOW OFTEN depends entirely on how somebody works, so it is not worth guessing: on the machine this was written on exactly one resolved directory was missing, because a session that LEAVES a `claude -w` worktree records its original cwd and the reader follows that.
    // Somebody who removes trees while sessions still point INTO them meets it constantly.
    // Refusing here rather than only in the UI, so nothing can reach a spawn by another route.
    if (!cwd || !existsSync(cwd)) refuseMissing(cwd);
    // Guard on the settings file's existence in case the app is mid-startup and installStatusHooks() hasn't written it yet.
    // Flags either settings file gives are checked when they are read, and a refused value is never in force, so these parse; read per start, so an edit of either file counts from the next session on.
    const extra = parseLaunchFlags((await settingsNow()).launchFlags).tokens;
    const claudeFlags = claudeArgs({
      ...launch,
      settingsFile: existsSync(statusSettingsFile) ? statusSettingsFile : null,
      extra,
    });
    // `claude` is `$0`: it names the process in any error the shell itself prints, and it is not passed on to claude.
    const { file: shell, args } = shellCommand(SHELL_COMMAND, claudeFlags, 'claude');
    const env = sessionEnv();
    // Marks the terminal rather than the session, so the hook can still say which tab reported after `/clear` has replaced the session in it.
    if (launch.tabToken) env[TAB_ENV] = launch.tabToken;
    return spawnPty(event.sender, describeLaunch(launch, extra), shell, args, cwd, env);
  });

  // A PLAIN SHELL, for a terminal panel: the same interactive login shell a session runs `claude` in, with nothing to run, so the prompt is the user's own.
  // It gets the panel's context in its environment and NOT the session marker: a `claude` started by hand in it must not report as one of the app's sessions.
  // Same refusal of a missing folder, same pty path, so it is stopped and swept exactly as a session is.
  // Async like `terminal:start`, so a refusal reaches the renderer as a rejection either way.
  // eslint-disable-next-line @typescript-eslint/require-await -- async for the rejection above, with nothing to await
  ipcMain.handle('terminal:startShell', async (event, cwd: string, context: PanelContext): Promise<number> => {
    if (!cwd || !existsSync(cwd)) refuseMissing(cwd);
    return spawnPty(event.sender, 'panel shell', loginShell(), ['-l', '-i'], cwd, { ...ptyEnv(), ...contextEnv(context) });
  });

  ipcMain.on('terminal:input', (_event, id: number, data: string) => {
    terminals.get(id)?.write(data);
  });

  ipcMain.on('terminal:resize', (_event, id: number, cols: number, rows: number) => {
    terminals.get(id)?.resize(cols, rows);
  });

  // End it now: a forced stop, or a panel shell, which has no exit of its own to be asked through.
  ipcMain.on('terminal:kill', (_event, id: number) => forceOut(id));

  // Ask claude to leave through its own exit, which is where it asks anything it has to; `interrupt` for a session mid-turn.
  ipcMain.on('terminal:close', (_event, id: number, interrupt: boolean) => askToLeave(id, interrupt));
}

/**
 * Stop every live session as the app quits.
 * Forced, not asked: the window is going, so a question claude asked on its way out would have nobody to answer it, and a worktree it would have asked about is kept.
 * Down the same path as any other forced stop, so quitting cannot be the one route that leaves something running — `before-quit` delays the quit itself, which is what gives the escalation room to land.
 */
export function terminateAll(): void {
  if (terminals.size > 0) log('info', 'terminal', `quitting: stopping ${terminals.size} terminal${terminals.size === 1 ? '' : 's'}`);
  for (const id of [...terminals.keys()]) forceOut(id);
}

/** How many sessions and shells have not exited yet, for the quit to wait on. */
export function liveTerminals(): number {
  return terminals.size;
}
