import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// meta.ts stores its JSON under app.getPath('userData'); point that at a fresh temp dir per test.
vi.mock('electron', () => ({ app: { getPath: () => process.env.TEST_USERDATA } }));

import {
  getPinned,
  togglePin,
  getArchived,
  toggleArchive,
  purgeSession,
  getOpenSessions,
  setOpenSessions,
  getActiveProject,
  setActiveProject,
  migrateToSessionKeys,
} from './meta';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-ui-meta-'));
  process.env.TEST_USERDATA = dir;
});

async function writeMetaFile(contents: unknown): Promise<void> {
  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(contents));
}

describe('pins', () => {
  it('toggles a pin on and off', async () => {
    expect(await getPinned()).toEqual([]);
    expect(await togglePin('conv1')).toEqual(['conv1']);
    expect(await getPinned()).toEqual(['conv1']);
    expect(await togglePin('conv1')).toEqual([]);
  });
});

describe('archive', () => {
  it('archives with a timestamp and unarchives', async () => {
    const archived = await toggleArchive('conv1');
    expect(Object.keys(archived)).toEqual(['conv1']);
    expect(archived.conv1).toBeGreaterThan(0);
    expect(await toggleArchive('conv1')).toEqual({});
  });

  it('reads a legacy archived id-array as a map with unknown (0) timestamps', async () => {
    await writeMetaFile({ pinned: [], openSessions: [], archived: ['a', 'b'], version: 2 });
    expect(await getArchived()).toEqual({ a: 0, b: 0 });
  });
});

describe('purgeSession', () => {
  it('drops the session from pins, open tabs and archive', async () => {
    await togglePin('conv1');
    await toggleArchive('conv1');
    await setOpenSessions(['conv1', 'conv2']);
    await purgeSession('conv1');
    expect(await getPinned()).toEqual([]);
    expect(await getArchived()).toEqual({});
    expect(await getOpenSessions()).toEqual(['conv2']);
  });
});

describe('migrateToSessionKeys', () => {
  it('remaps conversation keys to session ids across pins, tabs and archive, then is idempotent', async () => {
    await writeMetaFile({
      pinned: ['conv1'],
      openSessions: ['conv1', 'conv2'],
      archived: { conv2: 123 },
      version: 2,
    });
    await migrateToSessionKeys(new Map([['conv1', 'sess1'], ['conv2', 'sess2']]));
    expect(await getPinned()).toEqual(['sess1']);
    expect(await getOpenSessions()).toEqual(['sess1', 'sess2']);
    expect(await getArchived()).toEqual({ sess2: 123 });
    // Already at version 3: a second run must not remap again.
    await migrateToSessionKeys(new Map([['sess1', 'other']]));
    expect(await getPinned()).toEqual(['sess1']);
  });

  it('passes through id keys and keys naming no known session (covers a v1 file too)', async () => {
    await writeMetaFile({ pinned: ['sess-already-id', 'gone-from-disk'], openSessions: [], version: 1 });
    await migrateToSessionKeys(new Map([['conv1', 'sess1']]));
    expect(await getPinned()).toEqual(['sess-already-id', 'gone-from-disk']);
  });
});

describe('corruption safety', () => {
  it('recovers from the backup when the main file is corrupted, and preserves the corrupt copy', async () => {
    await togglePin('conv1'); // first write: creates meta.json
    await setActiveProject('/x'); // second write: backs up the good meta.json to meta.json.bak
    // Simulate a write truncated by a crash.
    await fs.writeFile(path.join(dir, 'meta.json'), '{ "pinned": ["conv1"');
    // The read falls back to the backup instead of silently resetting.
    expect(await getPinned()).toEqual(['conv1']);
    // The unparseable content is preserved for recovery, not discarded.
    const files = await fs.readdir(dir);
    expect(files.some((f) => f.startsWith('meta.json.corrupt-'))).toBe(true);
  });

  it('recovers from the backup when the main file is missing', async () => {
    await togglePin('conv1');
    await setActiveProject('/x'); // creates meta.json.bak holding pinned: [conv1]
    await fs.rm(path.join(dir, 'meta.json'));
    expect(await getPinned()).toEqual(['conv1']);
  });

  it('keeps the previous good copy in .bak and never leaves a temp file behind', async () => {
    await togglePin('conv1');
    await togglePin('conv2'); // backs up the {pinned:[conv1]} state before writing conv2
    const bak = JSON.parse(await fs.readFile(path.join(dir, 'meta.json.bak'), 'utf8'));
    expect(bak.pinned).toEqual(['conv1']);
    expect((await fs.readdir(dir)).some((f) => f.endsWith('.tmp'))).toBe(false);
  });
});

describe('write serialization', () => {
  it('serializes concurrent writes so the last logical change wins (no stale overwrite)', async () => {
    // Fired together, these race in readMeta/writeMeta; without serialization a stale write can win.
    await Promise.all([
      setOpenSessions(['a']),
      setOpenSessions(['a', 'b']),
      setOpenSessions(['a', 'b', 'c']),
    ]);
    expect(await getOpenSessions()).toEqual(['a', 'b', 'c']);
  });

  it('does not lose one field when different ops race (read-modify-write stays atomic)', async () => {
    await Promise.all([togglePin('p1'), setOpenSessions(['o1'])]);
    expect(await getPinned()).toEqual(['p1']);
    expect(await getOpenSessions()).toEqual(['o1']);
  });
});

describe('active project', () => {
  it('defaults to null and round-trips a project and back to All', async () => {
    expect(await getActiveProject()).toBeNull();
    await setActiveProject('/home/me/dev/scienta');
    expect(await getActiveProject()).toBe('/home/me/dev/scienta');
    await setActiveProject(null);
    expect(await getActiveProject()).toBeNull();
  });

  it('ignores a non-string persisted value', async () => {
    await writeMetaFile({ activeProject: 42 });
    expect(await getActiveProject()).toBeNull();
  });

  // The key was `activeFolder` before the project/folder split; an existing meta.json must keep its
  // scope rather than silently reverting to All.
  it('reads the legacy activeFolder key and rewrites it under the new name', async () => {
    await writeMetaFile({ activeFolder: '/home/me/dev/scienta' });
    expect(await getActiveProject()).toBe('/home/me/dev/scienta');
    await setActiveProject('/home/me/dev/other'); // any write persists the new key
    expect(await getActiveProject()).toBe('/home/me/dev/other');
  });
});
