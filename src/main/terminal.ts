import { ipcMain, type WebContents } from 'electron';
import * as pty from 'node-pty';
import { existsSync } from 'node:fs';
import { SCOPE_ENV, TAB_ENV, statusSettingsFile } from './status';
import { inheritedEnv, shellCommand, terminateGroup } from './shell';
import { parseLaunchFlags } from '../shared/flags';
import { getSettings } from './meta';
import type { TerminalLaunch } from '../shared/types';

const terminals = new Map<number, pty.IPty>();
/** Sessions already on their way out, so a second press cannot restart the escalation behind the first. */
const ending = new Set<number>();
let nextId = 1;

/**
 * End a session, and then make sure it actually ended.
 *
 * ONE implementation for all three ways a session stops — the tab's stop button, closing a tab, and the sweep at app quit — because they differ only in whether `claude` is given its own exit path first.
 * They used to differ in more than that, and each sent a single signal and forgot the process: `SIGHUP` by default, which a Node program is entitled to decline, leaving the app certain it had stopped something that was still running.
 *
 * `flush` writes Ctrl-C twice so `claude` exits the way it does in a terminal and writes its transcript. Without it the session is asked to leave at once.
 * Either way the ask is a `SIGTERM` to the group, and anything still there after the grace period gets `SIGKILL`.
 * Whether it worked is read from `terminals`, which only the pty's own exit removes from — so the escalation is driven by the process actually being gone, not by having sent something.
 */
function endSession(id: number, flush: boolean): void {
  const proc = terminals.get(id);
  if (!proc || ending.has(id)) return;
  ending.add(id);
  const { pid } = proc;
  const insist = (): void => terminateGroup(pid, () => terminals.has(id));
  if (!flush) {
    insist();
    return;
  }
  proc.write('\x03');
  setTimeout(() => proc.write('\x03'), 400);
  setTimeout(insist, 1800);
}

/** What anything in a pty gets: the inherited environment, advertising 24-bit colour so claude emits its full TUI styling (e.g. the select-menu highlight) instead of a degraded fallback; the frontend xterm renders truecolor fine. */
function ptyEnv(): { [key: string]: string } {
  const env = inheritedEnv();
  env.COLORTERM = 'truecolor';
  return env;
}

/** A session's environment: a pty's, marked as claude-ui's so the status hook reports it. */
function sessionEnv(): { [key: string]: string } {
  const env = ptyEnv();
  env[SCOPE_ENV] = '1';
  return env;
}

/**
 * Give a spawned pty an id, route its output and exit to the window that asked, and record it as live.
 * ONE place for a session's `claude` and a panel's shell alike, so both are stopped by the same escalation and swept at quit by the same pass.
 */
function spawnPty(sender: WebContents, file: string, args: string[], cwd: string, env: { [key: string]: string }): number {
  const id = nextId++;
  const proc = pty.spawn(file, args, {
    // xterm.js speaks 256-colour/truecolor; the old 'xterm-color' (8-colour) terminfo made claude pick a degraded palette for its TUI.
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd,
    env,
  });
  terminals.set(id, proc);
  proc.onData((data) => {
    if (!sender.isDestroyed()) sender.send('terminal:data', id, data);
  });
  // The pty's own exit is the ONE place a session is recorded as over. Everything that stops one reads this rather than assuming its signal worked.
  proc.onExit(({ exitCode }) => {
    terminals.delete(id);
    ending.delete(id);
    if (!sender.isDestroyed()) sender.send('terminal:exit', id, exitCode);
  });
  return id;
}

/** What a session is launched with: the renderer's request plus the parts only the main process knows. */
export interface LaunchOptions extends TerminalLaunch {
  /** claude-ui's own settings file, or null when it has not been written yet. */
  settingsFile: string | null;
  /** The user's default flags, already parsed (see flags.ts). Appended last. */
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
  // The user's own flags go last, so a repeated flag resolves in their favour on any flag claude takes last-wins. The ones that would break the app are refused before they can be saved, so nothing here can displace what is above.
  if (opts.extra) args.push(...opts.extra);
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
    // The old fallback did exactly that, and said nothing: a session whose folder had been removed started in `~`, and then wrote its transcript under the HOME project, so it moved in the sidebar as well. The only visible sign was Claude Code asking for workspace trust on a directory nobody had chosen.
    // HOW OFTEN depends entirely on how somebody works, so it is not worth guessing: on the machine this was written on exactly one resolved directory was missing, because a session that LEAVES a `claude -w` worktree records its original cwd and the reader follows that. Somebody who removes trees while sessions still point INTO them meets it constantly.
    // Refusing here rather than only in the UI, so nothing can reach a spawn by another route.
    if (!cwd || !existsSync(cwd)) throw new Error(`MISSING_CWD:${cwd}`);
    // Guard on the settings file's existence in case the app is mid-startup and installStatusHooks() hasn't written it yet.
    // Stored flags are validated before they are written, so a failure here means a hand-edited meta.json; launch without them rather than refusing to start a session over it.
    const claudeFlags = claudeArgs({
      ...launch,
      settingsFile: existsSync(statusSettingsFile) ? statusSettingsFile : null,
      extra: parseLaunchFlags((await getSettings()).launchFlags).tokens,
    });
    // `claude` is `$0`: it names the process in any error the shell itself prints, and it is not passed on to claude.
    const { file: shell, args } = shellCommand(SHELL_COMMAND, claudeFlags, 'claude');
    const env = sessionEnv();
    // Marks the terminal rather than the session, so the hook can still say which tab reported after `/clear` has replaced the session in it.
    if (launch.tabToken) env[TAB_ENV] = launch.tabToken;
    return spawnPty(event.sender, shell, args, cwd, env);
  });

  ipcMain.on('terminal:input', (_event, id: number, data: string) => {
    terminals.get(id)?.write(data);
  });

  ipcMain.on('terminal:resize', (_event, id: number, cols: number, rows: number) => {
    terminals.get(id)?.resize(cols, rows);
  });

  // Stop now: the session is being discarded, so there is nothing to flush for.
  ipcMain.on('terminal:kill', (_event, id: number) => endSession(id, false));

  // Graceful close: give claude its normal exit path (Ctrl-C twice) so it flushes the transcript, then insist.
  ipcMain.on('terminal:close', (_event, id: number) => endSession(id, true));
}

/**
 * Stop every live session as the app quits.
 * Down the same path as any other stop, so quitting cannot be the one route that leaves something running — `before-quit` delays the quit itself, which is what gives the escalation room to land.
 */
export function terminateAll(): void {
  for (const id of [...terminals.keys()]) endSession(id, false);
}
