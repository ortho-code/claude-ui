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

// A filter that defaults to on, for the one check that needs one: none does yet, and the rule for a key a file does not have is only seen with one.
const { defaultsWith } = vi.hoisted(() => ({ defaultsWith: { pinnedOn: false } }));
vi.mock('../../../src/shared/defaults', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/shared/defaults')>();
  return {
    ...actual,
    defaultUi: () => {
      const ui = actual.defaultUi();
      return defaultsWith.pinnedOn ? { ...ui, filters: { ...ui.filters, pinned: true } } : ui;
    },
  };
});

import {
  getPinned,
  togglePin,
  getHistoryPins,
  toggleHistoryPin,
  getFinished,
  finish,
  unfinish,
  purgeSession,
  getOpenSessions,
  getRunningSessions,
  getNeedsYou,
  getNeedsYouHistory,
  restoreNeedsYou,
  markNeedsYou,
  getSetAside,
  markSetAside,
  clearSetAside,
  setAsideCameDue,
  getKept,
  keep,
  unkeep,
  getPrLinks,
  addPrLink,
  clearNeedsYou,
  getPrSeen,
  setPrSeen,
  getScheduledWhenStopped,
  setOpenSessions,
  setScheduledWhenStopped,
  getActiveProject,
  setActiveProject,
  migrateToSessionKeys,
  getGroupState,
  createGroup,
  renameGroup,
  deleteGroup,
  moveSessionsToGroup,
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
  getMoved,
  markMoved,
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

/** The audit log's lines so far, one per write of meta.json: how a check counts the writes a call made. */
async function auditLines(): Promise<string[]> {
  const text = await fs.readFile(path.join(dir, 'meta-audit.log'), 'utf8').catch(() => '');
  return text.split('\n').filter(Boolean);
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
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
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
    expect(await fs.readFile(path.join(dir, 'meta-audit.log'), 'utf8')).toContain('setOpenSessions open=["a","b"] running=["b"]');
  });

  it('are none in a file written before they were kept, and a value that is no id is dropped', async () => {
    await writeMetaFile({ version: 3, openSessions: ['a'] });
    expect(await getRunningSessions()).toEqual([]);
    await writeMetaFile({ version: 3, openSessions: ['a'], runningSessions: ['a', 7] });
    expect(await getRunningSessions()).toEqual(['a']);
  });
});

