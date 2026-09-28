import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { appendStamped, localTimestamp } from './stamp';
// Shared because Settings says how long logs are kept, and the numbers it gives must be the ones used here.
import { KEEP_CRASH_LOGS, KEEP_LOG_DATES, errorText, type LogLevel } from '../shared/log';

/**
 * The app's log: what a launch did, kept where it can be read afterwards, because an installed build is started from a launcher and has no stdout for any of it to go to.
 *
 * One file per launch per date, named by the moment the file started, local time: `claude-ui-20260928143012.log`.
 * A run that crosses midnight starts a new file on its first write of the new date — a write, not a timer, since a timer cannot be trusted across sleep — and that file opens with the same header, so each file stands on its own.
 * There is no size cap: a date roll keeps a file readable and loses nothing within a run, and identical lines collapse, which bounds the likeliest runaway.
 *
 * A file whose launch did not end with the quit line, or in which a process of the app died, is kept apart as `…-crash.log` and outlives the ordinary retention.
 * Writes go by path, never through a held descriptor, so deleting the logs while the app runs — which Settings invites — costs the lines already written and nothing after: a vanished file or folder is started again.
 * Nothing here may break the app: every failure is swallowed, and a log that cannot be written is simply not written.
 */

const NAME = /^claude-ui-(\d{14})(-crash)?\.log$/;

/** Identical lines in a row are counted rather than written, and the count is written at the next different line, at a file's end, or this long after the first repeat — so a crash in the middle of a flood still leaves the count behind. */
export const REPEAT_FLUSH_MS = 5000;

/** Enough of a file's end to find its last line, however long the file has grown. */
const TAIL_BYTES = 64 * 1024;

const QUIT = '===== quit =====';
const CONTINUES_IN = '===== continues in ';
const ENDED = '===== this launch ended without quitting: the line above is the last it wrote =====';

export type { LogLevel };
// Main's callers take it from here with the rest of the log; it lives in shared because the window says errors the same way.
export { errorText };

/**
 * `20260928143012`, the local wall-clock moment as digits.
 * Cut from the one local-time formatter, so a file's name and the lines inside it cannot disagree about when it started.
 */
function stampOf(date: Date): string {
  return localTimestamp(date).slice(0, 19).replace(/\D/g, '');
}

function dayOf(date: Date): string {
  return stampOf(date).slice(0, 8);
}

export function logFileName(date: Date, crash = false): string {
  return `claude-ui-${stampOf(date)}${crash ? '-crash' : ''}.log`;
}

function crashName(name: string): string {
  return name.replace(/\.log$/, '-crash.log');
}

interface LogName {
  name: string;
  stamp: string;
  crash: boolean;
}

function parseName(name: string): LogName | null {
  const match = NAME.exec(name);
  // The pattern's first group is not optional, so a match always has it.
  return match ? { name, stamp: match[1]!, crash: match[2] !== undefined } : null;
}

function logNames(names: string[]): LogName[] {
  return names
    .map(parseName)
    .filter((log): log is LogName => log !== null)
    .sort((a, b) => b.stamp.localeCompare(a.stamp));
}

/**
 * The files retention removes: ordinary ones outside the KEEP_LOG_DATES most recent dates that have one, and crash logs past the KEEP_CRASH_LOGS newest.
 * A name that is not one of ours is never touched, so anything else put in the folder stays.
 */
export function expiredLogs(names: string[]): string[] {
  const logs = logNames(names);
  const ordinary = logs.filter((log) => !log.crash);
  const keptDates = new Set([...new Set(ordinary.map((log) => log.stamp.slice(0, 8)))].sort().reverse().slice(0, KEEP_LOG_DATES));
  const crashes = logs.filter((log) => log.crash);
  return [...ordinary.filter((log) => !keptDates.has(log.stamp.slice(0, 8))), ...crashes.slice(KEEP_CRASH_LOGS)].map((log) => log.name);
}

