import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createLog, expiredLogs, logFileName, KEEP_CRASHES, REPEAT_FLUSH_MS } from './log';
import type { Log } from './log';

// Names and dates are local time, so the zone is pinned; the clock is faked so a file's name is known before it is made.
const originalTz = process.env.TZ;
let dir: string;

beforeEach(async () => {
  process.env.TZ = 'Europe/Amsterdam';
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-28T12:30:12.000Z')); // 14:30:12 local
  dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'claude-ui-log-')), 'logs');
});

afterEach(() => {
  vi.useRealTimers();
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

const FIRST = 'claude-ui-20260928143012.log';

function open(): Log {
  return createLog({ dir, header: () => ['claude-ui 1.0.0 test'] });
}

async function names(): Promise<string[]> {
  return (await fs.readdir(dir)).sort();
}

/** A file's lines without their timestamps. */
async function lines(name: string): Promise<string[]> {
  const text = await fs.readFile(path.join(dir, name), 'utf8');
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => line.replace(/^\S+ /, ''));
}

/** What a file holds after the header it opened with. */
async function body(name: string): Promise<string[]> {
  return (await lines(name)).slice(header(name).length);
}

function header(name: string, context?: string): string[] {
  return [`INFO  app log ${path.join(dir, name)}`, ...(context === undefined ? [] : [`INFO  app ${context}`]), 'INFO  app claude-ui 1.0.0 test'];
}

async function seed(name: string, lastLine: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), `2026-09-27T10:00:00.000+02:00 INFO  app earlier\n2026-09-27T10:00:01.000+02:00 ${lastLine}\n`);
}

describe('logFileName', () => {
  it('is the local moment the file started, as digits', () => {
    expect(logFileName(new Date('2026-09-28T12:30:12.345Z'))).toBe(FIRST);
    expect(logFileName(new Date('2026-09-28T12:30:12.345Z'), true)).toBe('claude-ui-20260928143012-crash.log');
  });
});

describe('expiredLogs', () => {
  it('keeps the 7 most recent dates that have a log, however far apart they are', () => {
    const kept = ['20', '21', '25', '26', '27', '28', '29', '30'].map((day) => `claude-ui-202609${day}100000.log`);
    const secondOnThe20th = 'claude-ui-20260920180000.log';
    expect(expiredLogs([...kept, secondOnThe20th]).sort()).toEqual(['claude-ui-20260920100000.log', secondOnThe20th]);
  });

  it('keeps the newest crash logs apart from the dates', () => {
    const crashes = Array.from({ length: KEEP_CRASHES + 2 }, (_, i) => `claude-ui-202601${String(i + 1).padStart(2, '0')}100000-crash.log`);
    const ordinary = ['claude-ui-20260928100000.log'];
    expect(expiredLogs([...ordinary, ...crashes]).sort()).toEqual(['claude-ui-20260101100000-crash.log', 'claude-ui-20260102100000-crash.log']);
  });

  it('never touches a file that is not one of its own', () => {
    expect(expiredLogs(['chromium.log', 'claude-ui-notes.txt', 'claude-ui-2026.log', 'notes'])).toEqual([]);
  });
});

describe('a launch', () => {
  it('makes the folder and a file named for its start, opening with its path and the header', async () => {
    const log = open();
    log.write('info', 'session', 'started');
    await log.settled();
    expect(await names()).toEqual([FIRST]);
    expect(await lines(FIRST)).toEqual([...header(FIRST), 'INFO  session started']);
  });

  it('ends with the quit line on close, and writes nothing after it', async () => {
    const log = open();
    await log.close();
    log.write('error', 'app', 'too late');
    await log.settled();
    expect(await lines(FIRST)).toEqual([...header(FIRST), 'INFO  app ===== quit =====']);
  });

  it('keeps a message of several lines together, indented', async () => {
    const log = open();
    log.write('error', 'app', 'Error: boom\nat somewhere');
    await log.settled();
    expect((await lines(FIRST)).slice(-2)).toEqual(['ERROR app Error: boom', '    at somewhere']);
  });
});

describe('the previous launch', () => {
  it('is kept as a crash log, and says so, when it ended without its quit line', async () => {
    await seed('claude-ui-20260927100000.log', 'INFO  session started');
    await open().settled();
    expect(await names()).toEqual(['claude-ui-20260927100000-crash.log', FIRST]);
    expect((await lines('claude-ui-20260927100000-crash.log')).at(-1)).toMatch(/^WARN {2}app ===== this launch ended without quitting/);
  });

  it('is left alone when it quit', async () => {
    await seed('claude-ui-20260927100000.log', 'INFO  app ===== quit =====');
    await open().settled();
    expect(await names()).toEqual(['claude-ui-20260927100000.log', FIRST]);
  });

  it('is left alone when it ends by continuing into a file since deleted, since how that run ended is not in it', async () => {
    await seed('claude-ui-20260927100000.log', 'INFO  app ===== continues in claude-ui-20260928000001.log =====');
    await open().settled();
    expect(await names()).toEqual(['claude-ui-20260927100000.log', FIRST]);
  });

  it('is only the newest ordinary file', async () => {
    await seed('claude-ui-20260926100000.log', 'INFO  session started');
    await seed('claude-ui-20260927100000.log', 'INFO  app ===== quit =====');
    await seed('claude-ui-20260927120000-crash.log', 'ERROR app renderer gone');
    await open().settled();
    expect(await names()).toEqual(['claude-ui-20260926100000.log', 'claude-ui-20260927100000.log', 'claude-ui-20260927120000-crash.log', FIRST]);
  });
});

