import { describe, it, expect } from 'vitest';
import { datePresetRange, inView, sessionPasses, type FilterCriteria } from '../../../../src/renderer/rules/session-filter';
import { session } from '../fixtures';

describe('datePresetRange', () => {
  const now = Date.parse('2026-07-28T12:00:00.000Z');
  it('computes rolling windows and start-of-today', () => {
    expect(datePresetRange('any', now)).toEqual({ from: null, to: null });
    expect(datePresetRange('custom', now)).toEqual({ from: null, to: null });
    expect(datePresetRange('7d', now)).toEqual({ from: now - 7 * 86_400_000, to: null });
    const today = datePresetRange('today', now);
    expect(new Date(today.from!).getHours()).toBe(0);
    expect(today.from!).toBeLessThanOrEqual(now);
  });
});

describe('inView', () => {
  const finished = new Set(['old']);
  const pendingDeletes = new Set(['going']);

  it('holds the sessions that are not finished in the normal view, and only the finished ones in the finished view', () => {
    expect(inView('live', false, finished, pendingDeletes)).toBe(true);
    expect(inView('old', false, finished, pendingDeletes)).toBe(false);
    expect(inView('old', true, finished, pendingDeletes)).toBe(true);
    expect(inView('live', true, finished, pendingDeletes)).toBe(false);
  });

  it('holds a session on its way to the trash in neither view, finished or not', () => {
    expect(inView('going', false, finished, pendingDeletes)).toBe(false);
    expect(inView('going', true, new Set(['going']), pendingDeletes)).toBe(false);
  });
});

