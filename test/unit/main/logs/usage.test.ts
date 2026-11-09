import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('electron', () => ({
  app: { getPath: () => process.env.TEST_USERDATA },
}));

const { logged } = vi.hoisted(() => ({ logged: [] as string[] }));
vi.mock('../../../../src/main/logs/log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/main/logs/log')>()),
  logOnce: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
}));

import { keptUsage, needsYouUsage, recordUsage, reviewUsageOf, trimUsage, USAGE_KEPT_DAYS } from '../../../../src/main/logs/usage';

const DAY = 86_400_000;
let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-ui-usage-'));
  process.env.TEST_USERDATA = dir;
  logged.length = 0;
});

const file = (): string => path.join(dir, 'usage.log');

describe('recordUsage', () => {
  it('appends a stamped JSON line per event, in the order given', async () => {
    await recordUsage([{ kind: 'decide', act: 'finish', ids: ['a'] }]);
    await recordUsage([
      { kind: 'review', act: 'start', scope: 'all', offered: 3 },
      { kind: 'review', act: 'end', scope: 'all', offered: 1 },
    ]);
    const lines = (await fs.readFile(file(), 'utf8')).split('\n').filter(Boolean);
    expect(lines.map((line) => Number.isFinite(Date.parse(line.slice(0, line.indexOf(' ')))))).toEqual([true, true, true]);
    expect(lines.map((line) => JSON.parse(line.slice(line.indexOf(' ') + 1)) as unknown)).toEqual([
      { kind: 'decide', act: 'finish', ids: ['a'] },
      { kind: 'review', act: 'start', scope: 'all', offered: 3 },
      { kind: 'review', act: 'end', scope: 'all', offered: 1 },
    ]);
  });

  it('writes nothing for no events', async () => {
    await recordUsage([]);
    await expect(fs.access(file())).rejects.toThrow();
  });

  it('logs a failed append and resolves, rather than failing the write it records', async () => {
    await fs.mkdir(file());
    await expect(recordUsage([{ kind: 'decide', act: 'keep', ids: ['a'] }])).resolves.toBeUndefined();
    expect(logged).toEqual([expect.stringMatching(/^warn usage .*usage\.log not written: /)]);
  });
});

describe('keeping the record bounded', () => {
  const now = Date.parse('2026-11-08T12:00:00.000+01:00');
  const line = (at: number, text: string): string => `${new Date(at).toISOString()} ${text}\n`;

  it(`keeps the lines of the last ${USAGE_KEPT_DAYS} days and drops older ones and any whose moment cannot be read`, () => {
    const old = line(now - (USAGE_KEPT_DAYS + 1) * DAY, '{"old":1}');
    const recent = line(now - (USAGE_KEPT_DAYS - 1) * DAY, '{"recent":1}');
    expect(keptUsage(`${old}garbage\n${recent}`, now)).toBe(recent);
  });

  it('rewrites the file only to drop lines, and leaves no file where there was none', async () => {
    await trimUsage(now);
    await expect(fs.access(file())).rejects.toThrow();
    const recent = line(now - DAY, '{"recent":1}');
    await fs.writeFile(file(), `${line(now - (USAGE_KEPT_DAYS + 1) * DAY, '{"old":1}')}${recent}`);
    await trimUsage(now);
    expect(await fs.readFile(file(), 'utf8')).toBe(recent);
    expect(logged).toEqual([]);
  });
});

describe('reviewUsageOf', () => {
  it('takes the review opening or ending as the window sends it', () => {
    expect(reviewUsageOf('start', 'project', 4)).toEqual({ kind: 'review', act: 'start', scope: 'project', offered: 4 });
  });

  it.each([
    ['an unknown act', 'open', 'all', 1],
    ['an unknown scope', 'end', 'everything', 1],
    ['a count that is not a whole number', 'end', 'all', 1.5],
    ['a negative count', 'end', 'all', -1],
    ['a count that is not a number', 'end', 'all', '1'],
  ])('refuses %s', (_name, act, scope, offered) => {
    expect(reviewUsageOf(act, scope, offered)).toBeNull();
  });
});

describe('needsYouUsage', () => {
  const closed = { type: 'app.was-running', at: 1, how: 'quit' } as const;
  const reminder = { type: 'app.reminder', at: 2 } as const;

  it('names per session the reasons that went, with what settled them, and those that came', () => {
    expect(needsYouUsage({ a: [closed], b: [reminder] }, { a: [reminder], b: [reminder] }, { by: 'replaced' })).toEqual([
      { kind: 'needsYou', act: 'settled', id: 'a', types: ['app.was-running'], by: 'replaced' },
      { kind: 'needsYou', act: 'marked', id: 'a', types: ['app.reminder'] },
    ]);
  });

  it('names the reasons Undo put back as restored', () => {
    expect(needsYouUsage({}, { a: [closed] }, { by: 'replaced', came: 'restored' })).toEqual([{ kind: 'needsYou', act: 'restored', id: 'a', types: ['app.was-running'] }]);
  });
});
