import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { metaDir, readMetaFile, useMetaDir, writeMetaFile } from './metafixture';

vi.mock('electron', async () => (await import('./metafixture')).electronStub);

// What meta.json's store says about recovering its file, captured; the log's own helpers are the real ones.
const { logged } = vi.hoisted(() => ({ logged: [] as string[] }));
vi.mock('../../../../src/main/logs/log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/main/logs/log')>()),
  log: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
  logOnce: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
}));

import { migrateToSessionKeys, recordClear } from '../../../../src/main/sessions/metastore';
import { finish, getFinished, getOpenSessions, getPinned, setActiveProject, setOpenSessions, togglePin, unfinish } from '../../../../src/main/sessions/meta';
import { clearNeedsYou, clearSetAside, keep, markNeedsYou, markSetAside, restoreNeedsYou, setAsideCameDue, settleNeedsYouTypes, unkeep } from '../../../../src/main/status/marks';

useMetaDir();

describe('recordClear', () => {
  // Data collection only: nothing reads this back.
  // Nothing in either transcript links a cleared session to its predecessor, so the log is the only account that they are connected.
  it('writes the pairing to the audit log, named or not', async () => {
    await recordClear('old-a', 'new-a', 'Named');
    await recordClear('old-b', 'new-b', '');
    const log = await fs.readFile(path.join(metaDir(), 'meta-audit.log'), 'utf8');
    expect(log).toContain('clear old-a -> new-a title="Named"');
    expect(log).toContain('clear old-b -> new-b');
  });

  // It is a lineage note, not a change to anything stored — so it must not rewrite meta.json to say so.
  it('leaves the stored state untouched', async () => {
    await togglePin('s1');
    const before = await fs.readFile(path.join(metaDir(), 'meta.json'), 'utf8');
    await recordClear('old', 'new', 'Named');
    expect(await fs.readFile(path.join(metaDir(), 'meta.json'), 'utf8')).toBe(before);
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
    expect(await getFinished()).toEqual({ sess2: 123 });
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
    await fs.writeFile(path.join(metaDir(), 'meta.json'), '{ "pinned": ["conv1"');
    // The read falls back to the backup instead of silently resetting.
    expect(await getPinned()).toEqual(['conv1']);
    // The unparseable content is preserved for recovery, not discarded.
    const files = await fs.readdir(metaDir());
    expect(files.some((f) => f.startsWith('meta.json.corrupt-'))).toBe(true);
  });

  it('recovers from the backup when the main file is missing', async () => {
    await togglePin('conv1');
    await setActiveProject('/x'); // creates meta.json.bak holding pinned: [conv1]
    await fs.rm(path.join(metaDir(), 'meta.json'));
    expect(await getPinned()).toEqual(['conv1']);
  });

  it('keeps the previous good copy in .bak and never leaves a temp file behind', async () => {
    await togglePin('conv1');
    await togglePin('conv2'); // backs up the {pinned:[conv1]} state before writing conv2
    const bak = JSON.parse(await fs.readFile(path.join(metaDir(), 'meta.json.bak'), 'utf8'));
    expect(bak.pinned).toEqual(['conv1']);
    expect((await fs.readdir(metaDir())).some((f) => f.endsWith('.tmp'))).toBe(false);
  });

  // "My pins and tabs are gone" starts here, so the log says which copy the app went on with.
  describe('what the log says', () => {
    beforeEach(() => {
      logged.length = 0;
    });

    it('nothing on a first run, with no file and no backup', async () => {
      await getPinned();
      expect(logged).toEqual([]);
    });

    it('that a missing file was recovered from the backup', async () => {
      await togglePin('conv1');
      await setActiveProject('/x');
      await fs.rm(path.join(metaDir(), 'meta.json'));
      logged.length = 0;
      await getPinned();
      expect(logged).toEqual([`warn meta ${path.join(metaDir(), 'meta.json')} is missing, using the backup`]);
    });

    it('that a corrupt file was kept, and which copy replaced it', async () => {
      await togglePin('conv1');
      await setActiveProject('/x');
      await fs.writeFile(path.join(metaDir(), 'meta.json'), '{ "pinned": ["conv1"');
      logged.length = 0;
      await getPinned();
      const kept = (await fs.readdir(metaDir())).find((f) => f.startsWith('meta.json.corrupt-'));
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatch(new RegExp(`^error meta ${path.join(metaDir(), 'meta.json')} does not parse \\(.+\\), kept as ${kept}, recovered from the backup$`));
    });

    it('that a write failed, as well as rejecting it', async () => {
      await togglePin('conv1');
      // A directory where the temp file goes makes the write itself fail.
      await fs.mkdir(path.join(metaDir(), 'meta.json.tmp'));
      logged.length = 0;
      await expect(togglePin('conv2')).rejects.toThrow();
      expect(logged).toEqual([expect.stringMatching(new RegExp(`^error meta ${path.join(metaDir(), 'meta.json')} not saved: EISDIR`))]);
    });
  });
});

