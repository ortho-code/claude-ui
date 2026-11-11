import type { BrowserWindow } from 'electron';
import { ipcMain } from 'electron';
import { spawn } from 'node:child_process';
import { promises as fs, watch, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { statusDir, hookScriptPath } from '../paths';
import { errorText, log } from '../logs/log';
import { readScheduled } from './crons';
import { SCOPE_ENV, TAB_ENV } from './hooks';

/** Watch the status directory and push per-session status updates to the renderer. */
export function registerStatusIpc(getWindow: () => BrowserWindow | null): void {
  mkdirSync(statusDir, { recursive: true });

  ipcMain.handle('status:getAll', () => readAllStatuses());
  // Only once its claude has gone, so what its last Stop left running goes too.
  ipcMain.on('status:clear', (_event, id: string) => {
    for (const file of [`${id}.json`, `${id}.stop`, `${id}.start`]) void fs.rm(path.join(statusDir, file)).catch(() => {});
  });

  watch(statusDir, (_event, filename) => {
    if (!filename) return;
    // A model switch, which is a fact about the session rather than a state it is in — hence its own file and its own channel.
    // Deliberately NOT read at launch: by then the transcript's own last answer is the better source, and a file left over from a previous run could only be staler than that.
    if (filename.endsWith('.model')) {
      const id = filename.slice(0, -'.model'.length);
      void fs
        .readFile(path.join(statusDir, filename), 'utf8')
        .then((model) => {
          const win = getWindow();
          if (model.trim() && win && !win.isDestroyed()) win.webContents.send('session:model', id, model.trim());
        })
        .catch(() => {});
      return;
    }
    // What the last Stop left scheduled, rewritten with each Stop's payload and with an end the app reports (`reportEnd`), and emptied by a start that is not a compaction's: a fact about the session, like a model switch, so its own channel, since a status that is not the Stop's must not take it away.
    // A file that does not parse, as one read halfway through its write does not, is skipped rather than sent as nothing, so a clock does not blink off and on; one that is gone is nothing.
    if (filename.endsWith('.stop')) {
      const id = filename.slice(0, -'.stop'.length);
      void readScheduled(id).then((tasks) => {
        const win = getWindow();
        if (tasks && win && !win.isDestroyed()) win.webContents.send('session:scheduled', id, tasks);
      });
      return;
    }
    // A claude starting on a session, which is identity rather than a state, and like a model switch not read at launch: the tabs restored then say which session each runs.
    if (filename.endsWith('.start')) {
      const id = filename.slice(0, -'.start'.length);
      void readStart(id).then((start) => {
        const win = getWindow();
        if (start && win && !win.isDestroyed()) win.webContents.send('session:start', id, start.tab, start.source);
      });
      return;
    }
    if (!filename.endsWith('.json')) return;
    const id = filename.replace(/\.json$/, '');
    void readStatus(id).then((entry) => {
      if (entry === null) return;
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.send('session:status', id, entry.status, entry.tab, entry.event, entry.background, entry.prompt, entry.source);
    });
  });
}

/** What a claude starting on a session wrote: the terminal it runs in (TAB_ENV) and SessionStart's source; null when the file is gone or not one. */
async function readStart(id: string): Promise<{ tab: string; source: string } | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(statusDir, `${id}.start`), 'utf8')) as { tab?: unknown; source?: unknown };
    return { tab: typeof parsed.tab === 'string' ? parsed.tab : '', source: typeof parsed.source === 'string' ? parsed.source : '' };
  } catch {
    return null;
  }
}

interface StatusEntry {
  status: string;
  /** The second the script wrote it, as the script stamps it; null from a file without one. */
  ts: number | null;
  /** The terminal that reported it (TAB_ENV), or '' for a session claude-ui is not running. */
  tab: string;
  /** The hook event that reported it, or '' from a file written before the script named it. */
  event: string;
  /** For `background`, the type claude gives each piece of work still running, as many as the script could read; absent for any other status. */
  background?: string[];
  /** For `UserPromptSubmit`, the prompt submitted, which tells yours from a turn claude started itself (`startedByClaude`); absent for any other event. */
  prompt?: string;
  /** For `UserPromptSubmit`, where claude says the prompt came from, such as `user`, where its payload says; absent otherwise. */
  source?: string;
}

