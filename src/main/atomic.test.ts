import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeFileAtomic } from './atomic';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-ui-atomic-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('writing a file atomically', () => {
  it('writes a new file and leaves no temp file behind', async () => {
    const file = path.join(dir, 'a.json');
    await writeFileAtomic(file, '{"a":1}');
    expect(await fs.readFile(file, 'utf8')).toBe('{"a":1}');
    expect(await fs.readdir(dir)).toEqual(['a.json']);
  });

  it('replaces what was there', async () => {
    const file = path.join(dir, 'a.json');
    await fs.writeFile(file, 'old');
    await writeFileAtomic(file, 'new');
    expect(await fs.readFile(file, 'utf8')).toBe('new');
  });

  it('replaces the file a symlink points at, and leaves the link a link', async () => {
    const real = path.join(dir, 'real.json');
    const link = path.join(dir, 'link.json');
    await fs.writeFile(real, 'old');
    await fs.symlink(real, link);
    await writeFileAtomic(link, 'new');
    expect((await fs.lstat(link)).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(real, 'utf8')).toBe('new');
  });

  it('keeps the permission bits of the file it replaces', async () => {
    const file = path.join(dir, 'a.json');
    await fs.writeFile(file, 'old');
    await fs.chmod(file, 0o600);
    await writeFileAtomic(file, 'new');
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });

  it('leaves the old contents in place when the write fails', async () => {
    const file = path.join(dir, 'a.json');
    await fs.writeFile(file, 'old');
    // A directory where the temp file goes makes the write itself fail.
    await fs.mkdir(`${file}.tmp`);
    await expect(writeFileAtomic(file, 'new')).rejects.toThrow(/EISDIR/);
    expect(await fs.readFile(file, 'utf8')).toBe('old');
  });
});