describe('write serialization', () => {
  it('serializes concurrent writes so the last logical change wins (no stale overwrite)', async () => {
    // Fired together, these race in readMeta/writeMeta; without serialization a stale write can win.
    await Promise.all([
      setOpenSessions(['a'], []),
      setOpenSessions(['a', 'b'], []),
      setOpenSessions(['a', 'b', 'c'], []),
    ]);
    expect(await getOpenSessions()).toEqual(['a', 'b', 'c']);
  });

  it('does not lose one field when different ops race (read-modify-write stays atomic)', async () => {
    await Promise.all([togglePin('p1'), setOpenSessions(['o1'], [])]);
    expect(await getPinned()).toEqual(['p1']);
    expect(await getOpenSessions()).toEqual(['o1']);
  });
});

// A meta file can be read by a build that is not the one that wrote it: versions get skipped, and an older build can be installed over a newer one.
describe('across app versions', () => {
  it('stamps the writing version into the file', async () => {
    process.env.TEST_APPVERSION = '0.2.0';
    await togglePin('s1');
    expect((await readMetaFile()).appVersion).toBe('0.2.0');
  });

  it('keeps a stamped copy of the file the previous version left behind', async () => {
    process.env.TEST_APPVERSION = '0.1.0';
    await togglePin('kept-by-0.1.0');

    process.env.TEST_APPVERSION = '0.2.0';
    await togglePin('added-by-0.2.0');

    // The rolling .bak is overwritten by the very next write; this one is not, which is the point.
    const snapshot = JSON.parse(await fs.readFile(path.join(metaDir(), 'meta.json.0.1.0.bak'), 'utf8'));
    expect(snapshot.pinned).toEqual(['kept-by-0.1.0']);
    expect(snapshot.appVersion).toBe('0.1.0');
    expect((await readMetaFile()).appVersion).toBe('0.2.0');
  });

  it('takes only one snapshot per version, not one per write', async () => {
    process.env.TEST_APPVERSION = '0.1.0';
    await togglePin('a');
    process.env.TEST_APPVERSION = '0.2.0';
    await togglePin('b');
    const first = await fs.readFile(path.join(metaDir(), 'meta.json.0.1.0.bak'), 'utf8');
    await togglePin('c');
    // A second snapshot would capture 0.2.0's own writes and destroy the pre-upgrade state.
    expect(await fs.readFile(path.join(metaDir(), 'meta.json.0.1.0.bak'), 'utf8')).toBe(first);
  });

  it('records a downgrade in the audit log, so a rollback is visible', async () => {
    process.env.TEST_APPVERSION = '0.3.0';
    await togglePin('a');
    process.env.TEST_APPVERSION = '0.2.0'; // someone was handed an older build
    await togglePin('b');
    const log = await fs.readFile(path.join(metaDir(), 'meta-audit.log'), 'utf8');
    expect(log).toContain('DOWNGRADE 0.3.0 -> 0.2.0');
  });

  it('preserves keys it does not know, so an older build cannot drop a newer one\'s data', async () => {
    // What a future version might add, written by a build that understands it.
    await writeMetaFile({ pinned: ['s1'], version: 3, appVersion: '9.0.0', somethingNew: { a: 1 } });
    // This build has never heard of `somethingNew`, and rewrites the file for an unrelated reason.
    await togglePin('s2');
    const after = await readMetaFile();
    expect(after.somethingNew).toEqual({ a: 1 });
    expect(after.pinned).toEqual(['s1', 's2']);
    // The container itself is an implementation detail and must not leak into the file.
    expect('extra' in after).toBe(false);
  });
});