async function readStatus(id: string): Promise<StatusEntry | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(statusDir, `${id}.json`), 'utf8')) as {
      status?: unknown;
      ts?: unknown;
      tab?: unknown;
      event?: unknown;
      background?: unknown;
      prompt?: unknown;
      source?: unknown;
    };
    if (typeof parsed.status !== 'string') return null;
    return {
      // A status file outlives the app that wrote it, and 0.3 and earlier wrote `idle` for `ready`.
      status: parsed.status === 'idle' ? 'ready' : parsed.status,
      ts: Number.isInteger(parsed.ts) ? (parsed.ts as number) : null,
      tab: typeof parsed.tab === 'string' ? parsed.tab : '',
      event: typeof parsed.event === 'string' ? parsed.event : '',
      ...(Array.isArray(parsed.background) ? { background: parsed.background.filter((type): type is string => typeof type === 'string') } : {}),
      ...(typeof parsed.prompt === 'string' ? { prompt: parsed.prompt } : {}),
      ...(typeof parsed.source === 'string' ? { source: parsed.source } : {}),
    };
  } catch {
    return null;
  }
}

/** A piece of background work as `Stop` lists it, reduced to what the app reads. */
export interface Work {
  id: string;
  /** What claude calls it, such as `shell` or `subagent`. */
  type: string;
  /** Claude's description of it, kept so that an end reported in a hook's place hands the script what it tells an artifact watch by. */
  description?: string;
}

/** What the hooks last reported of a session, with when, for a reader that ends what no hook ends. */
export interface Report {
  status: string;
  /** When the status was written, in ms since the epoch. */
  at: number;
  /** The second the script stamped it with, which an end reported in a hook's place names so the script can tell it from a status written since; null without one. */
  ts: number | null;
  tab: string;
  /** The work the last Stop listed as still running, or none from a fresh start. */
  running: Work[];
  /** When that Stop was, in ms since the epoch; never, for a session with no Stop file, so nothing found after it counts as running. */
  runningAt: number;
  /** The tasks that Stop listed as scheduled (`session_crons`), as claude wrote them, for an end reported in a hook's place to keep (`reportEnd`); absent when the file holds no list, as a start's does, which such an end must not turn into an empty one. */
  crons?: unknown[];
  /** The session's transcript, as that Stop named it, kept with the list so its crons can still be told from its wakeups (`cronSchedules`). */
  transcript?: string;
}

/** The last report of a session, or null for one with no status: one claude-ui is not running. */
export async function readReport(id: string): Promise<Report | null> {
  const entry = await readStatus(id);
  if (!entry) return null;
  const at = await mtimeOf(path.join(statusDir, `${id}.json`));
  if (at === null) return null;
  const stopFile = path.join(statusDir, `${id}.stop`);
  let running: Work[] = [];
  let runningAt = Infinity;
  let crons: unknown[] | undefined;
  let transcript: string | undefined;
  try {
    const stop = JSON.parse(await fs.readFile(stopFile, 'utf8')) as { background_tasks?: unknown; listed_at?: unknown; session_crons?: unknown; transcript_path?: unknown };
    if (Array.isArray(stop.session_crons)) crons = stop.session_crons;
    if (typeof stop.transcript_path === 'string') transcript = stop.transcript_path;
    // An end the app reported carries the time of the Stop its list came from, since the list is that Stop's, less what had ended; a Stop's own is when it was written.
    runningAt = typeof stop.listed_at === 'number' ? stop.listed_at : ((await mtimeOf(stopFile)) ?? Infinity);
    if (Array.isArray(stop.background_tasks)) {
      running = (stop.background_tasks as ({ id?: unknown; type?: unknown; description?: unknown } | null)[]).flatMap((work) =>
        typeof work?.id === 'string' && typeof work.type === 'string'
          ? [{ id: work.id, type: work.type, ...(typeof work.description === 'string' ? { description: work.description } : {}) }]
          : [],
      );
    }
  } catch {
    // No Stop file, or one that does not parse: nothing is known to run, and nothing the transcript says was started counts as running since.
  }
  return { status: entry.status, at, ts: entry.ts, tab: entry.tab, running, runningAt, ...(crons ? { crons } : {}), ...(transcript ? { transcript } : {}) };
}

