import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// meta.ts stores its JSON under app.getPath('userData'); point that at a fresh temp dir per test.
// getVersion feeds the appVersion stamp and the version-change backup, so tests can move it.
vi.mock('electron', () => ({
  app: { getPath: () => process.env.TEST_USERDATA, getVersion: () => process.env.TEST_APPVERSION ?? '1.0.0' },
}));

// What meta.ts says about recovering its file, captured; the log's own helpers are the real ones.
const { logged } = vi.hoisted(() => ({ logged: [] as string[] }));
vi.mock('../../../src/main/log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/main/log')>()),
  log: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
  logOnce: (level: string, area: string, message: string) => logged.push(`${level} ${area} ${message}`),
}));

import {
  getPinned,
  togglePin,
  getHistoryPins,
  toggleHistoryPin,
  getArchived,
  toggleArchive,
  purgeSession,
  getOpenSessions,
  setOpenSessions,
  getActiveProject,
  setActiveProject,
  migrateToSessionKeys,
  getGroupState,
  createGroup,
  renameGroup,
  deleteGroup,
  moveSessionToGroup,
  moveGroup,
  getProjectOrder,
  seedProjectOrder,
  moveProject,
  getNotes,
  setNote,
  getWindowBounds,
  setWindowBounds,
  getUiState,
  setUiState,
  getSettings,
  setSettings,
  recordClear,
} from '../../../src/main/meta';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-ui-meta-'));
  process.env.TEST_USERDATA = dir;
  delete process.env.TEST_APPVERSION; // back to the default 1.0.0 unless a test moves it
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

