/**
 * What the quit ends after its stops: every process the app started that is still running once the stops have had their grace.
 *
 * Every process the app starts carries `CLAUDE_UI_RUN`, set to an id of this run of the app, and a child inherits it unless it clears its environment; what the app hands to the system to open, a folder or a link, is the system's and carries none.
 * A stop signals a process group, which misses a child that ignores the signal once its leader has gone, and a process that left the session with `setsid`.
 * So the quit looks for the variable in every process: one still in a session the app started, or in the app's own, is ended, and one that left those sessions is logged and left running.
 * The id is the run's own, so what a second instance started from one of this one's sessions starts carries an id of its own.
 * Linux only: it reads `/proc`, and elsewhere the quit ends what its stops reach and no more.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from '../logs/log';
import { statFields } from './proc-stat';

/** The variable every process the app starts carries. */
export const RUN_VARIABLE = 'CLAUDE_UI_RUN';

const runId = randomUUID();

/** The variable and its value for this run, to put in the environment of a process the app starts. */
export function runMark(): Record<string, string> {
  return { [RUN_VARIABLE]: runId };
}

/** This process's environment with this run's id, for a helper main runs itself, such as git. */
export function markedEnv(): NodeJS.ProcessEnv {
  return { ...process.env, ...runMark() };
}

/** The ids of the sessions the app started: node-pty's child and a `detached` spawn each lead one, so its pid is the session's id. */
const sessions = new Set<number>();

/** Record a process the app started in a session of its own. */
export function ownSession(pid: number | undefined): void {
  if (pid !== undefined) sessions.add(pid);
}

export interface Leftover {
  pid: number;
  /** Its command line, its arguments joined by spaces. */
  command: string;
  /** Whether it is still in a session the app started. */
  ownSession: boolean;
}

/** The session id in `/proc/<pid>/stat`, its sixth field. */
function sessionOf(stat: string): number {
  return Number(statFields(stat)[3]);
}

/**
 * The processes under `proc` that carry `run` as their `CLAUDE_UI_RUN`, other than `self`.
 * A process this user may not read, or one gone while it was read, is skipped: neither is one the app started.
 */
export function findLeftovers(proc: string, run: string, own: ReadonlySet<number>, self: number): Leftover[] {
  const mark = `${RUN_VARIABLE}=${run}`;
  const found: Leftover[] = [];
  for (const name of readdirSync(proc)) {
    const pid = Number(name);
    if (!Number.isInteger(pid) || pid <= 0 || pid === self) continue;
    try {
      if (!readFileSync(join(proc, name, 'environ'), 'utf8').split('\0').includes(mark)) continue;
      const session = sessionOf(readFileSync(join(proc, name, 'stat'), 'utf8'));
      const command = readFileSync(join(proc, name, 'cmdline'), 'utf8').split('\0').join(' ').trim();
      found.push({ pid, command, ownSession: own.has(session) });
    } catch {
      // Not readable, or already gone.
    }
  }
  return found;
}

/**
 * How long the processes still in the app's sessions get to leave after being asked, before they are killed.
 * Short, since the stops before the sweep have already given each session the full grace; what is left is mostly a process that never heard them.
 */
const LEFTOVER_GRACE_MS = 1000;

const POLL_MS = 50;

/** Signal `pid`, which may have gone since it was found. */
function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch {
    // Already gone.
  }
}

/**
 * End what the quit's stops left of the app's own sessions, and log what left them.
 * Each is asked with SIGTERM, then killed if it is still there after `LEFTOVER_GRACE_MS`; a process is signalled only while it still carries this run's id, which a pid used again by another process does not.
 */
export async function sweepLeftovers(proc = '/proc'): Promise<void> {
  if (!existsSync(proc)) return;
  // The app's own session too, where the helpers main runs itself, such as git, run: only a process carrying this run's id is reached, and Electron's own processes carry none.
  const swept = new Set([...sessions, sessionOf(readFileSync(join(proc, String(process.pid), 'stat'), 'utf8'))]);
  const own = (): Leftover[] => findLeftovers(proc, runId, swept, process.pid).filter((leftover) => leftover.ownSession);
  for (const leftover of findLeftovers(proc, runId, swept, process.pid)) {
    if (leftover.ownSession) {
      log('warn', 'process', `pid ${leftover.pid} still running in a session the app started, ending it: ${leftover.command}`);
      signal(leftover.pid, 'SIGTERM');
    } else {
      log('info', 'process', `pid ${leftover.pid} left the app's sessions and is still running, not ended: ${leftover.command}`);
    }
  }
  const deadline = Date.now() + LEFTOVER_GRACE_MS;
  while (own().length > 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  for (const leftover of own()) {
    log('warn', 'process', `pid ${leftover.pid} still running ${LEFTOVER_GRACE_MS} ms after SIGTERM, sending SIGKILL`);
    signal(leftover.pid, 'SIGKILL');
  }
}