async function mtimeOf(file: string): Promise<number | null> {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

/** An end of a state that no hook reports, as the app reports it in the hook's place. */
export interface Ending {
  /** What the status file names as having reported it. */
  event: string;
  /** Ready as a Stop writes it, so background while `running` holds anything; or busy, for a turn that goes on. */
  status: 'ready' | 'busy';
  /** For ready, the work still listed as running. */
  running: Work[];
  /** The statuses it ends: the script writes it only over one of these, stamped as the report it read was. */
  ends: readonly string[];
}

/**
 * Report an end that no hook reports by running the hook script as the hook would have, so the script stays the one writer of the status files: a ready reads exactly as a Stop's would, ready or background naming that work.
 * `report` is the one the end was read from: the script writes only over that status of that second, and keeps with the work still running the time of the Stop it was taken from, so that work ending after that Stop still counts as ended, even before this report is written.
 */
export function reportEnd(id: string, report: Report, ending: Ending): Promise<void> {
  const { tab, ts, runningAt: listedAt } = report;
  return new Promise((resolve) => {
    const child = spawn(hookScriptPath, [ending.status], { env: { ...process.env, [SCOPE_ENV]: '1', [TAB_ENV]: tab }, stdio: ['pipe', 'ignore', 'ignore'] });
    child.stdin.on('error', () => {});
    child.on('error', (error) => {
      log('warn', 'status', `could not report ${ending.event} for ${id}: ${errorText(error)}`);
      resolve();
    });
    child.on('close', () => resolve());
    // Without a Stop to take it from, the report is the first list, as a Stop's would be.
    const listed = Number.isFinite(listedAt) ? { listed_at: listedAt } : {};
    // What that Stop left scheduled goes with it, since the script writes this over the Stop's file: an interrupt leaves a cron as it was, though it takes a `/loop` wakeup with it (by claude's source), which the next Stop says.
    const crons = report.crons ? { session_crons: report.crons, ...(report.transcript ? { transcript_path: report.transcript } : {}) } : {};
    const stop = ending.status === 'ready' ? { background_tasks: ending.running, ...crons, ...listed } : {};
    child.stdin.end(JSON.stringify({ session_id: id, hook_event_name: ending.event, claude_ui_expect: ending.ends.join('|'), claude_ui_expect_ts: String(ts ?? ''), ...stop }));
  });
}

/** Remove everything this directory holds for the given session ids (used when a conversation is deleted). */
export async function clearStatuses(ids: string[]): Promise<void> {
  const files = ids.flatMap((id) => [`${id}.json`, `${id}.model`, `${id}.stop`]);
  await Promise.all(files.map((file) => fs.rm(path.join(statusDir, file)).catch(() => {})));
}

/**
 * Every session's status as the renderer receives it at launch.
 * Exported for the tests that pin what does and does not survive into it.
 */
export async function readAllStatuses(): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let files: string[];
  try {
    files = await fs.readdir(statusDir);
  } catch {
    return result;
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const id = file.replace(/\.json$/, '');
    const entry = await readStatus(id);
    // 'start' is identity, and identity is answered by the tabs being restored around it — seeding it here would hand the renderer a status no dot has wording for.
    if (entry && entry.status !== 'start') result[id] = entry.status;
  }
  return result;
}