describe('sessionPasses', () => {
  const base: FilterCriteria = {
    text: '',
    pinnedOnly: false,
    openOnly: false,
    liveOnly: false,
    setAsideOnly: false,
    worktreeOnly: false,
    goneOnly: false,
    siblingOnly: false,
    prsOnly: false,
    notedOnly: false,
    finishedOnly: false,
    dateFrom: null,
    dateTo: null,
    pinned: new Set(),
    finished: new Set(),
    pendingDeletes: new Set(),
  };

  it('keeps only sessions carrying a note when the note filter is on', () => {
    const notes = new Map([['s1', 'waiting on review']]);
    expect(sessionPasses(session({ id: 's1' }), { ...base, notedOnly: true, notes })).toBe(true);
    expect(sessionPasses(session({ id: 's2' }), { ...base, notedOnly: true, notes })).toBe(false);
  });

  it('matches note text, so a note is findable by searching for it', () => {
    const s = session({ id: 's1', title: 'Untitled', firstMessage: '', cwd: '/repo' });
    const notes = new Map([['s1', 'waiting on the review from kars']]);
    expect(sessionPasses(s, { ...base, text: 'kars', notes })).toBe(true);
    // Without the note it would not match — the row's own fields have no "kars" in them.
    expect(sessionPasses(s, { ...base, text: 'kars' })).toBe(false);
  });

  it('matches a note only on the session it belongs to', () => {
    const notes = new Map([['other', 'kars']]);
    expect(sessionPasses(session({ id: 's1' }), { ...base, text: 'kars', notes })).toBe(false);
  });

  it("matches a group's name, which is how typing it reaches that group", () => {
    const s = session({ id: 's1', title: 'Untitled', firstMessage: '', cwd: '/repo' });
    const groupNames = new Map([['s1', 'Terminal work']]);
    expect(sessionPasses(s, { ...base, text: 'terminal', groupNames })).toBe(true);
    expect(sessionPasses(s, { ...base, text: 'terminal' })).toBe(false);
  });

  it("matches a session's PRs by their reference, so a PR's number finds the session that linked it", () => {
    const bare = { title: 'Untitled', firstMessage: '', cwd: '/repo' };
    const linked = session({ ...bare, prs: [{ repository: 'ScientaNL/scienta', number: 35996, url: 'https://github.com/ScientaNL/scienta/pull/35996' }] });
    expect(sessionPasses(linked, { ...base, text: '35996' })).toBe(true);
    expect(sessionPasses(linked, { ...base, text: 'scienta#35996' })).toBe(true);
    expect(sessionPasses(session(bare), { ...base, text: '35996' })).toBe(false);
  });

  it("matches words of a linked PR's title, once it is known", () => {
    const linked = session({ title: 'Untitled', firstMessage: '', cwd: '/repo', prs: [{ repository: 'ScientaNL/scienta', number: 35996, url: 'https://github.com/ScientaNL/scienta/pull/35996' }] });
    const prNames = new Map([['scientanl/scienta#35996', { title: 'Scheduler tick per host' }]]);
    expect(sessionPasses(linked, { ...base, text: 'tick per host', prNames })).toBe(true);
    expect(sessionPasses(linked, { ...base, text: 'tick per host' })).toBe(false);
  });

  it("matches a group name only on that group's own members", () => {
    const groupNames = new Map([['other', 'Terminal work']]);
    expect(sessionPasses(session({ id: 's1' }), { ...base, text: 'terminal', groupNames })).toBe(false);
  });

  // The set worth finding: what to clean up, or what to put a folder back for.
  // It asks the row's own question rather than a second rule that could disagree with the dimming.
  it('shows only sessions whose folder is gone when asked', () => {
    const alive = session({ id: 'a' });
    const dead = session({ id: 'b', cwd: '/gone', cwdExists: false });
    expect(sessionPasses(dead, { ...base, goneOnly: true })).toBe(true);
    expect(sessionPasses(alive, { ...base, goneOnly: true })).toBe(false);
    // Off, it hides nothing.
    expect(sessionPasses(alive, base)).toBe(true);
    expect(sessionPasses(dead, base)).toBe(true);
  });

  it('shows only live sessions when asked, which is what the stop action needs', () => {
    const live = new Set(['s1']);
    expect(sessionPasses(session({ id: 's1' }), { ...base, liveOnly: true, live })).toBe(true);
    // A session with a tab but no process is not live, so it is filtered out too.
    expect(sessionPasses(session({ id: 's2' }), { ...base, liveOnly: true, live })).toBe(false);
  });

  it('shows only sessions marked for later when asked, a live one too', () => {
    const setAside = new Set(['s1', 's2']);
    const live = new Set(['s2']);
    expect(sessionPasses(session({ id: 's1' }), { ...base, setAsideOnly: true, setAside: setAside })).toBe(true);
    expect(sessionPasses(session({ id: 's3' }), { ...base, setAsideOnly: true, setAside: setAside })).toBe(false);
    // A mark on the session rather than a state of its tab, so a running one can carry it.
    expect(sessionPasses(session({ id: 's2' }), { ...base, setAsideOnly: true, setAside: setAside, liveOnly: true, live })).toBe(true);
  });

  it('separates having a tab from being live, which are different questions', () => {
    const open = new Set(['s1', 's2']);
    const live = new Set(['s1']);
    // s2 has a tab but no process: open shows it, live does not.
    expect(sessionPasses(session({ id: 's2' }), { ...base, openOnly: true, open })).toBe(true);
    expect(sessionPasses(session({ id: 's2' }), { ...base, liveOnly: true, live })).toBe(false);
    // s3 has neither.
    expect(sessionPasses(session({ id: 's3' }), { ...base, openOnly: true, open })).toBe(false);
  });

  it('hides pending deletes and finished (unless in the finished view)', () => {
    expect(sessionPasses(session({ id: 's1' }), { ...base, pendingDeletes: new Set(['s1']) })).toBe(false);
    expect(sessionPasses(session({ id: 's1' }), { ...base, finished: new Set(['s1']) })).toBe(false);
    expect(
      sessionPasses(session({ id: 's1' }), { ...base, finishedOnly: true, finished: new Set(['s1']) }),
    ).toBe(true);
  });

  it('applies pinned-only, worktree-only, text and date filters', () => {
    expect(sessionPasses(session({ id: 's1' }), { ...base, pinnedOnly: true })).toBe(false);
    expect(sessionPasses(session({ id: 's1' }), { ...base, pinnedOnly: true, pinned: new Set(['s1']) })).toBe(true);
    expect(sessionPasses(session({ worktree: '' }), { ...base, worktreeOnly: true })).toBe(false);
    expect(sessionPasses(session({ worktree: 'wt' }), { ...base, worktreeOnly: true })).toBe(true);
    expect(sessionPasses(session({ leftWorktree: 'wt' }), { ...base, worktreeOnly: true })).toBe(true);
    expect(sessionPasses(session({ checkouts: [{ root: '/repo/.claude/worktrees/wt', at: '2026-10-26T10:00:00.000Z', gone: false, own: false }] }), { ...base, worktreeOnly: true })).toBe(true);
    expect(sessionPasses(session({ isSibling: false }), { ...base, siblingOnly: true })).toBe(false);
    expect(sessionPasses(session({ isSibling: true, siblingIds: ['p'] }), { ...base, siblingOnly: true })).toBe(true);
    expect(sessionPasses(session({ prs: [] }), { ...base, prsOnly: true })).toBe(false);
    expect(sessionPasses(session({ prs: [{ repository: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1' }] }), { ...base, prsOnly: true })).toBe(true);
    expect(sessionPasses(session({ title: 'Fix the bug' }), { ...base, text: 'BUG' })).toBe(true);
    expect(sessionPasses(session({ title: 'Fix the bug' }), { ...base, text: 'perf' })).toBe(false);
    const activity = Date.parse('2026-07-28T10:00:00.000Z');
    expect(sessionPasses(session(), { ...base, dateFrom: activity + 1 })).toBe(false);
    expect(sessionPasses(session(), { ...base, dateFrom: activity - 1 })).toBe(true);
  });
});
