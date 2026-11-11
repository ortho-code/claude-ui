import { describe, it, expect, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { auditLines, metaDir, useMetaDir, writeMetaFile } from './meta-fixture';

vi.mock('electron', async () => (await import('./meta-fixture')).electronStub);

import {
  getPinned,
  togglePin,
  getActiveSession,
  getActiveSessionByProject,
  setActiveSession,
  getHistoryPins,
  toggleHistoryPin,
  getFinished,
  finish,
  unfinish,
  purgeSession,
  getOpenSessions,
  getRunningSessions,
  getPrLinks,
  addPrLink,
  getPrSeen,
  setPrSeen,
  getScheduledWhenStopped,
  setOpenSessions,
  setScheduledWhenStopped,
  getActiveProject,
  setActiveProject,
  getNotes,
  setNote,
  getWindowBounds,
  setWindowBounds,
  getUiState,
  setUiState,
  getSettings,
  getMoved,
  markMoved,
} from '../../../../src/main/sessions/meta';
import { getNeedsYou, getSetAside, markNeedsYou, markSetAside } from '../../../../src/main/status/marks';

useMetaDir();

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

describe('finish', () => {
  it('finishes with a timestamp, keeps it on a second finish, and makes it unfinished', async () => {
    const finished = await finish(['conv1']);
    expect(Object.keys(finished)).toEqual(['conv1']);
    expect(finished.conv1).toBeGreaterThan(0);
    expect(await finish(['conv1'])).toEqual(finished);
    expect(await unfinish(['conv1'])).toEqual({});
  });

  it('finishes and unfinishes several sessions in one write each, settling every one of their marks', async () => {
    await markNeedsYou(['a', 'b'], [{ type: 'app.was-running', at: 1, how: 'quit' }]);
    await markSetAside(['a', 'b'], null, 1);
    const before = await auditLines();
    const finished = await finish(['a', 'b']);
    expect(Object.keys(finished).sort()).toEqual(['a', 'b']);
    expect(await getNeedsYou()).toEqual({});
    expect(await getSetAside()).toEqual({});
    expect(await unfinish(['a', 'b'])).toEqual({});
    expect((await auditLines()).slice(before.length).map((line) => / (\w+) open=/.exec(line)?.[1])).toEqual(['finish', 'unfinish']);
  });

  it('reads a legacy archived id-array as a map with unknown (0) timestamps', async () => {
    await writeMetaFile({ pinned: [], openSessions: [], archived: ['a', 'b'], version: 2 });
    expect(await getFinished()).toEqual({ a: 0, b: 0 });
  });

  // They were stored as `archived` before the act was called Finished, and are migrated once.
  it('reads the key they were stored under before, and the next write keeps them under the new one only', async () => {
    await writeMetaFile({ version: 3, archived: { a: 5 } });
    expect(await getFinished()).toEqual({ a: 5 });
    await finish(['b']);
    const raw = JSON.parse(await fs.readFile(path.join(metaDir(), 'meta.json'), 'utf8'));
    expect(raw.archived).toBeUndefined();
    expect(raw.finished).toEqual({ a: 5, b: expect.any(Number) });
  });

  it('prefers the new key once both are there', async () => {
    await writeMetaFile({ version: 3, archived: { a: 5 }, finished: { b: 6 } });
    expect(await getFinished()).toEqual({ b: 6 });
  });
});

describe('purgeSession', () => {
  it('drops the session from pins, open tabs, running tabs and finished', async () => {
    await togglePin('conv1');
    await finish(['conv1']);
    await setOpenSessions(['conv1', 'conv2'], ['conv1']);
    await purgeSession('conv1');
    expect(await getPinned()).toEqual([]);
    expect(await getFinished()).toEqual({});
    expect(await getOpenSessions()).toEqual(['conv2']);
    expect(await getRunningSessions()).toEqual([]);
  });

});

describe('running sessions', () => {
  it('are written with the open tabs, and only an open one is kept', async () => {
    await setOpenSessions(['a', 'b'], ['b', 'gone']);
    expect(await getOpenSessions()).toEqual(['a', 'b']);
    expect(await getRunningSessions()).toEqual(['b']);
    expect(await fs.readFile(path.join(metaDir(), 'meta-audit.log'), 'utf8')).toContain('setOpenSessions open=["a","b"] running=["b"]');
  });

  it('are none in a file written before they were kept, and a value that is no id is dropped', async () => {
    await writeMetaFile({ version: 3, openSessions: ['a'] });
    expect(await getRunningSessions()).toEqual([]);
    await writeMetaFile({ version: 3, openSessions: ['a'], runningSessions: ['a', 7] });
    expect(await getRunningSessions()).toEqual(['a']);
  });
});

describe('what was last seen of the PRs', () => {
  it('is null in a file written before it was kept, which is the first run', async () => {
    await writeMetaFile({ version: 3 });
    expect(await getPrSeen()).toBeNull();
  });

  it('reads each PR under its key, `prKey`, one PR kept under two spellings once', async () => {
    await writeMetaFile({ version: 3, prSeen: { 'Acme/App#7': { state: 'merged', role: 'own' }, 'acme/app#7': { state: 'closed', role: 'own' }, 'acme/app#8': { state: 'merged', role: 'own' } } });
    expect(await getPrSeen()).toEqual({ 'acme/app#7': { state: 'merged', role: 'own' }, 'acme/app#8': { state: 'merged', role: 'own' } });
  });

  it('is kept in place of what was before, and stays empty once emptied', async () => {
    const approved = { state: 'open' as const, role: 'reviewing' as const, draft: false, review: 'approved' as const, checks: 'running' as const, conflict: null, approvals: 2, newCommits: true, reviewAsked: false, changesRequested: ['PRR_b'] };
    await setPrSeen({ 'acme/app#7': { state: 'merged', role: 'own' } });
    await setPrSeen({ 'acme/app#8': approved });
    expect(await getPrSeen()).toEqual({ 'acme/app#8': approved });
    await setPrSeen({});
    expect(await getPrSeen()).toEqual({});
  });

  it('drops an entry this build cannot read as a status', async () => {
    await writeMetaFile({
      version: 3,
      prSeen: {
        'acme/app#7': { state: 'closed' },
        'acme/app#8': { state: 'nonsense' },
        'acme/app#9': { state: 'open', draft: false, review: 'nonsense', checks: null, conflict: null },
        'acme/app#10': { state: 'open', review: null, checks: null, conflict: null },
        'acme/app#11': { state: 'merged', role: 'nonsense' },
        'acme/app#12': { state: 'open', role: 'own', draft: false, review: null, checks: null, conflict: null, approvals: -1 },
        'acme/app#13': { state: 'open', role: 'own', draft: false, review: null, checks: null, conflict: null, changesRequested: [7] },
      },
    });
    expect(await getPrSeen()).toEqual({ 'acme/app#7': { state: 'closed', role: null } });
  });

  // As a build before roles kept them.
  it('reads a status kept without the role and review fields as not knowing them', async () => {
    await writeMetaFile({ version: 3, prSeen: { 'acme/app#7': { state: 'open', draft: false, review: 'approved', checks: null, conflict: false } } });
    expect(await getPrSeen()).toEqual({ 'acme/app#7': { state: 'open', role: null, draft: false, review: 'approved', checks: null, conflict: false, approvals: null, newCommits: null, reviewAsked: null, changesRequested: null } });
  });
});

describe('the PRs the app linked sessions to', () => {
  const pr = (repository: string, number: number) => ({ repository, number, url: `https://github.com/${repository}/pull/${number}` });

  it('keep each session\'s in the order linked, each once, through a finish, and go with a delete', async () => {
    await addPrLink('a', pr('acme/app', 1).url);
    await addPrLink('a', pr('acme/app', 2).url);
    await addPrLink('a', pr('Acme/App', 1).url);
    await addPrLink('b', pr('acme/app', 3).url);
    expect(await getPrLinks()).toEqual({ a: [pr('acme/app', 1), pr('acme/app', 2)], b: [pr('acme/app', 3)] });
    await finish(['a']);
    expect((await getPrLinks()).a).toEqual([pr('acme/app', 1), pr('acme/app', 2)]);
    await purgeSession('a');
    expect(await getPrLinks()).toEqual({ b: [pr('acme/app', 3)] });
  });

  it('are none in a file written before they were kept, and a link that is no GitHub pull request page is dropped', async () => {
    await writeMetaFile({ version: 3 });
    expect(await getPrLinks()).toEqual({});
    await writeMetaFile({ version: 3, prLinks: { a: [pr('acme/app', 1), { url: 'https://example.com/x' }, null], b: [{ url: 'https://github.com/acme/app/issues/4' }], c: 'x' } });
    expect(await getPrLinks()).toEqual({ a: [pr('acme/app', 1)] });
  });
});

describe('what was scheduled when a tab stopped', () => {
  const tock = { prompt: 'say the word tock', recurring: true, cron: 'Every 10 minutes' };

  it('is kept for an open session only, read as claude lists it, and goes with its tab', async () => {
    await setOpenSessions(['a', 'b'], []);
    await setScheduledWhenStopped({ a: [tock, { id: 'x' }, { prompt: 'say tock once' }], b: [], gone: [tock] });
    expect(await getScheduledWhenStopped()).toEqual({ a: [tock, { prompt: 'say tock once', recurring: false, cron: null }] });
    await setOpenSessions(['b'], []);
    expect(await getScheduledWhenStopped()).toEqual({});
  });

  it('is nothing in a file written before it was kept, or one that holds something else', async () => {
    await writeMetaFile({ version: 3, openSessions: ['a'] });
    expect(await getScheduledWhenStopped()).toEqual({});
    await writeMetaFile({ version: 3, openSessions: ['a'], scheduledWhenStopped: ['a'] });
    expect(await getScheduledWhenStopped()).toEqual({});
    await writeMetaFile({ version: 3, openSessions: ['a'], scheduledWhenStopped: { a: [tock] } });
    expect(await getScheduledWhenStopped()).toEqual({ a: [tock] });
  });

  it('goes when its session is deleted', async () => {
    await setOpenSessions(['a', 'b'], []);
    await setScheduledWhenStopped({ a: [tock], b: [tock] });
    await purgeSession('a');
    expect(await getScheduledWhenStopped()).toEqual({ b: [tock] });
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

describe('active session', () => {
  it('is none at first, and remembers the session to return to, overall and in its own project', async () => {
    expect(await getActiveSession()).toBeNull();
    expect(await getActiveSessionByProject()).toEqual({});
    await setOpenSessions(['a', 'b'], []);
    await setActiveSession('a', '/p');
    await setActiveSession('b', '/q');
    expect(await getActiveSession()).toBe('b');
    expect(await getActiveSessionByProject()).toEqual({ '/p': 'a', '/q': 'b' });
  });

  it('forgets a session whose tab is no longer open, overall and in its project', async () => {
    await setOpenSessions(['a', 'b'], []);
    await setActiveSession('a', '/p');
    await setActiveSession('b', '/q');
    await setOpenSessions(['a'], []);
    expect(await getActiveSession()).toBeNull();
    expect(await getActiveSessionByProject()).toEqual({ '/p': 'a' });
  });

  it('keeps a project\'s session when cleared overall, and drops a stored entry that is no id', async () => {
    await setActiveSession('a', '/p');
    await setActiveSession(null);
    expect(await getActiveSession()).toBeNull();
    expect(await getActiveSessionByProject()).toEqual({ '/p': 'a' });
    await writeMetaFile({ version: 3, activeSessionByProject: { '/p': 'a', '/q': 7 } });
    expect(await getActiveSessionByProject()).toEqual({ '/p': 'a' });
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

describe('settings, as kept here before the config folder', () => {
  it('reads what an older build stored, and the default without', async () => {
    expect(await getSettings()).toEqual({ launchFlags: '' });
    await writeMetaFile({ version: 3, settings: { launchFlags: '--allowedTools Grep,Glob' } });
    expect(await getSettings()).toEqual({ launchFlags: '--allowedTools Grep,Glob' });
  });

  it('defaults a stored value of the wrong type instead of handing it on', async () => {
    await writeMetaFile({ version: 3, settings: { launchFlags: 42 } });
    expect(await getSettings()).toEqual({ launchFlags: '' });
  });

  it('keeps them through every other write, so an older build still finds them', async () => {
    await writeMetaFile({ version: 3, settings: { launchFlags: '--allowedTools Grep' } });
    await setUiState({ ...(await getUiState()), search: 'anything' });
    await markMoved('launchFlags');
    expect(await getSettings()).toEqual({ launchFlags: '--allowedTools Grep' });
  });
});

describe('what has moved into the config folder', () => {
  it('starts with nothing, and records a move once however often it is made', async () => {
    expect(await getMoved()).toEqual([]);
    await markMoved('launchFlags');
    await markMoved('launchFlags');
    expect(await getMoved()).toEqual(['launchFlags']);
  });

  it('drops what is not a name, from a hand-edited file', async () => {
    await writeMetaFile({ version: 3, moved: ['launchFlags', 42, null] });
    expect(await getMoved()).toEqual(['launchFlags']);
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
