import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { goodCopy, writeWithBackups, type Backups } from '../../../src/main/backup';

let dir: string;
let file: string;

const isJson = (text: string): boolean => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

/** Backups beside the file, written by the same version that wrote it last, unless a case says otherwise. */
const beside = (more: Partial<Backups> = {}): Backups => ({ at: file, isGood: isJson, outgoing: '1.0.0', current: '1.0.0', ...more });

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-ui-backup-'));
  file = path.join(dir, 'a.json');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('writing a file with its backups', () => {
  it('writes a first file with no copies, there being nothing to keep', async () => {
    await writeWithBackups(file, '{"a":1}', beside());
    expect(await fs.readFile(file, 'utf8')).toBe('{"a":1}');
    expect(await fs.readdir(dir)).toEqual(['a.json']);
  });

  it('keeps what was there as the previous good copy', async () => {
    await fs.writeFile(file, '{"a":1}');
    await writeWithBackups(file, '{"a":2}', beside());
    expect(await fs.readFile(file, 'utf8')).toBe('{"a":2}');
    expect(await fs.readFile(goodCopy(file), 'utf8')).toBe('{"a":1}');
  });

  it('never lets a corrupt file replace a good copy', async () => {
    await fs.writeFile(goodCopy(file), '{"a":1}');
    await fs.writeFile(file, '{"a":');
    await writeWithBackups(file, '{"a":3}', beside());
    expect(await fs.readFile(goodCopy(file), 'utf8')).toBe('{"a":1}');
  });

  it('keeps the file as the outgoing version left it, and says so before anything overwrites it', async () => {
    await fs.writeFile(file, '{"by":"0.9.0"}');
    const told: string[] = [];
    await writeWithBackups(file, '{"by":"1.0.0"}', beside({ outgoing: '0.9.0', onVersionChange: async () => void told.push(await fs.readFile(file, 'utf8')) }));
    expect(await fs.readFile(`${file}.0.9.0.bak`, 'utf8')).toBe('{"by":"0.9.0"}');
    expect(told).toEqual(['{"by":"0.9.0"}']);
  });

  it('takes no version copy when the version is the same, or was never known', async () => {
    await fs.writeFile(file, '{"a":1}');
    let told = 0;
    const count = async (): Promise<void> => void (told += 1);
    await writeWithBackups(file, '{"a":2}', beside({ onVersionChange: count }));
    await writeWithBackups(file, '{"a":3}', beside({ outgoing: '', onVersionChange: count }));
    expect(told).toBe(0);
    expect((await fs.readdir(dir)).sort()).toEqual(['a.json', 'a.json.bak']);
  });

  it('writes even when telling of the version change fails', async () => {
    await fs.writeFile(file, '{"a":1}');
    await writeWithBackups(file, '{"a":2}', beside({ outgoing: '0.9.0', onVersionChange: () => Promise.reject(new Error('no audit log')) }));
    expect(await fs.readFile(file, 'utf8')).toBe('{"a":2}');
  });

  it('keeps the copies in a folder of their own when told to, making it', async () => {
    const at = path.join(dir, 'backups', 'config', 'a.json');
    await fs.writeFile(file, '{"a":1}');
    await writeWithBackups(file, '{"a":2}', beside({ at, outgoing: '0.9.0' }));
    expect((await fs.readdir(path.dirname(at))).sort()).toEqual(['a.json.0.9.0.bak', 'a.json.bak']);
    expect(await fs.readdir(dir)).toContain('a.json');
    expect(await fs.readdir(dir)).not.toContain('a.json.bak');
  });
});
