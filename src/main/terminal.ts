import { ipcMain } from 'electron';
import * as pty from 'node-pty';
import * as os from 'node:os';
import { existsSync } from 'node:fs';
import { SCOPE_ENV, TAB_ENV, statusSettingsFile } from './status';
import { parseLaunchFlags } from '../shared/flags';
import { getSettings } from './meta';

const terminals = new Map<number, pty.IPty>();
let nextId = 1;

/** Environment as node-pty wants it: no undefined values. */
function cleanEnv(): { [key: string]: string } {
  const env: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    // Strip Claude Code harness variables.
    // When the app is launched from inside a Claude session these get inherited, and the claude we spawn then thinks it is a nested SDK / child session and never persists its transcript.
    // Keep our own CLAUDE_UI marker.
    if (key !== SCOPE_ENV && (key === 'CLAUDECODE' || key.startsWith('CLAUDE_'))) continue;
    env[key] = value;
  }
  // Mark this session as launched by claude-ui so the status hook reports it.
  env[SCOPE_ENV] = '1';
  // Advertise 24-bit colour so claude emits its full TUI styling (e.g. the select-menu highlight) instead of a degraded fallback; the frontend xterm renders truecolor fine.
  env.COLORTERM = 'truecolor';
  return env;
}

/** What a session is launched with, beyond the flags every session gets. */
export interface LaunchOptions {
  /** claude-ui's own settings file, or null when it has not been written yet. */
  settingsFile: string | null;
  /** The session to resume, or null for a fresh one. */
  resumeSessionId?: string;
  /** Fork the resumed session into a new id instead of continuing it. */
  fork?: boolean;
  /** The session's display name. */
  name?: string;
  /** A new git worktree: a name, `''` to let claude pick one, `undefined` for no worktree. */
  worktree?: string;
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
 * What the pty's shell runs.
 *
 * `"$@"` is the whole point: the flags reach claude as the shell's positional parameters (passed after this string, with `claude` standing in as `$0`) rather than being interpolated into this command, so no user-supplied value is ever parsed as shell syntax.
 * When claude exits, the shell exits too (no trailing `exec bash`), so the pty closes and the renderer can close the tab instead of leaving a bare shell behind.
 */
const SHELL_COMMAND = 'claude "$@"';

export function registerTerminalIpc(): void {
  // Async only for the settings read: the user's default flags live in meta.json, and a session has to be launched with the flags as they are NOW, not as they were when the app started.
  ipcMain.handle('terminal:start', async (event, cwd: string, resumeSessionId?: string, tabToken?: string, fork?: boolean, name?: string, worktree?: string): Promise<number> => {
    const id = nextId++;
    const shell = process.env.SHELL ?? '/bin/bash';
    // The shell is interactive (-i) as well as login
    // (-l): a non-interactive shell skips ~/.bashrc (the usual `case $- in *i*) ;; *) return;; esac` guard), so any rc-based per-directory setup — mise/asdf/direnv activation, PATH, env vars — never runs, and claude launches without the tools its MCP servers need.
    // An interactive shell in the pty runs that setup for the session's directory, like a real terminal.
    // Guard on the settings file's existence in case the app is mid-startup and installStatusHooks() hasn't written it yet.
    // Stored flags are validated before they are written, so a failure here means a hand-edited meta.json; launch without them rather than refusing to start a session over it.
    const launch = claudeArgs({
      settingsFile: existsSync(statusSettingsFile) ? statusSettingsFile : null,
      resumeSessionId,
      fork,
      name,
      worktree,
      extra: parseLaunchFlags((await getSettings()).launchFlags).tokens,
    });
    // `claude` is `$0`: it names the process in any error the shell itself prints, and it is not passed on to claude.
    const args = ['-l', '-i', '-c', SHELL_COMMAND, 'claude', ...launch];
    const env = cleanEnv();
    if (tabToken) env[TAB_ENV] = tabToken;
    const proc = pty.spawn(shell, args, {
      // xterm.js speaks 256-colour/truecolor; the old 'xterm-color' (8-colour) terminfo made claude pick a degraded palette for its TUI.
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd && existsSync(cwd) ? cwd : os.homedir(),
      env,
    });
    terminals.set(id, proc);

    const sender = event.sender;
    proc.onData((data) => {
      if (!sender.isDestroyed()) sender.send('terminal:data', id, data);
    });
    proc.onExit(({ exitCode }) => {
      terminals.delete(id);
      if (!sender.isDestroyed()) sender.send('terminal:exit', id, exitCode);
    });

    return id;
  });

  ipcMain.on('terminal:input', (_event, id: number, data: string) => {
    terminals.get(id)?.write(data);
  });

  ipcMain.on('terminal:resize', (_event, id: number, cols: number, rows: number) => {
    terminals.get(id)?.resize(cols, rows);
  });

  ipcMain.on('terminal:kill', (_event, id: number) => {
    terminals.get(id)?.kill();
    terminals.delete(id);
  });

  // Graceful close: give claude its normal exit path (Ctrl-C twice) so it flushes the transcript, then kill the leftover shell.
  ipcMain.on('terminal:close', (_event, id: number) => {
    const proc = terminals.get(id);
    if (!proc) return;
    terminals.delete(id);
    proc.write('\x03');
    setTimeout(() => proc.write('\x03'), 400);
    setTimeout(() => proc.kill(), 1800);
  });
}

/** SIGTERM every live session so claude gets a chance to flush before the app quits. */
export function terminateAll(): void {
  for (const proc of terminals.values()) {
    try {
      proc.kill('SIGTERM');
    } catch {
      // Already gone.
    }
  }
  terminals.clear();
}