describe('sessions that need you', () => {
  it('are marked with every reason and since when, one of a kind replacing the last, and taken off one session at a time', async () => {
    expect(await getNeedsYou()).toEqual({});
    await markNeedsYou(['a', 'b'], [{ type: 'app.was-running', at: 1, how: 'ended' }]);
    await markNeedsYou(['a'], [{ type: 'app.reminder', at: 2 }]);
    await markNeedsYou(['a'], [{ type: 'app.was-running', at: 3, how: 'quit' }]);
    expect(await getNeedsYou()).toEqual({
      a: [
        { type: 'app.reminder', at: 2 },
        { type: 'app.was-running', at: 3, how: 'quit' },
      ],
      b: [{ type: 'app.was-running', at: 1, how: 'ended' }],
    });
    await clearNeedsYou('a', 'cleared');
    expect(Object.keys(await getNeedsYou())).toEqual(['b']);
  });

  // Kept per session, not per tab: a mark outlives the tabs being written again, as every launch writes them.
  it('stay through the open tabs being written', async () => {
    await markNeedsYou(['a'], [{ type: 'app.was-running', at: 1, how: 'quit' }]);
    await setOpenSessions(['b'], []);
    expect(Object.keys(await getNeedsYou())).toEqual(['a']);
  });

  it('are taken off by a finish, and forgotten by a delete', async () => {
    await markNeedsYou(['a', 'b'], [{ type: 'app.was-running', at: 1, how: 'quit' }]);
    await finish(['a']);
    await purgeSession('b');
    expect(await getNeedsYou()).toEqual({});
  });

  it('are none in a file written before they were kept, and a reason this build does not fire or without what it needs is dropped', async () => {
    await writeMetaFile({ version: 3 });
    expect(await getNeedsYou()).toEqual({});
    await writeMetaFile({
      version: 3,
      needsYou: {
        a: [{ type: 'app.was-running', at: 5, how: 'quit' }],
        b: [{ type: 'claude.asks', at: 5 }],
        c: [{ type: 'app.reminder' }],
        d: 'yes',
        e: [
          { type: 'app.reminder', at: 7 },
          { type: 'nonsense', at: 8 },
          { type: 'app.was-running', at: 8, how: 'sometime' },
          { type: 'pr.merged', at: 8 },
        ],
        f: [{ type: 'pr.checks-failed', at: 9, pr: 'acme/app#7' }],
      },
    });
    expect(await getNeedsYou()).toEqual({ a: [{ type: 'app.was-running', at: 5, how: 'quit' }], e: [{ type: 'app.reminder', at: 7 }], f: [{ type: 'pr.checks-failed', at: 9, pr: 'acme/app#7' }] });
  });

  // Before reasons had types (decided 2026-11-06): how the app closed was the reason itself, and a PR's changes one reason holding them all.
  it('read the form from before reasons had types, a PR reason as a reason per change, and drop one this build cannot read', async () => {
    await writeMetaFile({
      version: 3,
      needsYou: {
        a: [{ reason: 'ended', at: 1 }, { reason: 'reminder', at: 2 }, { reason: 'pr', at: 5, pr: 'acme/app#7', changes: ['checks failed', 'approved'] }],
        b: [{ reason: 'pr', at: 5, changes: ['merged'] }],
        c: [{ reason: 'pr', at: 5, pr: 'acme/app#7', changes: ['merged', 'nonsense'] }],
        d: [{ reason: 'pr', at: 5, pr: 'acme/app#7', changes: [] }],
        e: [{ reason: 'nonsense', at: 5 }, { reason: 'ended' }],
      },
    });
    expect(await getNeedsYou()).toEqual({
      a: [
        { type: 'app.was-running', at: 1, how: 'ended' },
        { type: 'app.reminder', at: 2 },
        { type: 'pr.checks-failed', at: 5, pr: 'acme/app#7' },
        { type: 'pr.approved', at: 5, pr: 'acme/app#7' },
      ],
    });
  });

  // A file from before a session kept every reason holds one reason per session.
  it('read a single reason, as an older file holds it, as a list of one', async () => {
    await writeMetaFile({ version: 3, needsYou: { a: { reason: 'quit', at: 5 }, b: { reason: 'nonsense', at: 5 } } });
    expect(await getNeedsYou()).toEqual({ a: [{ type: 'app.was-running', at: 5, how: 'quit' }] });
  });

  it('keep what settled each reason, by what and when, in the same write that takes it off, and put back by Undo leave none', async () => {
    const quit = { type: 'app.was-running' as const, at: 1, how: 'quit' as const };
    await markNeedsYou(['a', 'b'], [quit]);
    await markNeedsYou(['a'], [{ type: 'app.was-running', at: 2, how: 'ended' }]);
    await clearNeedsYou('a', 'prompt');
    await finish(['b']);
    const history = await getNeedsYouHistory();
    expect(history).toEqual({
      a: [
        { type: 'app.was-running', at: 2, how: 'ended', settled: expect.any(Number), by: 'prompt' },
        { ...quit, settled: expect.any(Number), by: 'replaced' },
      ],
      b: [{ ...quit, settled: expect.any(Number), by: 'finished' }],
    });
    await restoreNeedsYou('b', [quit]);
    expect(await getNeedsYou()).toEqual({ b: [quit] });
    expect(Object.keys(await getNeedsYouHistory())).toEqual(['a']);
    await purgeSession('a');
    expect(await getNeedsYouHistory()).toEqual({});
  });

  it('read a history entry only with a reason, the moment it was settled and what settled it, and keep the newest twenty', async () => {
    const entry = (at: number, more: object = {}) => ({ type: 'app.reminder', at, settled: at, by: 'cleared', ...more });
    await writeMetaFile({
      version: 3,
      needsYouHistory: { a: [entry(1), entry(2, { by: 'nonsense' }), entry(3, { settled: 'then' }), entry(4, { type: 'nonsense' })], b: 'yes', c: Array.from({ length: 25 }, (_, i) => entry(i)) },
    });
    const history = await getNeedsYouHistory();
    expect(history.a).toEqual([{ type: 'app.reminder', at: 1, settled: 1, by: 'cleared' }]);
    expect(Object.keys(history).sort()).toEqual(['a', 'c']);
    expect(history.c).toHaveLength(20);
  });

  // A key a build does not know goes through `extra` untouched, which is how a build from before the history keeps it, so going back a build and forward again loses none of it.
  it('stay in the file through a write, and so does a key the build does not know', async () => {
    const raw = { version: 3, needsYouHistory: { a: [{ type: 'app.reminder', at: 1, settled: 2, by: 'cleared' }] }, someLaterKey: { x: 1 } };
    await writeMetaFile(raw);
    await togglePin('z');
    const written = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
    expect(written.needsYouHistory).toEqual(raw.needsYouHistory);
    expect(written.someLaterKey).toEqual({ x: 1 });
  });

  // The reader of the build before reasons had types, as it was: what a build gone back to reads of what this one wrote.
  const olderReader = (raw: Record<string, unknown[]>): Record<string, unknown[]> =>
    Object.fromEntries(
      Object.entries(raw).flatMap(([id, entry]) => {
        const reasons = entry.flatMap((item) => {
          const { reason, at, pr, changes } = item as Record<string, unknown>;
          if (!['quit', 'ended', 'unknown', 'reminder', 'pr'].includes(reason as string) || typeof at !== 'number') return [];
          if (reason !== 'pr') return [{ reason, at }];
          const known = Array.isArray(changes) && changes.length > 0 && changes.every((change) => ['checks failed', 'merge conflict', 'changes requested', 'merged', 'closed', 'approved', 'reopened'].includes(change as string));
          return typeof pr === 'string' && known ? [{ reason, at, pr, changes }] : [];
        });
        return reasons.length > 0 ? [[id, reasons]] : [];
      }),
    );

  it('are written so that a build from before reasons had types reads every one, and what it writes back reads as the same reasons', async () => {
    const reasons = [
      { type: 'app.was-running' as const, at: 1, how: 'unknown' as const },
      { type: 'app.reminder' as const, at: 2 },
      { type: 'pr.checks-failed' as const, at: 3, pr: 'acme/app#7' },
      { type: 'pr.approved' as const, at: 3, pr: 'acme/app#7' },
      { type: 'pr.reopened' as const, at: 4, pr: 'acme/app#8' },
    ];
    await markNeedsYou(['a'], reasons);
    const older = olderReader(JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8')).needsYou);
    expect(older).toEqual({
      a: [
        { reason: 'unknown', at: 1 },
        { reason: 'reminder', at: 2 },
        { reason: 'pr', at: 3, pr: 'acme/app#7', changes: ['checks failed'] },
        { reason: 'pr', at: 3, pr: 'acme/app#7', changes: ['approved'] },
        { reason: 'pr', at: 4, pr: 'acme/app#8', changes: ['reopened'] },
      ],
    });
    await writeMetaFile({ version: 3, needsYou: older });
    expect(await getNeedsYou()).toEqual({ a: reasons });
  });
});

describe('what was last seen of the PRs', () => {
  it('is null in a file written before it was kept, which is the first run', async () => {
    await writeMetaFile({ version: 3 });
    expect(await getPrSeen()).toBeNull();
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

describe('the keep stamps', () => {
  it('stamp several sessions in one write, are taken off, stay through a finish and go with a delete', async () => {
    const before = await auditLines();
    await keep(['a', 'b'], 5);
    expect(await getKept()).toEqual({ a: 5, b: 5 });
    await unkeep(['b']);
    expect(await getKept()).toEqual({ a: 5 });
    expect((await auditLines()).slice(before.length).map((line) => / (\w+) open=/.exec(line)?.[1])).toEqual(['keep', 'unkeep']);
    await finish(['a']);
    expect(await getKept()).toEqual({ a: 5 });
    await purgeSession('a');
    expect(await getKept()).toEqual({});
  });

  it('are none in a file written before they were kept, and a stamp that is no moment is dropped', async () => {
    await writeMetaFile({ version: 3 });
    expect(await getKept()).toEqual({});
    await writeMetaFile({ version: 3, kept: { a: 5, b: 'monday', c: null } });
    expect(await getKept()).toEqual({ a: 5 });
  });
});

describe('the later marks', () => {
  it('are kept per session from the time given, replaced by a new one, and taken off', async () => {
    await markSetAside(['a'], null, 5);
    await markSetAside(['b'], 100, 5);
    await markSetAside(['b'], 200, 6);
    expect(await getSetAside()).toEqual({ a: { due: null, at: 5 }, b: { due: 200, at: 6 } });
    await clearSetAside(['a']);
    expect(await getSetAside()).toEqual({ b: { due: 200, at: 6 } });
  });

  it('are marked and taken off for several sessions in one write each', async () => {
    const before = await auditLines();
    await markSetAside(['a', 'b', 'c'], 100, 5);
    expect(await getSetAside()).toEqual({ a: { due: 100, at: 5 }, b: { due: 100, at: 5 }, c: { due: 100, at: 5 } });
    await clearSetAside(['a', 'c']);
    expect(await getSetAside()).toEqual({ b: { due: 100, at: 5 } });
    expect((await auditLines()).slice(before.length).map((line) => / (\w+) open=/.exec(line)?.[1])).toEqual(['markSetAside', 'clearSetAside']);
  });

  it('stay through the open tabs being written, are taken off by a finish, and forgotten by a delete', async () => {
    await markSetAside(['a'], null);
    await markSetAside(['b'], null);
    await setOpenSessions([], []);
    expect(Object.keys(await getSetAside())).toEqual(['a', 'b']);
    await finish(['a']);
    await purgeSession('b');
    expect(await getSetAside()).toEqual({});
  });

  it('come due as needing you, keeping a reason the session already had', async () => {
    await markNeedsYou(['a'], [{ type: 'app.was-running', at: 5, how: 'quit' }]);
    await markSetAside(['a', 'b'], 100, 10);
    await markSetAside(['c'], 300, 10);
    await setAsideCameDue(150);
    expect(await getSetAside()).toEqual({ c: { due: 300, at: 10 } });
    expect(await getNeedsYou()).toEqual({ a: [{ type: 'app.was-running', at: 5, how: 'quit' }], b: [{ type: 'app.reminder', at: 100 }] });
  });

  it('are none in a file written before they were kept, and an entry without a time or with a day that is not one is dropped', async () => {
    await writeMetaFile({ version: 3 });
    expect(await getSetAside()).toEqual({});
    await writeMetaFile({ version: 3, setAside: { a: { due: null, at: 5 }, b: { due: 9, at: 5 }, c: { due: 'monday', at: 5 }, d: { due: null }, e: 'yes' } });
    expect(await getSetAside()).toEqual({ a: { due: null, at: 5 }, b: { due: 9, at: 5 } });
  });

  // Pause gave way to the set-aside mark, so nothing a file from before set aside is lost.
  it('take in the tabs a file from before paused, whenever, keeping a mark one already has, and the next write drops the paused list', async () => {
    await writeMetaFile({ version: 3, openSessions: ['a', 'b'], pausedSessions: ['a', 'b', 7], setAside: { b: { due: 9, at: 5 } } });
    expect(await getSetAside()).toEqual({ a: { due: null, at: expect.any(Number) }, b: { due: 9, at: 5 } });
    await setOpenSessions(['a', 'b'], []);
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
    expect(raw.pausedSessions).toBeUndefined();
    expect(raw.setAside).toEqual({ a: { due: null, at: expect.any(Number) }, b: { due: 9, at: 5 } });
    // Written once, the mark is the file's own, so a read no longer makes it again.
    expect(await getSetAside()).toEqual(raw.setAside);
  });

  // They were stored as `later` before the act was called Set aside.
  it('read from the key they were stored under before, and the next write keeps them under the new one only', async () => {
    await writeMetaFile({ version: 3, later: { a: { due: 9, at: 5 } } });
    expect(await getSetAside()).toEqual({ a: { due: 9, at: 5 } });
    await markSetAside(['b'], null, 6);
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
    expect(raw.later).toBeUndefined();
    expect(raw.setAside).toEqual({ a: { due: 9, at: 5 }, b: { due: null, at: 6 } });
  });

  it('prefer the new key once both are there', async () => {
    await writeMetaFile({ version: 3, later: { a: { due: 9, at: 5 } }, setAside: { b: { due: null, at: 6 } } });
    expect(await getSetAside()).toEqual({ b: { due: null, at: 6 } });
  });

  // Its pause still waited for claude to leave at the quit, and pause never started or marked such a tab at launch.
  it('do not take a tab a file from before listed as paused and running as running', async () => {
    await writeMetaFile({ version: 3, openSessions: ['a', 'b'], runningSessions: ['a', 'b'], pausedSessions: ['a'] });
    expect(await getRunningSessions()).toEqual(['b']);
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
    await moveSessionsToGroup(['s1'], a.id);
    const { groupOf } = await moveSessionsToGroup(['s1'], b.id);
    expect(groupOf).toEqual({ s1: b.id });
  });

  it('moves several sessions in one write, from whichever groups they were in', async () => {
    const a = (await createGroup('A', '/repo')).groups[0];
    const b = (await createGroup('B', '/repo')).groups[0];
    await moveSessionsToGroup(['s1'], a.id);
    const before = await auditLines();
    expect((await moveSessionsToGroup(['s1', 's2'], b.id)).groupOf).toEqual({ s1: b.id, s2: b.id });
    expect((await auditLines()).slice(before.length).map((line) => / (\w+) open=/.exec(line)?.[1])).toEqual(['moveSessionsToGroup']);
  });

  it('takes a session out of every group with a null target, and ignores an unknown group', async () => {
    const a = (await createGroup('A', '/repo')).groups[0];
    await moveSessionsToGroup(['s1'], a.id);
    expect((await moveSessionsToGroup(['s1'], null)).groupOf).toEqual({});
    expect((await moveSessionsToGroup(['s1'], 'no-such-group')).groupOf).toEqual({});
  });

  it('deletes a group, ungrouping its members and leaving other groups alone', async () => {
    const doomed = (await createGroup('Doomed', '/repo')).groups[0];
    const keeper = (await createGroup('Keeper', '/repo')).groups[0];
    await moveSessionsToGroup(['s1'], doomed.id);
    await moveSessionsToGroup(['s2'], keeper.id);
    const { groups, groupOf } = await deleteGroup(doomed.id);
    expect(groups.map((g) => g.name)).toEqual(['Keeper']);
    expect(groupOf).toEqual({ s2: keeper.id }); // s1 is ungrouped, not deleted
  });

  it('drops a deleted session\'s membership', async () => {
    const a = (await createGroup('A', '/repo')).groups[0];
    await moveSessionsToGroup(['s1'], a.id);
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
    // /b contributes no sessions this time (all deleted, say) and must not lose its place.
    expect(await seedProjectOrder(['/a', '/c'])).toEqual(['/a', '/b', '/c']);
    expect(await seedProjectOrder(['/a', '/b', '/c'])).toEqual(['/a', '/b', '/c']);
  });

  it('moves a project to either end and one step at a time', async () => {
    const all = ['/a', '/b', '/c'];
    await seedProjectOrder(all);
    expect(await moveProject('/c', 'top', all)).toEqual(['/c', '/a', '/b']);
    expect(await moveProject('/c', 'down', all)).toEqual(['/a', '/c', '/b']);
    expect(await moveProject('/c', 'up', all)).toEqual(['/c', '/a', '/b']);
    expect(await moveProject('/c', 'bottom', all)).toEqual(['/a', '/b', '/c']);
  });

  it('moves among the projects shown, stepping over the rest', async () => {
    await seedProjectOrder(['/a', '/gone', '/b']);
    expect(await moveProject('/a', 'down', ['/a', '/b'])).toEqual(['/gone', '/b', '/a']);
  });

  it('ignores a move off either end and an unseen project', async () => {
    const all = ['/a', '/b'];
    await seedProjectOrder(all);
    expect(await moveProject('/a', 'up', all)).toEqual(['/a', '/b']);
    expect(await moveProject('/b', 'down', all)).toEqual(['/a', '/b']);
    expect(await moveProject('/nope', 'top', all)).toEqual(['/a', '/b']);
  });

  it('survives a reload', async () => {
    await seedProjectOrder(['/a', '/b']);
    await moveProject('/b', 'top', ['/a', '/b']);
    expect(await getProjectOrder()).toEqual(['/b', '/a']);
  });
});

describe('stripExpanded', () => {
  it('starts expanded, because the strip is meant to be read', async () => {
    expect((await getUiState()).stripExpanded).toBe(true);
  });

  it('remembers being closed, and being opened again', async () => {
    const ui = await getUiState();
    await setUiState({ ...ui, stripExpanded: false });
    expect((await getUiState()).stripExpanded).toBe(false);
    await setUiState({ ...ui, stripExpanded: true });
    expect((await getUiState()).stripExpanded).toBe(true);
  });

  it('takes the default when an older meta.json never mentioned it', async () => {
    await writeMetaFile({ pinned: ['s1'], version: 3 });
    expect((await getUiState()).stripExpanded).toBe(true);
  });

  // It used to be a key of its own, so an existing install's setting has to survive the move into `ui`.
  it('adopts the value from the key this used to live under', async () => {
    await writeMetaFile({ footerExpanded: false, version: 3 });
    expect((await getUiState()).stripExpanded).toBe(false);
  });

  // And it was `footerExpanded` inside `ui` too, before the strip had one name.
  it('adopts the value from the name it had inside `ui`', async () => {
    await writeMetaFile({ ui: { footerExpanded: false }, version: 3 });
    expect((await getUiState()).stripExpanded).toBe(false);
  });

  it('prefers what `ui` says over the old key, once both exist', async () => {
    await writeMetaFile({ footerExpanded: false, ui: { stripExpanded: true }, version: 3 });
    expect((await getUiState()).stripExpanded).toBe(true);
  });

  it('prefers the name it has now over the one it had inside `ui`', async () => {
    await writeMetaFile({ ui: { footerExpanded: false, stripExpanded: true }, version: 3 });
    expect((await getUiState()).stripExpanded).toBe(true);
  });

  // The old keys are consumed rather than carried along, so they do not linger in the file for ever.
  it('stops writing the old keys back out', async () => {
    await writeMetaFile({ footerExpanded: false, ui: { footerExpanded: false }, version: 3 });
    await setUiState({ ...(await getUiState()), stripExpanded: true });
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
    expect(raw.footerExpanded).toBeUndefined();
    expect(raw.ui.footerExpanded).toBeUndefined();
    expect(raw.ui.stripExpanded).toBe(true);
  });
});

describe('tabBarExpanded', () => {
  it('starts expanded, every tab in sight', async () => {
    expect((await getUiState()).tabBarExpanded).toBe(true);
  });

  it('remembers being folded, and being opened again', async () => {
    const ui = await getUiState();
    await setUiState({ ...ui, tabBarExpanded: false });
    expect((await getUiState()).tabBarExpanded).toBe(false);
    await setUiState({ ...ui, tabBarExpanded: true });
    expect((await getUiState()).tabBarExpanded).toBe(true);
  });

  it('takes the default when an older meta.json never mentioned it, or holds something else', async () => {
    await writeMetaFile({ ui: { stripExpanded: false }, version: 3 });
    expect((await getUiState()).tabBarExpanded).toBe(true);
    await writeMetaFile({ ui: { tabBarExpanded: 'no' }, version: 3 });
    expect((await getUiState()).tabBarExpanded).toBe(true);
  });
});

describe('stripHiddenProjects', () => {
  it('hides nothing on a first run', async () => {
    expect((await getUiState()).stripHiddenProjects).toEqual([]);
  });

  it('remembers the projects hidden from the strip', async () => {
    await setUiState({ ...(await getUiState()), stripHiddenProjects: ['/a', '/b'] });
    expect((await getUiState()).stripHiddenProjects).toEqual(['/a', '/b']);
  });

  it('keeps only the roots it can read', async () => {
    await writeMetaFile({ ui: { stripHiddenProjects: ['/a', 3, null, '/b'] }, version: 3 });
    expect((await getUiState()).stripHiddenProjects).toEqual(['/a', '/b']);
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
    filters: { pinned: true, open: false, live: false, setAside: false, worktree: false, gone: false, siblings: false, prs: false, noted: false, finished: false },
    datePreset: 'custom',
    dateFrom: 1_700_000_000_000,
    dateTo: 1_700_500_000_000,
    filterPanelOpen: true,
    stripExpanded: false,
    stripHiddenProjects: ['/home/me/side'],
    tabBarExpanded: false,
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
      filters: { pinned: false, open: false, live: false, setAside: false, worktree: false, gone: false, siblings: false, prs: false, noted: false, finished: false },
      datePreset: 'any',
      dateFrom: null,
      dateTo: null,
      filterPanelOpen: false,
      stripExpanded: true,
      stripHiddenProjects: [],
      tabBarExpanded: true,
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

describe('the finished filter, renamed from archived', () => {
  it('adopts the value stored under the old key', async () => {
    await writeMetaFile({ ui: { filters: { archived: true } }, version: 3 });
    expect((await getUiState()).filters.finished).toBe(true);
  });

  it('prefers the new key once both are there', async () => {
    await writeMetaFile({ ui: { filters: { archived: true, finished: false } }, version: 3 });
    expect((await getUiState()).filters.finished).toBe(false);
  });

  it('stops writing the old key back out', async () => {
    await writeMetaFile({ ui: { filters: { archived: true } }, version: 3 });
    await setUiState(await getUiState());
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
    expect(raw.ui.filters.archived).toBeUndefined();
    expect(raw.ui.filters.finished).toBe(true);
  });
});

describe('the set-aside filter, renamed from later', () => {
  it('adopts the value stored under the old key', async () => {
    await writeMetaFile({ ui: { filters: { later: true } }, version: 3 });
    expect((await getUiState()).filters.setAside).toBe(true);
  });

  it('prefers the new key once both are there', async () => {
    await writeMetaFile({ ui: { filters: { later: true, setAside: false } }, version: 3 });
    expect((await getUiState()).filters.setAside).toBe(false);
  });

  it('stops writing the old key back out', async () => {
    await writeMetaFile({ ui: { filters: { later: true } }, version: 3 });
    await setUiState(await getUiState());
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
    expect(raw.ui.filters.later).toBeUndefined();
    expect(raw.ui.filters.setAside).toBe(true);
  });
});

describe('the paused filter, which gave way to the set-aside one', () => {
  it('reads as off, and the set-aside pill with it, and is not written back out', async () => {
    await writeMetaFile({ ui: { filters: { paused: true } }, version: 3 });
    expect((await getUiState()).filters.setAside).toBe(false);
    await setUiState(await getUiState());
    const raw = JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'));
    expect(raw.ui.filters.paused).toBeUndefined();
  });
});

describe('the PR filter, added after filters were first stored', () => {
  it('reads as off from a file stored before it, keeping the pills that file has on', async () => {
    await writeMetaFile({ ui: { filters: { pinned: true, siblings: true } }, version: 3 });
    const { filters } = await getUiState();
    expect(filters.prs).toBe(false);
    expect(filters.pinned).toBe(true);
    expect(filters.siblings).toBe(true);
  });
});

describe('a filter a stored file has no value for', () => {
  it('takes its default, so one that defaults to on does not read as off', async () => {
    defaultsWith.pinnedOn = true;
    try {
      await writeMetaFile({ ui: { filters: { siblings: true } }, version: 3 });
      const { filters } = await getUiState();
      expect(filters.pinned).toBe(true);
      expect(filters.siblings).toBe(true);
    } finally {
      defaultsWith.pinnedOn = false;
    }
  });
});