describe('history pins', () => {
  const pin = { kind: 'request' as const, session: 's1', text: 'why does the sniff not fire?', time: '2026-09-29T10:00:00Z' };

  it('pins a request by its uuid with what a list shows of it, and unpins it', async () => {
    expect(await getHistoryPins()).toEqual({});
    const pinned = await toggleHistoryPin('u1', pin);
    expect(Object.keys(pinned)).toEqual(['u1']);
    expect(pinned.u1).toMatchObject(pin);
    expect(pinned.u1.pinnedAt).toBeGreaterThan(0);
    expect(await getHistoryPins()).toEqual(pinned);
    expect(await toggleHistoryPin('u1', pin)).toEqual({});
  });

  it('pins one of claude\'s messages as a reply', async () => {
    const pinned = await toggleHistoryPin('a1:0', { ...pin, kind: 'reply', text: 'Found it.' });
    expect(pinned['a1:0']).toMatchObject({ kind: 'reply', text: 'Found it.' });
  });

  it('keeps only the opening of a long text', async () => {
    const pinned = await toggleHistoryPin('u1', { ...pin, text: 'x'.repeat(1000) });
    expect(pinned.u1.text).toHaveLength(300);
  });

  it('refuses a pin that arrives malformed', async () => {
    expect(await toggleHistoryPin('u1', { ...pin, text: 42 } as never)).toEqual({});
    expect(await toggleHistoryPin('u1', { ...pin, kind: 'other' } as never)).toEqual({});
    expect(await toggleHistoryPin('', pin)).toEqual({});
  });

  it('drops a stored pin missing its session or text, and keeps the rest', async () => {
    await writeMetaFile({ version: 3, historyPins: { good: { ...pin, pinnedAt: 5 }, noText: { session: 's1', time: 't' }, broken: 'yes', old: { ...pin } } });
    expect(await getHistoryPins()).toEqual({ good: { ...pin, pinnedAt: 5 }, old: { ...pin, pinnedAt: 0 } });
  });

  it('reads the pins stored under their old name, before a reply could be pinned, as requests', async () => {
    await writeMetaFile({ version: 3, requestPins: { u1: { session: pin.session, text: pin.text, time: pin.time, pinnedAt: 5 } } });
    expect(await getHistoryPins()).toEqual({ u1: { ...pin, pinnedAt: 5 } });
  });

  it('survives deleting the session it was pinned in, since a fork sibling may still carry the request', async () => {
    await toggleHistoryPin('u1', pin);
    await purgeSession('s1');
    expect(Object.keys(await getHistoryPins())).toEqual(['u1']);
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

describe('recordClear', () => {
  // Data collection only: nothing reads this back.
  // Nothing in either transcript links a cleared session to its predecessor, so the log is the only account that they are connected.
  it('writes the pairing to the audit log, named or not', async () => {
    await recordClear('old-a', 'new-a', 'Named');
    await recordClear('old-b', 'new-b', '');
    const log = await fs.readFile(path.join(dir, 'meta-audit.log'), 'utf8');
    expect(log).toContain('clear old-a -> new-a title="Named"');
    expect(log).toContain('clear old-b -> new-b');
  });

  // It is a lineage note, not a change to anything stored — so it must not rewrite meta.json to say so.
  it('leaves the stored state untouched', async () => {
    await togglePin('s1');
    const before = await fs.readFile(path.join(dir, 'meta.json'), 'utf8');
    await recordClear('old', 'new', 'Named');
    expect(await fs.readFile(path.join(dir, 'meta.json'), 'utf8')).toBe(before);
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
      await fs.rm(path.join(dir, 'meta.json'));
      logged.length = 0;
      await getPinned();
      expect(logged).toEqual([`warn meta ${path.join(dir, 'meta.json')} is missing, using the backup`]);
    });

    it('that a corrupt file was kept, and which copy replaced it', async () => {
      await togglePin('conv1');
      await setActiveProject('/x');
      await fs.writeFile(path.join(dir, 'meta.json'), '{ "pinned": ["conv1"');
      logged.length = 0;
      await getPinned();
      const kept = (await fs.readdir(dir)).find((f) => f.startsWith('meta.json.corrupt-'));
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatch(new RegExp(`^error meta ${path.join(dir, 'meta.json')} does not parse \\(.+\\), kept as ${kept}, recovered from the backup$`));
    });

    it('that a write failed, as well as rejecting it', async () => {
      await togglePin('conv1');
      // A directory where the temp file goes makes the write itself fail.
      await fs.mkdir(path.join(dir, 'meta.json.tmp'));
      logged.length = 0;
      await expect(togglePin('conv2')).rejects.toThrow();
      expect(logged).toEqual([expect.stringMatching(new RegExp(`^error meta ${path.join(dir, 'meta.json')} not saved: EISDIR`))]);
    });
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

  // The key was `activeFolder` before the project/folder split; an existing meta.json must keep its scope rather than silently reverting to All.
  it('reads the legacy activeFolder key and rewrites it under the new name', async () => {
    await writeMetaFile({ activeFolder: '/home/me/dev/scienta' });
    expect(await getActiveProject()).toBe('/home/me/dev/scienta');
    await setActiveProject('/home/me/dev/other'); // any write persists the new key
    expect(await getActiveProject()).toBe('/home/me/dev/other');
  });
});

describe('session groups', () => {
  it('prepends a new group so it lands at the top of its project', async () => {
    expect(await getGroupState()).toEqual({ groups: [], groupOf: {} });
    await createGroup('Perf pass', '/repo');
    const { groups } = await createGroup('Custom groups', '/repo');
    expect(groups.map((g) => g.name)).toEqual(['Custom groups', 'Perf pass']);
    expect(groups.every((g) => g.repoRoot === '/repo')).toBe(true);
  });

  it('creates and moves a session in one step (the row menu\'s "New group…")', async () => {
    const { groups, groupOf } = await createGroup('Perf pass', '/repo', 's1');
    expect(groupOf).toEqual({ s1: groups[0].id });
  });

  it('ignores a blank name on create and on rename', async () => {
    expect((await createGroup('   ', '/repo')).groups).toEqual([]);
    const { groups } = await createGroup('Perf pass', '/repo');
    const renamed = await renameGroup(groups[0].id, '  ');
    expect(renamed.groups[0].name).toBe('Perf pass');
    expect((await renameGroup(groups[0].id, ' Perf ')).groups[0].name).toBe('Perf');
  });

  it('moves a session between groups rather than adding it to both', async () => {
    const a = (await createGroup('A', '/repo')).groups[0];
    const b = (await createGroup('B', '/repo')).groups[0];
    await moveSessionToGroup('s1', a.id);
    const { groupOf } = await moveSessionToGroup('s1', b.id);
    expect(groupOf).toEqual({ s1: b.id });
  });

  it('takes a session out of every group with a null target, and ignores an unknown group', async () => {
    const a = (await createGroup('A', '/repo')).groups[0];
    await moveSessionToGroup('s1', a.id);
    expect((await moveSessionToGroup('s1', null)).groupOf).toEqual({});
    expect((await moveSessionToGroup('s1', 'no-such-group')).groupOf).toEqual({});
  });

  it('deletes a group, ungrouping its members and leaving other groups alone', async () => {
    const doomed = (await createGroup('Doomed', '/repo')).groups[0];
    const keeper = (await createGroup('Keeper', '/repo')).groups[0];
    await moveSessionToGroup('s1', doomed.id);
    await moveSessionToGroup('s2', keeper.id);
    const { groups, groupOf } = await deleteGroup(doomed.id);
    expect(groups.map((g) => g.name)).toEqual(['Keeper']);
    expect(groupOf).toEqual({ s2: keeper.id }); // s1 is ungrouped, not deleted
  });

  it('drops a deleted session\'s membership', async () => {
    const a = (await createGroup('A', '/repo')).groups[0];
    await moveSessionToGroup('s1', a.id);
    await purgeSession('s1');
    expect((await getGroupState()).groupOf).toEqual({});
  });

  it('defaults the fields for a meta.json written before groups existed', async () => {
    await writeMetaFile({ pinned: ['p1'], version: 3 });
    expect(await getGroupState()).toEqual({ groups: [], groupOf: {} });
    expect(await getPinned()).toEqual(['p1']);
  });

  it('drops malformed groups and memberships pointing at a group that is gone', async () => {
    await writeMetaFile({
      groups: [{ id: 'g1', name: 'Real', repoRoot: '/repo' }, { id: 'g2', name: 42 }],
      groupOf: { s1: 'g1', s2: 'g2', s3: 'vanished', s4: 7 },
      version: 3,
    });
    const { groups, groupOf } = await getGroupState();
    expect(groups.map((g) => g.id)).toEqual(['g1']);
    expect(groupOf).toEqual({ s1: 'g1' });
  });
});

describe('moveGroup', () => {
  // Three in /a with one of /b wedged between them, so a move that leaked outside its own project would be visible in the result rather than passing by luck.
  async function seed(): Promise<string[]> {
    await createGroup('a3', '/a');
    await createGroup('b1', '/b');
    await createGroup('a2', '/a');
    await createGroup('a1', '/a');
    const { groups } = await getGroupState();
    expect(groups.map((g) => g.name)).toEqual(['a1', 'a2', 'b1', 'a3']);
    return groups.filter((g) => g.repoRoot === '/a').map((g) => g.id);
  }

  it('moves within its own project and leaves other projects in place', async () => {
    const [, , a3] = await seed();
    const { groups } = await moveGroup(a3, 'top');
    // a3 leads /a's groups; b1 has not budged from the slot it held.
    expect(groups.filter((g) => g.repoRoot === '/a').map((g) => g.name)).toEqual(['a3', 'a1', 'a2']);
    expect(groups.map((g) => g.name)).toEqual(['a3', 'a1', 'b1', 'a2']);
  });

  it('steps one place at a time, skipping over another project\'s group', async () => {
    const [a1] = await seed();
    const down = await moveGroup(a1, 'down');
    expect(down.groups.filter((g) => g.repoRoot === '/a').map((g) => g.name)).toEqual(['a2', 'a1', 'a3']);
    const up = await moveGroup(a1, 'up');
    expect(up.groups.filter((g) => g.repoRoot === '/a').map((g) => g.name)).toEqual(['a1', 'a2', 'a3']);
  });

  it('sends a group to the end of its own project, not the end of the registry', async () => {
    const [a1] = await seed();
    const { groups } = await moveGroup(a1, 'bottom');
    expect(groups.filter((g) => g.repoRoot === '/a').map((g) => g.name)).toEqual(['a2', 'a3', 'a1']);
    expect(groups.map((g) => g.name)).toEqual(['a2', 'a3', 'b1', 'a1']);
  });

  it('ignores a move that would fall off either end, and an unknown id', async () => {
    const [a1, , a3] = await seed();
    expect((await moveGroup(a1, 'up')).groups.map((g) => g.name)).toEqual(['a1', 'a2', 'b1', 'a3']);
    expect((await moveGroup(a3, 'down')).groups.map((g) => g.name)).toEqual(['a1', 'a2', 'b1', 'a3']);
    expect((await moveGroup('nope', 'top')).groups.map((g) => g.name)).toEqual(['a1', 'a2', 'b1', 'a3']);
  });

  it('survives a reload, so the order is really persisted', async () => {
    const [, , a3] = await seed();
    await moveGroup(a3, 'top');
    expect((await getGroupState()).groups.map((g) => g.name)).toEqual(['a3', 'a1', 'b1', 'a2']);
  });
});

describe('projectOrder', () => {
  it('seeds from the order given, so the first run changes nothing on screen', async () => {
    expect(await getProjectOrder()).toEqual([]);
    expect(await seedProjectOrder(['/c', '/a', '/b'])).toEqual(['/c', '/a', '/b']);
    expect(await getProjectOrder()).toEqual(['/c', '/a', '/b']);
  });

  it('puts a project first seen later at the front, keeping the rest put', async () => {
    await seedProjectOrder(['/a', '/b']);
    expect(await seedProjectOrder(['/a', '/b', '/new'])).toEqual(['/new', '/a', '/b']);
  });

  it('keeps the slot of a project that is absent for a while', async () => {
    await seedProjectOrder(['/a', '/b', '/c']);
    // /b contributes no sessions this time (all archived, say) and must not lose its place.
    expect(await seedProjectOrder(['/a', '/c'])).toEqual(['/a', '/b', '/c']);
    expect(await seedProjectOrder(['/a', '/b', '/c'])).toEqual(['/a', '/b', '/c']);
  });

  it('moves a project to either end and one step at a time', async () => {
    await seedProjectOrder(['/a', '/b', '/c']);
    expect(await moveProject('/c', 'top')).toEqual(['/c', '/a', '/b']);
    expect(await moveProject('/c', 'down')).toEqual(['/a', '/c', '/b']);
    expect(await moveProject('/c', 'up')).toEqual(['/c', '/a', '/b']);
    expect(await moveProject('/c', 'bottom')).toEqual(['/a', '/b', '/c']);
  });

  it('ignores a move off either end and an unseen project', async () => {
    await seedProjectOrder(['/a', '/b']);
    expect(await moveProject('/a', 'up')).toEqual(['/a', '/b']);
    expect(await moveProject('/b', 'down')).toEqual(['/a', '/b']);
    expect(await moveProject('/nope', 'top')).toEqual(['/a', '/b']);
  });

  it('survives a reload', async () => {
    await seedProjectOrder(['/a', '/b']);
    await moveProject('/b', 'top');
    expect(await getProjectOrder()).toEqual(['/b', '/a']);
  });
});

describe('footerExpanded', () => {
  it('starts expanded, because the strip is meant to be read', async () => {
    expect((await getUiState()).footerExpanded).toBe(true);
  });

  it('remembers being closed, and being opened again', async () => {
    const ui = await getUiState();
    await setUiState({ ...ui, footerExpanded: false });
    expect((await getUiState()).footerExpanded).toBe(false);
    await setUiState({ ...ui, footerExpanded: true });
    expect((await getUiState()).footerExpanded).toBe(true);
  });

  it('takes the default when an older meta.json never mentioned it', async () => {
    await writeMetaFile({ pinned: ['s1'], version: 3 });
    expect((await getUiState()).footerExpanded).toBe(true);
  });

  // It used to be a key of its own, so an existing install's setting has to survive the move into `ui`.
  it('adopts the value from the key this used to live under', async () => {
    await writeMetaFile({ footerExpanded: false, version: 3 });
    expect((await getUiState()).footerExpanded).toBe(false);
  });

  it('prefers what `ui` says over the old key, once both exist', async () => {
    await writeMetaFile({ footerExpanded: false, ui: { footerExpanded: true }, version: 3 });
    expect((await getUiState()).footerExpanded).toBe(true);
  });

  // The old key is consumed rather than carried along, so it does not linger in the file for ever.
  it('stops writing the old key back out', async () => {
    await writeMetaFile({ footerExpanded: false, version: 3 });
    await setUiState({ ...(await getUiState()), footerExpanded: true });
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
    expect(raw.footerExpanded).toBeUndefined();
    expect(raw.ui.footerExpanded).toBe(true);
  });
});

describe('windowBounds', () => {
  it('has nothing stored until the window has been somewhere', async () => {
    expect(await getWindowBounds()).toBeNull();
  });

  it('stores and reads back a position', async () => {
    const bounds = { x: 40, y: 60, width: 1400, height: 900, maximized: false };
    await setWindowBounds(bounds);
    expect(await getWindowBounds()).toEqual(bounds);
  });

  it('remembers a maximized window and the size to un-maximize to', async () => {
    await setWindowBounds({ x: 0, y: 0, width: 1100, height: 760, maximized: true });
    expect(await getWindowBounds()).toMatchObject({ width: 1100, height: 760, maximized: true });
  });

  it('ignores a half-written rectangle rather than placing a window from it', async () => {
    await writeMetaFile({ windowBounds: { x: 40, y: 60, width: 1400 }, version: 3 });
    expect(await getWindowBounds()).toBeNull();
  });

  it('ignores a rectangle with no size', async () => {
    await writeMetaFile({ windowBounds: { x: 40, y: 60, width: 0, height: 900 }, version: 3 });
    expect(await getWindowBounds()).toBeNull();
  });

  it('ignores values that are not numbers at all', async () => {
    await writeMetaFile({ windowBounds: { x: null, y: '60', width: 1400, height: 900 }, version: 3 });
    expect(await getWindowBounds()).toBeNull();
  });
});

describe('ui state', () => {
  const view = {
    search: 'psalm',
    filters: { pinned: true, open: false, live: false, worktree: false, gone: false, siblings: false, noted: false, archived: false },
    datePreset: 'custom',
    dateFrom: 1_700_000_000_000,
    dateTo: 1_700_500_000_000,
    filterPanelOpen: true,
    footerExpanded: false,
    collapsedProjects: ['/home/me/work'],
    collapsedGroups: ['g1'],
    filterCollapsedProjects: ['/home/me/other'],
    filterCollapsedGroups: ['g2'],
    sidebarWidth: 380,
    scrollTop: 240,
    panelState: {
      sizes: { window: { sidebar: 300, main: 1100 }, work: { claude: 800, side: 300 } },
      collapsed: ['drawer'],
      active: { side: 'reviews' },
    },
  };

  it('starts unfiltered, unfolded and at the default width', async () => {
    expect(await getUiState()).toEqual({
      search: '',
      filters: { pinned: false, open: false, live: false, worktree: false, gone: false, siblings: false, noted: false, archived: false },
      datePreset: 'any',
      dateFrom: null,
      dateTo: null,
      filterPanelOpen: false,
      footerExpanded: true,
      collapsedProjects: [],
      collapsedGroups: [],
      filterCollapsedProjects: [],
      filterCollapsedGroups: [],
      sidebarWidth: null,
      scrollTop: 0,
      panelState: { sizes: {}, collapsed: [], active: {} },
    });
  });

  it('stores and reads back a whole view', async () => {
    await setUiState(view);
    expect(await getUiState()).toEqual(view);
  });

  it('fills in what an older meta.json never stored', async () => {
    await writeMetaFile({ ui: { search: 'psalm' }, version: 3 });
    const ui = await getUiState();
    expect(ui.search).toBe('psalm');
    expect(ui.filters.pinned).toBe(false);
    expect(ui.datePreset).toBe('any');
    expect(ui.collapsedProjects).toEqual([]);
    expect(ui.filterCollapsedProjects).toEqual([]);
    expect(ui.panelState).toEqual({ sizes: {}, collapsed: [], active: {} });
  });

  it('drops the first slice’s side width rather than carrying it into the tree', async () => {
    await writeMetaFile({ ui: { panelState: { width: 420 } }, version: 3 });
    expect((await getUiState()).panelState).toEqual({ sizes: {}, collapsed: [], active: {} });
  });

  it('keeps the tree state’s well-formed entries and drops the rest, one by one', async () => {
    await writeMetaFile({
      ui: {
        panelState: {
          sizes: { window: { sidebar: 300, main: 0, side: -4, drawer: '200' }, work: 'wide', gone: { a: null }, list: [1, 2] },
          collapsed: ['drawer', 3, null, 'side'],
          active: { side: 'reviews', work: 7, drawer: null },
        },
      },
      version: 3,
    });
    expect((await getUiState()).panelState).toEqual({
      sizes: { window: { sidebar: 300 } },
      collapsed: ['drawer', 'side'],
      active: { side: 'reviews' },
    });
  });

  it('starts the tree state empty when it is not an object at all', async () => {
    for (const panelState of ['x', 3, null, [1]]) {
      await writeMetaFile({ ui: { panelState }, version: 3 });
      expect((await getUiState()).panelState).toEqual({ sizes: {}, collapsed: [], active: {} });
    }
  });

  it('drops values of the wrong type rather than restoring a broken sidebar', async () => {
    await writeMetaFile({
      ui: { search: 42, filters: 'all', collapsedProjects: ['/a', 7, null], scrollTop: 'top' },
      version: 3,
    });
    const ui = await getUiState();
    expect(ui.search).toBe('');
    expect(ui.filters.pinned).toBe(false);
    expect(ui.collapsedProjects).toEqual(['/a']);
    expect(ui.scrollTop).toBe(0);
  });

  it('keeps the folds made while filtering apart from the folds made without one', async () => {
    await setUiState(view);
    const ui = await getUiState();
    expect(ui.collapsedProjects).toEqual(['/home/me/work']);
    expect(ui.filterCollapsedProjects).toEqual(['/home/me/other']);
    expect(ui.collapsedGroups).toEqual(['g1']);
    expect(ui.filterCollapsedGroups).toEqual(['g2']);
  });

  it('treats a zero width as never set, since it could not be dragged back', async () => {
    await setUiState({ ...view, sidebarWidth: 0, panelState: { sizes: { window: { sidebar: 0, main: 900 } }, collapsed: [], active: {} } });
    expect((await getUiState()).sidebarWidth).toBeNull();
    expect((await getUiState()).panelState.sizes).toEqual({ window: { main: 900 } });
  });

  it('normalizes on the way in too, so the renderer cannot store a shape the next launch chokes on', async () => {
    await setUiState({ ...view, scrollTop: -50 });
    expect((await getUiState()).scrollTop).toBe(0);
  });
});

describe('settings', () => {
  it('starts empty, and stores what it is given', async () => {
    expect(await getSettings()).toEqual({ launchFlags: '' });
    expect(await setSettings({ launchFlags: '--allowedTools Grep,Glob' })).toEqual({
      launchFlags: '--allowedTools Grep,Glob',
    });
    expect(await getSettings()).toEqual({ launchFlags: '--allowedTools Grep,Glob' });
  });

  it('refuses unusable flags and keeps the last good ones, rather than storing something a launch would choke on', async () => {
    await setSettings({ launchFlags: '--allowedTools Grep' });
    // A flag we set ourselves, and an unclosed quote: both are refused by the parser.
    expect(await setSettings({ launchFlags: '--resume other' })).toEqual({ launchFlags: '--allowedTools Grep' });
    expect(await setSettings({ launchFlags: '--x "oops' })).toEqual({ launchFlags: '--allowedTools Grep' });
    expect(await getSettings()).toEqual({ launchFlags: '--allowedTools Grep' });
  });

  it('defaults a stored value of the wrong type instead of handing it on', async () => {
    await writeMetaFile({ version: 3, settings: { launchFlags: 42 } });
    expect(await getSettings()).toEqual({ launchFlags: '' });
  });

  it('is untouched by a ui-state write, since the two are stored apart', async () => {
    await setSettings({ launchFlags: '--allowedTools Grep' });
    await setUiState({ ...(await getUiState()), search: 'anything' });
    expect(await getSettings()).toEqual({ launchFlags: '--allowedTools Grep' });
  });
});

describe('notes', () => {
  it('stores a note per session and trims it', async () => {
    expect(await getNotes()).toEqual({});
    expect(await setNote('s1', '  waiting on review  ')).toEqual({ s1: 'waiting on review' });
    expect(await getNotes()).toEqual({ s1: 'waiting on review' });
  });

  it('clears the entry on a blank note rather than storing an empty string', async () => {
    await setNote('s1', 'something');
    expect(await setNote('s1', '   ')).toEqual({});
    // Presence is the "has a note" check, so an empty string left behind would show a mark over nothing.
    expect('s1' in (await getNotes())).toBe(false);
  });

  it('keeps other sessions\' notes when one is cleared', async () => {
    await setNote('s1', 'one');
    await setNote('s2', 'two');
    expect(await setNote('s1', '')).toEqual({ s2: 'two' });
  });

  it('drops a note when its session is deleted, like its pin and group', async () => {
    await setNote('s1', 'gone soon');
    await togglePin('s1');
    await purgeSession('s1');
    expect(await getNotes()).toEqual({});
    expect(await getPinned()).toEqual([]);
  });

  it('ignores non-string notes in a hand-edited file', async () => {
    await writeMetaFile({ notes: { s1: 'fine', s2: { nope: true }, s3: 42 }, version: 3 });
    expect(await getNotes()).toEqual({ s1: 'fine' });
  });
});

// A meta file can be read by a build that is not the one that wrote it: versions get skipped, and an older build can be installed over a newer one.
describe('across app versions', () => {
  const readMetaFile = async (): Promise<Record<string, unknown>> =>
    JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));

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
    const snapshot = JSON.parse(await fs.readFile(path.join(dir, 'meta.json.0.1.0.bak'), 'utf8'));
    expect(snapshot.pinned).toEqual(['kept-by-0.1.0']);
    expect(snapshot.appVersion).toBe('0.1.0');
    expect((await readMetaFile()).appVersion).toBe('0.2.0');
  });

  it('takes only one snapshot per version, not one per write', async () => {
    process.env.TEST_APPVERSION = '0.1.0';
    await togglePin('a');
    process.env.TEST_APPVERSION = '0.2.0';
    await togglePin('b');
    const first = await fs.readFile(path.join(dir, 'meta.json.0.1.0.bak'), 'utf8');
    await togglePin('c');
    // A second snapshot would capture 0.2.0's own writes and destroy the pre-upgrade state.
    expect(await fs.readFile(path.join(dir, 'meta.json.0.1.0.bak'), 'utf8')).toBe(first);
  });

  it('records a downgrade in the audit log, so a rollback is visible', async () => {
    process.env.TEST_APPVERSION = '0.3.0';
    await togglePin('a');
    process.env.TEST_APPVERSION = '0.2.0'; // someone was handed an older build
    await togglePin('b');
    const log = await fs.readFile(path.join(dir, 'meta-audit.log'), 'utf8');
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
  const auditFile = (): string => path.join(dir, 'meta-audit.log');

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

describe('the live filter, renamed from running', () => {
  it('adopts the value stored under the old key', async () => {
    await writeMetaFile({ ui: { filters: { running: true } }, version: 3 });
    expect((await getUiState()).filters.live).toBe(true);
  });

  it('prefers the new key once both are there', async () => {
    await writeMetaFile({ ui: { filters: { running: true, live: false } }, version: 3 });
    expect((await getUiState()).filters.live).toBe(false);
  });

  it('stops writing the old key back out', async () => {
    await writeMetaFile({ ui: { filters: { running: true } }, version: 3 });
    await setUiState(await getUiState());
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
    expect(raw.ui.filters.running).toBeUndefined();
    expect(raw.ui.filters.live).toBe(true);
  });
});