describe('a run that crosses midnight', () => {
  it('starts a new file on its first write of the new date, which says where it came from', async () => {
    vi.setSystemTime(new Date('2026-09-28T21:59:59.000Z')); // 23:59:59 local
    const log = open();
    log.write('info', 'session', 'before');
    await log.settled();
    vi.setSystemTime(new Date('2026-09-28T22:00:03.000Z')); // 00:00:03 on the 29th
    log.write('info', 'session', 'after');
    await log.settled();
    expect(await names()).toEqual(['claude-ui-20260928235959.log', 'claude-ui-20260929000003.log']);
    expect((await lines('claude-ui-20260928235959.log')).slice(-2)).toEqual([
      'INFO  session before',
      'INFO  app ===== continues in claude-ui-20260929000003.log =====',
    ]);
    expect(await lines('claude-ui-20260929000003.log')).toEqual([
      ...header('claude-ui-20260929000003.log', 'continued from claude-ui-20260928235959.log'),
      'INFO  session after',
    ]);
  });

  it('applies retention when the new file starts, not only at launch', async () => {
    for (const day of ['21', '22', '23', '24', '25', '26']) await seed(`claude-ui-202609${day}100000.log`, 'INFO  app ===== quit =====');
    const log = open(); // the 28th: seven dates, nothing to remove yet
    await log.settled();
    expect(await names()).toContain('claude-ui-20260921100000.log');
    vi.setSystemTime(new Date('2026-09-29T08:00:00.000Z'));
    log.write('info', 'session', 'next day');
    await log.settled();
    expect(await names()).not.toContain('claude-ui-20260921100000.log');
  });
});

describe('repeated lines', () => {
  it('are counted and written once, the count at the next different line', async () => {
    const log = open();
    for (let i = 0; i < 5; i++) log.write('error', 'renderer', 'boom');
    log.write('info', 'session', 'different');
    await log.settled();
    expect(await body(FIRST)).toEqual(['ERROR renderer boom', 'ERROR renderer repeated 4 more times: boom', 'INFO  session different']);
  });

  it('leave their count behind within a few seconds even when nothing else is written, so a crash mid-flood still has it', async () => {
    const log = open();
    for (let i = 0; i < 3; i++) log.write('error', 'renderer', 'boom');
    await log.settled();
    expect(await body(FIRST)).toEqual(['ERROR renderer boom']);
    await vi.advanceTimersByTimeAsync(REPEAT_FLUSH_MS);
    await log.settled();
    expect(await body(FIRST)).toEqual(['ERROR renderer boom', 'ERROR renderer repeated 2 more times: boom']);
  });

  it('are the same level, area and message; the same text at another level is a line of its own', async () => {
    const log = open();
    log.write('warn', 'app', 'same');
    log.write('error', 'app', 'same');
    await log.settled();
    expect(await body(FIRST)).toEqual(['WARN  app same', 'ERROR app same']);
  });

  it('have their count written before the quit line', async () => {
    const log = open();
    log.write('error', 'renderer', 'boom');
    log.write('error', 'renderer', 'boom');
    await log.close();
    expect(await body(FIRST)).toEqual(['ERROR renderer boom', 'ERROR renderer repeated 1 more time: boom', 'INFO  app ===== quit =====']);
  });
});

describe('a process that died', () => {
  it('keeps the file as a crash log once it is closed', async () => {
    const log = open();
    log.crash('renderer', 'gone: crashed');
    await log.close();
    expect(await names()).toEqual(['claude-ui-20260928143012-crash.log']);
    expect((await lines('claude-ui-20260928143012-crash.log')).slice(-2)).toEqual(['ERROR renderer gone: crashed', 'INFO  app ===== quit =====']);
  });

  it('marks only the file it happened in, when the run then crosses midnight', async () => {
    const log = open();
    log.crash('renderer', 'gone: crashed');
    await log.settled();
    vi.setSystemTime(new Date('2026-09-29T08:00:00.000Z'));
    log.write('info', 'session', 'next day');
    await log.close();
    expect(await names()).toEqual(['claude-ui-20260928143012-crash.log', 'claude-ui-20260929100000.log']);
  });

  it('is never collapsed into the line before', async () => {
    const log = open();
    log.crash('renderer', 'gone: crashed');
    log.crash('renderer', 'gone: crashed');
    await log.settled();
    expect(await body(FIRST)).toEqual(['ERROR renderer gone: crashed', 'ERROR renderer gone: crashed']);
  });
});

describe('logs deleted while the app runs', () => {
  it('start a new file, with the header, when the current one has gone', async () => {
    const log = open();
    await log.settled();
    await fs.rm(path.join(dir, FIRST));
    log.write('info', 'session', 'after');
    await log.settled();
    expect(await lines(FIRST)).toEqual([...header(FIRST, `started again: ${FIRST} was removed while the app ran`), 'INFO  session after']);
  });

  it('make the folder again when it has gone too', async () => {
    const log = open();
    await log.settled();
    await fs.rm(dir, { recursive: true });
    log.write('info', 'session', 'after');
    await log.settled();
    expect((await lines(FIRST)).at(-1)).toBe('INFO  session after');
  });
});