/** `INFO  app message`; a message of several lines keeps them, indented, so every line at the margin is a record of its own. */
function formatLine(level: LogLevel, area: string, message: string): string {
  return `${level.toUpperCase().padEnd(5)} ${area} ${message.replace(/\n/g, '\n    ')}`;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/**
 * A filesystem failure as a log line says it, or null for ENOENT — the "it was not there" that every watcher and cleanup here meets as a matter of course, and which is not worth a line.
 * Anything else is: its message leads with the code (`ENOSPC`, `EACCES`, `EMFILE`), which is what tells a limit or a permission apart from a folder that simply went away.
 */
export function fsFailure(error: unknown): string | null {
  if (isMissing(error)) return null;
  return errorText(error);
}

/** The last non-empty line of a file, or null when it cannot be read. */
async function readLastLine(file: string): Promise<string | null> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file, 'r');
    const { size } = await handle.stat();
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return buffer.toString('utf8').split('\n').filter((line) => line.trim() !== '').at(-1) ?? '';
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

export interface LogOptions {
  dir: string;
  /** The lines that open every file — at launch, after midnight, and after the file was deleted — so each says which build and machine it came from. */
  header: () => string[];
}

export interface Log {
  write(level: LogLevel, area: string, message: string): void;
  /**
   * `write`, but a line already written to the current file is not written again.
   * For a failure met on every pass of something that runs over and over — every session listing re-reads the transcripts — where the collapse of identical lines in a row cannot help, because other lines come between.
   * Once per FILE rather than per launch, so a file that starts at midnight still says it.
   */
  writeOnce(level: LogLevel, area: string, message: string): void;
  /** A process of the app died: an error line, and the file it lands in is kept as a crash log once it is finished with. */
  crash(area: string, message: string): void;
  /** Writes the quit line, which is what tells the next launch this one ended on purpose. Nothing is written after it. */
  close(): Promise<void>;
  /** Resolves once everything asked for so far has been written. */
  settled(): Promise<void>;
}

