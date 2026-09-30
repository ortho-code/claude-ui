import { describe, it, expect, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { localTimestamp, appendStamped, formatDuration } from '../../../src/main/stamp';

// Node re-reads TZ when it is assigned, so each case can pin a zone. Restored afterwards, since the rest of the file must not depend on which case ran last.
const originalTz = process.env.TZ;
afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

function inZone(tz: string, iso: string): string {
  process.env.TZ = tz;
  return localTimestamp(new Date(iso));
}

describe('localTimestamp', () => {
  it('writes local time with its offset, in summer and in winter', () => {
    expect(inZone('Europe/Amsterdam', '2026-09-28T12:30:12.345Z')).toBe('2026-09-28T14:30:12.345+02:00');
    expect(inZone('Europe/Amsterdam', '2026-01-15T12:30:12.345Z')).toBe('2026-01-15T13:30:12.345+01:00');
  });

  it('writes UTC as +00:00', () => {
    expect(inZone('UTC', '2026-09-28T12:30:12.345Z')).toBe('2026-09-28T12:30:12.345+00:00');
  });

  it('signs an offset behind UTC as negative, and keeps its minutes', () => {
    expect(inZone('America/New_York', '2026-09-28T12:30:12.345Z')).toBe('2026-09-28T08:30:12.345-04:00');
    expect(inZone('Asia/Kolkata', '2026-09-28T12:30:12.345Z')).toBe('2026-09-28T18:00:12.345+05:30');
    expect(inZone('America/St_Johns', '2026-01-15T12:30:12.345Z')).toBe('2026-01-15T09:00:12.345-03:30');
  });

  it('pads every field, milliseconds to three digits', () => {
    expect(inZone('UTC', '2026-01-02T03:04:05.006Z')).toBe('2026-01-02T03:04:05.006+00:00');
  });

  it('crosses the date line with the local date, not the UTC one', () => {
    expect(inZone('Europe/Amsterdam', '2026-09-28T23:30:00.000Z')).toBe('2026-09-29T01:30:00.000+02:00');
  });

  it('tells apart the two moments the clocks show twice when they go back', () => {
    // 2026-10-25 02:30 happens twice in Amsterdam; the offset is the only difference.
    expect(inZone('Europe/Amsterdam', '2026-10-25T00:30:00.000Z')).toBe('2026-10-25T02:30:00.000+02:00');
    expect(inZone('Europe/Amsterdam', '2026-10-25T01:30:00.000Z')).toBe('2026-10-25T02:30:00.000+01:00');
  });

  it('parses back to the moment it was made from', () => {
    for (const tz of ['Europe/Amsterdam', 'America/New_York', 'Asia/Kolkata', 'UTC']) {
      process.env.TZ = tz;
      const moment = new Date('2026-09-28T12:30:12.345Z');
      expect(new Date(localTimestamp(moment)).getTime()).toBe(moment.getTime());
    }
  });
});

describe('formatDuration', () => {
  it('says each size of duration in the unit it is read in', () => {
    expect(formatDuration(850)).toBe('850 ms');
    expect(formatDuration(12_345)).toBe('12.3 s');
    expect(formatDuration(245_000)).toBe('4m 05s');
    expect(formatDuration(7_380_000)).toBe('2h 03m');
  });

  it('moves up a unit exactly at each boundary', () => {
    expect(formatDuration(999)).toBe('999 ms');
    expect(formatDuration(1000)).toBe('1.0 s');
    expect(formatDuration(59_999)).toBe('59.9 s');
    expect(formatDuration(60_000)).toBe('1m 00s');
    expect(formatDuration(3_600_000)).toBe('1h 00m');
  });
});

describe('appendStamped', () => {
  it('appends one stamped line per call, after what is already there', async () => {
    const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'claude-ui-stamp-')), 'record.log');
    await fs.writeFile(file, 'earlier\n');
    await appendStamped(file, 'first');
    await appendStamped(file, 'second');
    const lines = (await fs.readFile(file, 'utf8')).split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('earlier');
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2} first$/);
    expect(lines[2]).toMatch(/ second$/);
    expect(lines[3]).toBe('');
  });

  it('with create: false, appends to a file that is there and refuses one that has gone', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-ui-stamp-'));
    const file = path.join(dir, 'record.log');
    await fs.writeFile(file, 'earlier\n');
    await appendStamped(file, 'kept', { create: false });
    expect(await fs.readFile(file, 'utf8')).toMatch(/^earlier\n.* kept\n$/);
    await fs.rm(file);
    await expect(appendStamped(file, 'lost', { create: false })).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.access(file)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