// The audit log grows by one line per meta write and is bounded by size.
// It is tested because the bound has failed silently once already: it used to be triggered only when a startup marker was written elsewhere, so removing that marker left the file growing forever with nothing to notice.
describe('audit log', () => {
  const auditFile = (): string => path.join(metaDir(), 'meta-audit.log');

  it('records one line per write', async () => {
    await togglePin('s1');
    await togglePin('s2');
    const lines = (await fs.readFile(auditFile(), 'utf8')).split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('togglePin');
  });

  it('trims itself once it passes the size cap, and keeps the NEWEST lines', async () => {
    // Seed well past the 256KB cap.
    // The content does not matter, only that the next real write finds an oversized file; `marker` proves the survivors are the tail, not the head.
    await fs.writeFile(auditFile(), `${'x'.repeat(300 * 1024)}\nmarker-last\n`);
    await togglePin('s1');
    const text = await fs.readFile(auditFile(), 'utf8');
    expect(text.length).toBeLessThan(256 * 1024);
    expect(text).toContain('marker-last');
    expect(text).toContain('togglePin');
  });
});

describe('the usage record', () => {
  /** The usage record's events so far, without their moments. */
  async function usage(): Promise<unknown[]> {
    const text = await fs.readFile(path.join(metaDir(), 'usage.log'), 'utf8').catch(() => '');
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line.slice(line.indexOf(' ') + 1)) as unknown);
  }

  it('takes a line per decision, of the sessions it changed, and none for a decision that changed nothing', async () => {
    await finish(['a', 'b']);
    await finish(['a', 'c']);
    await unfinish(['b', 'x']);
    await markSetAside(['d'], null, 1);
    await clearSetAside(['d', 'x']);
    await keep(['e'], 1);
    await unkeep(['e', 'x']);
    await unfinish(['x']);
    await clearSetAside(['x']);
    await unkeep(['x']);
    expect(await usage()).toEqual([
      { kind: 'decide', act: 'finish', ids: ['a', 'b'] },
      { kind: 'decide', act: 'finish', ids: ['c'] },
      { kind: 'decide', act: 'unfinish', ids: ['b'] },
      { kind: 'decide', act: 'setAside', ids: ['d'] },
      { kind: 'decide', act: 'clearSetAside', ids: ['d'] },
      { kind: 'decide', act: 'keep', ids: ['e'] },
      { kind: 'decide', act: 'unkeep', ids: ['e'] },
    ]);
  });

  it('names what wrote a decision you did not take: a prompt clearing a set-aside mark, a resume unfinishing', async () => {
    await finish(['a']);
    await markSetAside(['b'], null, 1);
    await unfinish(['a'], 'resume');
    await clearSetAside(['b'], 'prompt');
    expect((await usage()).slice(2)).toEqual([
      { kind: 'decide', act: 'unfinish', ids: ['a'], by: 'resume' },
      { kind: 'decide', act: 'clearSetAside', ids: ['b'], by: 'prompt' },
    ]);
  });

  it('takes a line per session whose needs-you reasons a write marked, settled or put back, with what settled them', async () => {
    const closed = { type: 'app.was-running', at: 1, how: 'quit' } as const;
    await markNeedsYou(['a', 'b'], [closed]);
    await markNeedsYou(['a'], [{ type: 'app.was-running', at: 2, how: 'ended' }]);
    await clearNeedsYou('a', 'prompt');
    await restoreNeedsYou('a', [closed]);
    await finish(['a']);
    await settleNeedsYouTypes(['app.was-running']);
    await markSetAside(['c'], 5, 1);
    await setAsideCameDue(10);
    await clearNeedsYou('x', 'cleared');
    expect((await usage()).filter((event) => (event as { kind: string }).kind === 'needsYou')).toEqual([
      { kind: 'needsYou', act: 'marked', id: 'a', types: ['app.was-running'] },
      { kind: 'needsYou', act: 'marked', id: 'b', types: ['app.was-running'] },
      { kind: 'needsYou', act: 'settled', id: 'a', types: ['app.was-running'], by: 'replaced' },
      { kind: 'needsYou', act: 'marked', id: 'a', types: ['app.was-running'] },
      { kind: 'needsYou', act: 'settled', id: 'a', types: ['app.was-running'], by: 'prompt' },
      { kind: 'needsYou', act: 'restored', id: 'a', types: ['app.was-running'] },
      { kind: 'needsYou', act: 'settled', id: 'a', types: ['app.was-running'], by: 'finished' },
      { kind: 'needsYou', act: 'settled', id: 'b', types: ['app.was-running'], by: 'off' },
      { kind: 'needsYou', act: 'marked', id: 'c', types: ['app.reminder'] },
    ]);
  });
});