export function createLog({ dir, header }: LogOptions): Log {
  let current: { name: string; day: string; crash: boolean } | null = null;
  let closed = false;
  let last: { level: LogLevel; area: string; message: string } | null = null;
  let repeats = 0;
  let repeatTimer: ReturnType<typeof setTimeout> | null = null;
  /** The lines `writeOnce` has written into the current file. */
  let once = new Set<string>();

  // Every write runs in order through one queue, so a roll or a restart can never interleave with the line that caused it.
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (job: () => Promise<void>): void => {
    queue = queue.then(job).catch(() => undefined);
  };

  const file = (name: string): string => path.join(dir, name);

  async function begin(now: Date, context?: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
    const name = logFileName(now);
    current = { name, day: dayOf(now), crash: false };
    once = new Set();
    for (const line of [`log ${file(name)}`, ...(context === undefined ? [] : [context]), ...header()]) {
      await appendStamped(file(name), formatLine('info', 'app', line));
    }
    for (const expired of expiredLogs(await fs.readdir(dir))) {
      if (expired !== name) await fs.rm(file(expired), { force: true }).catch(() => undefined);
    }
  }

  /** The file's last line, then the crash rename if something died in it. */
  async function finish(lastLine: string): Promise<void> {
    if (current === null) return;
    const done = current;
    await appendStamped(file(done.name), formatLine('info', 'app', lastLine), { create: false }).catch(() => undefined);
    if (done.crash) await fs.rename(file(done.name), file(crashName(done.name))).catch(() => undefined);
  }

  /** Start the next file when the date has moved on since the current one began. */
  async function rollIfDue(now: Date): Promise<void> {
    if (current === null || dayOf(now) === current.day) return;
    const previous = current.name;
    await finish(`${CONTINUES_IN}${logFileName(now)} =====`);
    await begin(now, `continued from ${previous}`);
  }

  async function put(text: string): Promise<void> {
    if (current === null) return;
    const now = new Date();
    await rollIfDue(now);
    try {
      await appendStamped(file(current.name), text, { create: false });
    } catch (error) {
      if (!isMissing(error)) return;
      await begin(now, `started again: ${current.name} was removed while the app ran`);
      await appendStamped(file(current.name), text);
    }
  }

  /**
   * The previous launch's last file, checked before this launch makes its own: without the quit line, that launch did not end on purpose — a native crash, a kill, a shutdown, all alike from in here — so it is said so and kept.
   * Only the newest ordinary file is the previous launch's last. An earlier file of a run that crossed midnight ends with its continues line and is left alone, and so is one whose successor was deleted, since how that run ended is not in it.
   */
  async function classifyPrevious(): Promise<void> {
    const previous = logNames(await fs.readdir(dir)).find((log) => !log.crash);
    if (previous === undefined) return;
    const lastLine = await readLastLine(file(previous.name));
    if (lastLine === null || lastLine.endsWith(QUIT) || lastLine.includes(CONTINUES_IN)) return;
    await appendStamped(file(previous.name), formatLine('warn', 'app', ENDED), { create: false });
    await fs.rename(file(previous.name), file(crashName(previous.name)));
  }

  function flushRepeats(): void {
    if (repeatTimer !== null) clearTimeout(repeatTimer);
    repeatTimer = null;
    if (repeats === 0 || last === null) return;
    // The repeated message is named rather than pointed at, because the count may land in the next file, after its header.
    const text = formatLine(last.level, last.area, `repeated ${repeats} more ${repeats === 1 ? 'time' : 'times'}: ${last.message.split('\n')[0]}`);
    repeats = 0;
    enqueue(() => put(text));
  }

  enqueue(async () => {
    await fs.mkdir(dir, { recursive: true });
    await classifyPrevious().catch(() => undefined);
    await begin(new Date());
  });

  const instance: Log = {
    writeOnce(level, area, message) {
      if (closed) return;
      const text = formatLine(level, area, message);
      // A line of its own between repeats, so the count before it is written first and nothing collapses across it.
      flushRepeats();
      last = null;
      // Checked when the line reaches the front of the queue, and after a roll the line itself would cause, so it is counted against the file it actually lands in.
      enqueue(async () => {
        await rollIfDue(new Date());
        if (once.has(text)) return;
        await put(text);
        once.add(text);
      });
    },
    write(level, area, message) {
      if (closed) return;
      if (last !== null && last.level === level && last.area === area && last.message === message) {
        repeats += 1;
        repeatTimer ??= setTimeout(flushRepeats, REPEAT_FLUSH_MS);
        return;
      }
      flushRepeats();
      last = { level, area, message };
      const text = formatLine(level, area, message);
      enqueue(() => put(text));
    },
    crash(area, message) {
      if (closed) return;
      flushRepeats();
      // Never collapsed, and nothing collapses into it: each death is its own record.
      last = null;
      const text = formatLine('error', area, message);
      enqueue(async () => {
        await put(text);
        if (current !== null) current.crash = true;
      });
    },
    close() {
      if (!closed) {
        flushRepeats();
        closed = true;
        enqueue(() => finish(QUIT));
      }
      return queue;
    },
    settled: () => queue,
  };
  return instance;
}

// The app's one log, started once the single-instance lock is held, so a second launch that quits at once leaves no file behind.
let active: Log | null = null;

export function startLog(options: LogOptions): void {
  active ??= createLog(options);
}

export function log(level: LogLevel, area: string, message: string): void {
  active?.write(level, area, message);
}

export function logOnce(level: LogLevel, area: string, message: string): void {
  active?.writeOnce(level, area, message);
}

export function logCrash(area: string, message: string): void {
  active?.crash(area, message);
}

export function closeLog(): Promise<void> {
  return active?.close() ?? Promise.resolve();
}
