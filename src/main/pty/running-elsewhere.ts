/**
 * Whether a claude already runs a session, read from Claude Code's own record of running sessions: one `<pid>.json` per interactive claude in `~/.claude/sessions`, whatever started it.
 * The record is not documented, so anything in it that cannot be read or does not hold what is expected counts as no claude running, and a start goes ahead as it would without this check.
 * Linux only: it reads `/proc`, and elsewhere it finds nothing.
 */

import { readdir, readFile, readlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { RunningElsewhere } from '../../shared/types';
import { fsFailure, logOnce } from '../logs/log';
import { SCOPE_ENV } from '../status/hooks';
import { statFields } from './proc-stat';

const REGISTRY = join(homedir(), '.claude', 'sessions');

/** A process's start time in `/proc/<pid>/stat`, its 22nd field, which Claude Code records as `procStart`. */
const START_FIELD = 22 - 3;

/** What the record holds of one claude, as far as the check reads it. */
interface Entry {
  sessionId: string;
  cwd: string;
  startedAt: number;
  procStart: string;
  entrypoint?: unknown;
  pidDomain?: unknown;
}

function isEntry(value: unknown): value is Entry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.sessionId === 'string' && typeof entry.cwd === 'string' && typeof entry.startedAt === 'number' && typeof entry.procStart === 'string';
}

/**
 * The record's entry for `pid` while that process still runs, or null.
 * The files of a claude that did not exit cleanly stay behind, and their pids are used again, so an entry counts only when the process under that pid started when the entry says, and, where the entry names its pid namespace, in this one.
 */
async function liveEntry(registry: string, proc: string, pid: string, namespace: string | null): Promise<Entry | null> {
  try {
    const started = statFields(await readFile(join(proc, pid, 'stat'), 'utf8'))[START_FIELD];
    const entry: unknown = JSON.parse(await readFile(join(registry, `${pid}.json`), 'utf8'));
    if (!isEntry(entry) || entry.procStart !== started) return null;
    if (typeof entry.pidDomain === 'string' && namespace !== null && !entry.pidDomain.endsWith(`:${namespace}`)) return null;
    return entry;
  } catch {
    // Gone, unreadable, or not JSON: no claude to count.
    return null;
  }
}

/** What started the claude under `pid`: claude-ui marks every claude it starts in its environment, and the record says what else did. */
async function whereOf(proc: string, pid: string, entry: Entry): Promise<RunningElsewhere['where']> {
  const environ = await readFile(join(proc, pid, 'environ'), 'utf8').catch(() => '');
  if (environ.split('\0').includes(`${SCOPE_ENV}=1`)) return 'claude-ui';
  if (entry.entrypoint === 'claude-desktop') return 'desktop';
  if (entry.entrypoint === 'sdk-cli') return 'script';
  return 'terminal';
}

/** The claude that runs session `id` now, from any launcher, or null when none does or the record cannot be read. */
export async function runningElsewhere(id: string, registry = REGISTRY, proc = '/proc'): Promise<RunningElsewhere | null> {
  let names: string[];
  try {
    names = await readdir(registry);
  } catch (error) {
    const failure = fsFailure(error);
    if (failure) logOnce('warn', 'terminal', `cannot read Claude Code's running sessions in ${registry}: ${failure}`);
    return null;
  }
  const namespace = await readlink(join(proc, 'self', 'ns', 'pid')).catch(() => null);
  const pids = names.map((name) => /^(\d+)\.json$/.exec(name)?.[1]).filter((pid): pid is string => pid !== undefined);
  const entries = await Promise.all(pids.map(async (pid) => ({ pid, entry: await liveEntry(registry, proc, pid, namespace) })));
  const found = entries.find(({ entry }) => entry?.sessionId === id);
  if (!found?.entry) return null;
  return { where: await whereOf(proc, found.pid, found.entry), cwd: found.entry.cwd, since: found.entry.startedAt };
}
