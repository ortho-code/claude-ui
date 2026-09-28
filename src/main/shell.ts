/**
 * How the app runs things through the user's shell, and how it stops them.
 *
 * ONE invocation for everything the app launches — a session's `claude` in a pty, a panel's command in a pipe — so they see the same `PATH`.
 * The shell is login (`-l`) AND interactive (`-i`): a non-interactive shell skips `~/.bashrc` (the usual `case $- in *i*) ;; *) return;; esac` guard), so any rc-based per-directory setup — mise/asdf/direnv activation, `PATH`, env vars — never runs, and `claude` launches without the tools its MCP servers need.
 * What runs is always a fixed script of the app's with the variable parts as positional parameters after it, never a string the app assembled, so no user-supplied value is ever parsed as shell syntax.
 *
 * MEASURED, for a caller without a tty (a pipe rather than a pty): bash prints two lines of job-control noise on stderr before anything else runs, `cannot set terminal process group` and `no job control in this shell`, and an interactive LOGIN shell that is still the parent when the command ends prints `logout` on its way out.
 * Both are the shell's own, not the command's, so a pipe-bound caller discards the shell's stderr and `exec`s the command in its place (see panels.ts); the pty has a tty, so neither shows there.
 */

import { log } from './log';

/** The user's login shell. */
export function loginShell(): string {
  return process.env.SHELL ?? '/bin/bash';
}

export interface ShellInvocation {
  file: string;
  args: string[];
}

/**
 * The user's login shell, interactive, running `script` with `argv` as its positional parameters.
 *
 * `arg0` becomes `$0`: it names the process in any error the shell itself prints, and it is not part of `"$@"`.
 */
export function shellCommand(script: string, argv: string[], arg0: string): ShellInvocation {
  return { file: loginShell(), args: ['-l', '-i', '-c', script, arg0, ...argv] };
}

/**
 * The environment a launched process inherits: this process's, minus the Claude Code harness variables, and with nothing undefined (node-pty refuses those).
 *
 * When the app is launched from inside a Claude session those get inherited, and a `claude` spawned with them thinks it is a nested SDK / child session and never persists its transcript.
 * `CLAUDE_UI` goes too: it is the marker the status hook fires on, so it is for the caller that WANTS the hooks to set, and only that one.
 */
export function inheritedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_')) continue;
    env[key] = value;
  }
  return env;
}

/**
 * How long a process gets to leave on its own after being asked, before it is killed outright.
 *
 * Under the app's quit budget: `before-quit` delays the actual quit, so the SIGKILL still lands while the app is alive to send it.
 */
export const KILL_GRACE_MS = 1200;

/**
 * Signal a whole process GROUP rather than one process.
 *
 * MEASURED: node-pty's child leads its own session (`pid == pgid == sid` for every live session), and so does a `detached` spawn, so the pid doubles as the group id and the negative form reaches everything under it — the login shell, `claude`, and the MCP servers `claude` starts.
 * That matters here specifically: the app never talks to `claude` directly, only to a shell that runs it, so signalling the one process we know about is the one thing guaranteed NOT to reach the thing we mean to stop.
 * The leader is signalled separately too, so this still does something if a future node-pty stops calling `setsid` and the group does not exist.
 * Both are wrapped: a pid that has already gone is not an error, and a REAPED pid may already belong to somebody else — which is the sharper reason never to signal on a guess.
 */
export function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // No such group: already gone, or never had one.
  }
  try {
    process.kill(pid, signal);
  } catch {
    // Already reaped.
  }
}

/**
 * Ask a process group to leave, and kill it if it has not after the grace period.
 *
 * `stillRunning` is the caller's own record of the process being alive — the pty's exit or the child's `exit` event is the one place it is recorded as over — so the escalation is driven by the process actually being gone, not by having sent something.
 * A process that left politely is never killed afterwards, because by then its pid may belong to somebody else.
 */
export function terminateGroup(pid: number, stillRunning: () => boolean): void {
  signalGroup(pid, 'SIGTERM');
  setTimeout(() => {
    if (!stillRunning()) return;
    // Worth a line of its own: a process that declines SIGTERM is either stuck or ignoring it, and nothing else would say which one needed killing.
    log('warn', 'process', `pid ${pid} still running ${KILL_GRACE_MS} ms after SIGTERM, sending SIGKILL`);
    signalGroup(pid, 'SIGKILL');
  }, KILL_GRACE_MS);
}
