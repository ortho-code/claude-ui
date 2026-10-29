import { describe, it, expect } from 'vitest';
import type { SessionCheckout, SessionSummary } from '../../../src/shared/types';
import {
  projectFor,
  hasVisibleOutput,
  statusLabel,
  stripLine,
  dayLabel,
  dayStart,
  onDayAt,
  momentLabel,
  laterLabel,
  sessionPart,
  leaveAction,
  leaveLabel,
  leaveUnderWay,
  tabButton,
  scheduledLines,
  clockOf,
  clockLines,
  clockText,
  notLeftWords,
  sessionsByKey,
  structuralSignature,
  sameRow,
  groupByRepo,
  folderName,
  displayName,
  relativeTime,
  datePresetRange,
  sessionPasses,
  inView,
  nudgeOf,
  shownStatus,
  strongestNudge,
  asksForYou,
  projectsForSwitcher,
  modelLabel,
  reorderWithinGroup,
  buildProjectTree,
  groupJumpTargets,
  type FilterCriteria,
  orderProjects,
  orderAsTabs,
  unstartableReason,
  projectRootExists,
  projectGoneReason,
  worktreeMarkState,
  sessionLabel,
} from '../../../src/renderer/logic';

function session(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'id',
    conversationId: 'conv',
    cwd: '/repo',
    repoRoot: '/repo',
    isRepo: false,
    worktree: '',
    leftWorktree: '',
    movedOutOfWorktree: false,
    workCwd: '',
    checkouts: [],
    title: 'Title',
    firstMessage: 'first',
    model: '',
    lastActivity: '2026-07-28T10:00:00.000Z',
    isSibling: false,
    siblingIds: [],
    prs: [],
    postCompactHeads: [],
    // A session whose folders are both there, which is every case except the ones that say otherwise.
    cwdExists: true,
    repoRootExists: true,
    ...over,
  };
}

describe('unstartableReason', () => {
  it('says nothing about a session whose folder is there', () => {
    expect(unstartableReason(session())).toBeNull();
  });

  // The repo is fine and only the tree is gone, so the reason names the thing to put back — `git worktree add` at that path and the session works again.
  it('names the worktree when only the worktree is gone', () => {
    const gone = session({ cwd: '/repo/.claude/worktrees/wt', worktree: 'wt', cwdExists: false, repoRootExists: true });
    expect(unstartableReason(gone)).toContain('worktree “wt” is gone');
    expect(unstartableReason(gone)).toContain('/repo/.claude/worktrees/wt');
  });

  // The whole checkout is gone, so there is nothing smaller to point at.
  it('names the folder when the project itself is gone', () => {
    const gone = session({ cwd: '/gone', worktree: 'wt', cwdExists: false, repoRootExists: false });
    expect(unstartableReason(gone)).toBe("This session's folder is gone, so it cannot run: /gone");
  });

  it('treats a plain session with no worktree the same way', () => {
    expect(unstartableReason(session({ cwd: '/gone', cwdExists: false }))).toContain('/gone');
  });
});

describe('worktreeMarkState', () => {
  it('marks nothing for a session that never ran in a worktree', () => {
    expect(worktreeMarkState(session())).toBeNull();
  });

  it('names the worktree a session is in', () => {
    expect(worktreeMarkState(session({ worktree: 'wt' }))).toEqual({ muted: false, tooltip: 'Linked git worktree: wt', count: 0 });
  });

  // The session still did its work there, and the tooltip says which way it left and where a resume runs now.
  it('mutes the mark of a worktree the session was closed in, saying it closed there and where it resumes', () => {
    expect(worktreeMarkState(session({ cwd: '/repo', leftWorktree: 'wt' }))).toEqual({ muted: true, tooltip: 'Worked in linked git worktree: wt until it closed; resumes in /repo', count: 0 });
  });

  it('mutes the mark of a worktree the session moved out of, saying it moved and where it is now', () => {
    expect(worktreeMarkState(session({ cwd: '/repo', leftWorktree: 'wt', movedOutOfWorktree: true }))).toEqual({ muted: true, tooltip: 'Moved out of linked git worktree: wt; now in /repo', count: 0 });
  });

  const checkout = (root: string, own = false): SessionCheckout => ({ root, at: own ? '' : '2026-10-26T10:00:00.000Z', gone: false, own });

  // d90f859a: in the main checkout, its changes in worktrees it reached with a `cd`.
  it('marks a session that worked in worktrees it did not enter, in the accent while its panels follow it into one', () => {
    const checkouts = ['b', 'c', 'd'].map((name) => checkout(`/repo/.claude/worktrees/${name}`));
    expect(worktreeMarkState(session({ checkouts, workCwd: '/repo/.claude/worktrees/b' }))).toEqual({ muted: false, tooltip: 'Its panels follow it into linked git worktree: b; 3 checkouts it worked in', count: 3 });
    expect(worktreeMarkState(session({ checkouts }))).toEqual({ muted: true, tooltip: '3 checkouts it worked in', count: 3 });
  });

  // b11ed876: closed in its worktree, and changing files in it by path since.
  it('keeps the mark of a worktree the session left in the accent while its panels follow it there', () => {
    expect(worktreeMarkState(session({ cwd: '/repo', leftWorktree: 'wt', workCwd: '/repo/.claude/worktrees/wt' }))).toEqual({
      muted: false,
      tooltip: 'Worked in linked git worktree: wt until it closed; resumes in /repo; its panels follow it into linked git worktree: wt',
      count: 0,
    });
  });

  // 49ac1ff5: in a worktree, changing files in another and in the main checkout.
  it('counts the checkouts of a session in a worktree, its own among them, and names the main checkout when its panels follow it there', () => {
    const checkouts = [checkout('/repo'), checkout('/repo/.claude/worktrees/b'), checkout('/repo/.claude/worktrees/wt', true)];
    expect(worktreeMarkState(session({ cwd: '/repo/.claude/worktrees/wt', worktree: 'wt', checkouts, workCwd: '/repo' }))).toEqual({
      muted: false,
      tooltip: 'Linked git worktree: wt; its panels follow it into the main checkout; 3 checkouts it worked in',
      count: 3,
    });
  });
});

describe('projectRootExists', () => {
  it('holds while any session under the project still sees its folder', () => {
    expect(projectRootExists([session({ repoRootExists: false }), session({ repoRootExists: true })])).toBe(true);
  });

  it('fails only when every session says the folder is gone', () => {
    expect(projectRootExists([session({ repoRootExists: false }), session({ repoRootExists: false })])).toBe(false);
  });
});

describe('projectGoneReason', () => {
  it('names the folder that is gone', () => {
    expect(projectGoneReason('/gone')).toBe("This project's folder is gone, so nothing in it can run: /gone");
  });
});

describe('sessionsByKey', () => {
  it('indexes every session by its own id (ids are the stable entity key)', () => {
    const a = session({ id: 'a', conversationId: 'c', lastActivity: '2026-07-01T00:00:00.000Z' });
    const b = session({ id: 'b', conversationId: 'c', lastActivity: '2026-07-28T00:00:00.000Z' });
    const tips = sessionsByKey([a, b]);
    expect(tips.size).toBe(2);
    expect(tips.get('a')?.id).toBe('a');
    expect(tips.get('b')?.id).toBe('b');
  });
});

describe('structuralSignature', () => {
  it('is stable regardless of order and ignores activity', () => {
    const a = session({ id: 'a', conversationId: 'ca' });
    const b = session({ id: 'b', conversationId: 'cb' });
    const sigActivityChanged = session({ id: 'a', conversationId: 'ca', lastActivity: 'x' });
    expect(structuralSignature([a, b])).toBe(structuralSignature([b, a]));
    expect(structuralSignature([a])).toBe(structuralSignature([sigActivityChanged]));
  });

  it('changes when a title changes', () => {
    const a = session();
    expect(structuralSignature([a])).not.toBe(structuralSignature([session({ title: 'Renamed' })]));
  });

  /**
   * Every field a row is drawn from, one case each.
   * The sidebar is only redrawn when this string moves, so a field missing here is a row that FREEZES — it keeps the old value until something unrelated changes.
   * `model` is the one that was actually missing: switching model mid-session left the old label on the row.
   */
  it.each([
    ['model', { model: 'claude-opus-4' }],
    ['worktree', { worktree: 'feature-x' }],
    ['leftWorktree', { leftWorktree: 'feature-x' }],
    ['repoRoot', { repoRoot: '/elsewhere' }],
    ['isRepo', { isRepo: true }],
    ['cwd', { cwd: '/elsewhere' }],
    ['firstMessage', { firstMessage: 'hello' }],
    ['isSibling', { isSibling: true }],
    ['siblingIds', { siblingIds: ['other'] }],
    ['prs', { prs: [{ repository: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1' }] }],
    ['id', { id: 'other' }],
    ['conversationId', { conversationId: 'other' }],
  ])('changes when %s changes', (_field, over) => {
    expect(structuralSignature([session()])).not.toBe(structuralSignature([session(over)]));
  });

  // A field holding objects: one swapped for another at the same count has to move it as well.
  it('changes when a PR is swapped for another', () => {
    const pr = (number: number) => ({ repository: 'o/r', number, url: `https://github.com/o/r/pull/${number}` });
    expect(structuralSignature([session({ prs: [pr(1)] })])).not.toBe(structuralSignature([session({ prs: [pr(2)] })]));
  });
  // The two that must NOT move it: one is rewritten on every message of a running session, the other is never drawn.
  it.each([
    ['lastActivity', { lastActivity: '2030-01-01T00:00:00Z' }],
    ['postCompactHeads', { postCompactHeads: ['head-1'] }],
  ])('ignores %s', (_field, over) => {
    expect(structuralSignature([session()])).toBe(structuralSignature([session(over)]));
  });
});

// The same fields, for one session against another summary of it: what an open tab asks of a fresh read.
describe('sameRow', () => {
  it('holds across a fresh summary that moved only what no row draws, and not across one that moved a drawn field', () => {
    expect(sameRow(session(), session({ lastActivity: '2030-01-01T00:00:00Z', postCompactHeads: ['head-1'] }))).toBe(true);
    expect(sameRow(session(), session({ title: 'Renamed' }))).toBe(false);
    expect(sameRow(session(), session({ cwdExists: false }))).toBe(false);
  });
});

describe('groupByRepo / folderName', () => {
  it('groups sessions by their repo root', () => {
    const projects = groupByRepo([session({ repoRoot: '/x' }), session({ repoRoot: '/y' }), session({ repoRoot: '/x' })]);
    const map = new Map(projects);
    expect(map.get('/x')?.length).toBe(2);
    expect(map.get('/y')?.length).toBe(1);
  });

  it('names a project by the last path segment', () => {
    expect(folderName('/home/jille/development/scienta')).toBe('scienta');
    expect(folderName('scienta')).toBe('scienta');
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-07-28T12:00:00.000Z');
  it('formats buckets', () => {
    expect(relativeTime('2026-07-28T11:59:30.000Z', now)).toBe('just now');
    expect(relativeTime('2026-07-28T11:30:00.000Z', now)).toBe('30 min ago');
    expect(relativeTime('2026-07-28T09:00:00.000Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-07-26T12:00:00.000Z', now)).toBe('2 d ago');
  });
});

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
  const archived = new Set(['old']);
  const pendingDeletes = new Set(['going']);

  it('holds the sessions that are not archived in the normal view, and only the archived ones in the archived view', () => {
    expect(inView('live', false, archived, pendingDeletes)).toBe(true);
    expect(inView('old', false, archived, pendingDeletes)).toBe(false);
    expect(inView('old', true, archived, pendingDeletes)).toBe(true);
    expect(inView('live', true, archived, pendingDeletes)).toBe(false);
  });

  it('holds a session on its way to the trash in neither view, archived or not', () => {
    expect(inView('going', false, archived, pendingDeletes)).toBe(false);
    expect(inView('going', true, new Set(['going']), pendingDeletes)).toBe(false);
  });
});

describe('sessionPasses', () => {
  const base: FilterCriteria = {
    text: '',
    pinnedOnly: false,
    openOnly: false,
    liveOnly: false,
    laterOnly: false,
    worktreeOnly: false,
    goneOnly: false,
    siblingOnly: false,
    prsOnly: false,
    notedOnly: false,
    archivedOnly: false,
    dateFrom: null,
    dateTo: null,
    pinned: new Set(),
    archived: new Set(),
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
    const later = new Set(['s1', 's2']);
    const live = new Set(['s2']);
    expect(sessionPasses(session({ id: 's1' }), { ...base, laterOnly: true, later })).toBe(true);
    expect(sessionPasses(session({ id: 's3' }), { ...base, laterOnly: true, later })).toBe(false);
    // A mark on the session rather than a state of its tab, so a running one can carry it.
    expect(sessionPasses(session({ id: 's2' }), { ...base, laterOnly: true, later, liveOnly: true, live })).toBe(true);
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

  it('hides pending deletes and archived (unless in the archived view)', () => {
    expect(sessionPasses(session({ id: 's1' }), { ...base, pendingDeletes: new Set(['s1']) })).toBe(false);
    expect(sessionPasses(session({ id: 's1' }), { ...base, archived: new Set(['s1']) })).toBe(false);
    expect(
      sessionPasses(session({ id: 's1' }), { ...base, archivedOnly: true, archived: new Set(['s1']) }),
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

describe('projectFor', () => {
  const roots = ['/home/u/dev/scienta', '/home/u/dev/scienta/tools/dev-aws', '/home/u/dev/other'];

  it('finds the project a folder is, or the deepest one it sits under', () => {
    expect(projectFor(roots, '/home/u/dev/scienta')).toBe('/home/u/dev/scienta');
    expect(projectFor(roots, '/home/u/dev/scienta/packages/api')).toBe('/home/u/dev/scienta');
    expect(projectFor(roots, '/home/u/dev/scienta/tools/dev-aws/src')).toBe('/home/u/dev/scienta/tools/dev-aws');
  });

  it('does not take a folder whose name only starts the same, and finds nothing for a folder outside every project', () => {
    expect(projectFor(roots, '/home/u/dev/scienta-old')).toBeNull();
    expect(projectFor(roots, '/tmp')).toBeNull();
    expect(projectFor([], '/home/u/dev/scienta')).toBeNull();
  });
});

describe('nudgeOf', () => {
  it('counts a live status, muted once read, and nothing for a session with none', () => {
    const table: [string | undefined, unread: string | null, read: string | null][] = [
      ['waiting', 'waiting', null],
      ['needs', 'needs', null],
      ['idle', 'idle', null],
      // Busy cannot be read (toggleAck), so the mark is never there to mute it.
      ['busy', 'busy', 'busy'],
      // Work still running is working, whatever the turn did: nothing to read, and no "finished" for a roll-up to carry.
      ['background', 'busy', 'busy'],
      ['closed', null, null],
      [undefined, null, null],
    ];
    for (const [status, unread, read] of table) {
      expect(nudgeOf(status, false), `${status} unread`).toBe(unread);
      expect(nudgeOf(status, true), `${status} read`).toBe(read);
    }
  });
});

describe('shownStatus', () => {
  // The order decided 2026-10-28: claude working or asking shows over the mark, and the mark over a turn that finished or no status at all.
  it('shows the needs-you mark over idle, closed and no status, and busy, background and waiting over it', () => {
    for (const status of ['idle', 'closed', undefined]) expect(shownStatus(status, true), `${status} marked`).toBe('needs');
    for (const status of ['busy', 'background', 'waiting']) expect(shownStatus(status, true), `${status} marked`).toBe(status);
    for (const status of ['idle', 'busy', undefined]) expect(shownStatus(status, false), `${status} unmarked`).toBe(status);
  });
});

describe('strongestNudge', () => {
  it('ranks waiting over needs over idle over busy', () => {
    expect(strongestNudge(['busy', 'idle', 'needs', 'waiting'])).toBe('waiting');
    expect(strongestNudge(['busy', 'idle', 'needs'])).toBe('needs');
    expect(strongestNudge(['busy', 'idle'])).toBe('idle');
    expect(strongestNudge([null])).toBeNull();
  });
});

describe('asksForYou', () => {
  it('is a turn that ended, waiting for you or finished, and nothing at work or with nothing to say', () => {
    expect(asksForYou('waiting')).toBe(true);
    expect(asksForYou('needs')).toBe(true);
    expect(asksForYou('idle')).toBe(true);
    expect(asksForYou('busy')).toBe(false);
    expect(asksForYou(null)).toBe(false);
  });
});

describe('projectsForSwitcher', () => {
  // Sessions arrive recency-sorted (newest first), as listSessions returns them.
  const s = (id: string, repoRoot: string) => session({ id, conversationId: id, repoRoot });

  it('groups by repoRoot with per-folder counts and an All aggregate', () => {
    const model = projectsForSwitcher(
      [s('a1', '/x/alpha'), s('b1', '/x/beta'), s('a2', '/x/alpha')],
      new Map(),
      new Set(),
      new Map(),
    );
    expect(model.all.count).toBe(3);
    expect(model.projects.map((f) => [f.name, f.count])).toEqual([
      ['alpha', 2],
      ['beta', 1],
    ]);
  });

  it('orders projects by recency (most-recent session first)', () => {
    const model = projectsForSwitcher([s('b1', '/x/beta'), s('a1', '/x/alpha')], new Map(), new Set(), new Map());
    expect(model.projects.map((f) => f.name)).toEqual(['beta', 'alpha']);
  });

  it('rolls up the strongest nudge per folder: waiting > idle > busy', () => {
    const statuses = new Map([
      ['a1', 'busy'],
      ['a2', 'waiting'],
      ['b1', 'busy'],
      ['b2', 'idle'],
    ]);
    const model = projectsForSwitcher(
      [s('a1', '/x/alpha'), s('a2', '/x/alpha'), s('b1', '/x/beta'), s('b2', '/x/beta')],
      statuses,
      new Set(),
      new Map(),
    );
    const byName = new Map(model.projects.map((f) => [f.name, f.badge]));
    expect(byName.get('alpha')).toBe('waiting'); // waiting beats busy
    expect(byName.get('beta')).toBe('idle'); // idle beats busy
    expect(model.all.badge).toBe('waiting'); // strongest across everything
  });

  // A session marked as needing you counts where claude says nothing more pressing: over idle, under waiting, and not while claude works.
  it('rolls up a needs-you mark between waiting and idle, and not over busy', () => {
    const mark = { reason: 'quit' as const, at: 1 };
    const statuses = new Map([
      ['a2', 'idle'],
      ['b1', 'waiting'],
      ['c1', 'busy'],
    ]);
    const needsYou = new Map([
      ['a1', mark],
      ['b2', mark],
      ['c1', mark],
    ]);
    const model = projectsForSwitcher(
      [s('a1', '/x/alpha'), s('a2', '/x/alpha'), s('b1', '/x/beta'), s('b2', '/x/beta'), s('c1', '/x/gamma')],
      statuses,
      new Set(),
      needsYou,
    );
    const byName = new Map(model.projects.map((f) => [f.name, f.badge]));
    expect(byName.get('alpha')).toBe('needs');
    expect(byName.get('beta')).toBe('waiting');
    expect(byName.get('gamma')).toBe('busy');
    // Read, it falls through as any other.
    expect(projectsForSwitcher([s('a1', '/x/alpha'), s('a2', '/x/alpha')], statuses, new Set(['a1']), needsYou).projects[0].badge).toBe('idle');
  });

  it('mutes acked sessions so the badge falls through to the next status', () => {
    const statuses = new Map([
      ['a1', 'waiting'],
      ['a2', 'idle'],
    ]);
    const model = projectsForSwitcher([s('a1', '/x/alpha'), s('a2', '/x/alpha')], statuses, new Set(['a1']), new Map());
    expect(model.projects[0].badge).toBe('idle'); // waiting is acked, so idle wins
  });

  it('badge is null when a folder has no live status (or all acked)', () => {
    const statuses = new Map([['a1', 'waiting']]);
    expect(projectsForSwitcher([s('a1', '/x/alpha')], new Map(), new Set(), new Map()).projects[0].badge).toBeNull();
    expect(
      projectsForSwitcher([s('a1', '/x/alpha')], statuses, new Set(['a1']), new Map()).projects[0].badge,
    ).toBeNull();
  });

  // The switcher marks a dead project the way its heading does, so the two are answered by the same rule.
  it('says which projects have lost their folder', () => {
    const model = projectsForSwitcher(
      [session({ id: 'a', repoRoot: '/x/alive' }), session({ id: 'g', repoRoot: '/x/gone', repoRootExists: false, cwdExists: false })],
      new Map(),
      new Set(),
      new Map(),
    );
    expect(model.projects.map((f) => [f.name, f.rootExists])).toEqual([
      ['alive', true],
      ['gone', false],
    ]);
  });

  it('handles an empty session list', () => {
    const model = projectsForSwitcher([], new Map(), new Set(), new Map());
    expect(model.projects).toEqual([]);
    expect(model.all).toEqual({ count: 0, badge: null });
  });

  // The list keeps the same project (buildProjectTree), so the two agree on which projects there are and where each sits.
  it('lists a project whose sessions are all archived at none, in its place, its folder answered by those sessions', () => {
    const archived = new Map([['/x/gone', [session({ id: 'g', repoRoot: '/x/gone', repoRootExists: false, cwdExists: false })]]]);
    const model = projectsForSwitcher([s('a1', '/x/alpha')], new Map([['g', 'waiting']]), new Set(), new Map(), undefined, ['/x/gone', '/x/alpha'], archived);
    expect(model.projects.map((f) => [f.name, f.count, f.badge, f.rootExists])).toEqual([
      ['gone', 0, null, false],
      ['alpha', 1, null, true],
    ]);
    expect(model.all.count).toBe(1);
  });
});

describe('modelLabel', () => {
  it('maps a model id to family + version, dropping the date', () => {
    expect(modelLabel('claude-opus-4-8')).toBe('Opus 4.8');
    expect(modelLabel('claude-opus-5')).toBe('Opus 5');
    expect(modelLabel('claude-fable-5')).toBe('Fable 5');
    expect(modelLabel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5');
    expect(modelLabel('claude-3-5-haiku-20241022')).toBe('Haiku 3.5'); // version-first id order
    expect(modelLabel('claude-opus-4-20250514')).toBe('Opus 4');
  });
  it('handles an unseen family generically (no hardcoded list)', () => {
    expect(modelLabel('claude-metis-6')).toBe('Metis 6');
  });
  it('falls back to the raw id with no family word, and empty in -> empty out', () => {
    expect(modelLabel('claude-2099')).toBe('claude-2099');
    expect(modelLabel('')).toBe('');
  });
});

describe('reorderWithinGroup', () => {
  const key = (t: { id: string; g: string }) => t.g;
  const ids = (list: { id: string }[]) => list.map((t) => t.id);

  it('reorders within a single group', () => {
    const a = { id: 'a', g: 'x' }, b = { id: 'b', g: 'x' }, c = { id: 'c', g: 'x' };
    expect(ids(reorderWithinGroup([a, b, c], key, a, 2))).toEqual(['b', 'c', 'a']);
  });

  it('leaves other groups in their slots', () => {
    const a = { id: 'a', g: 'x' }, b = { id: 'b', g: 'y' }, c = { id: 'c', g: 'x' };
    // Move c to the front of group x; y keeps its slot (index 1).
    expect(ids(reorderWithinGroup([a, b, c], key, c, 0))).toEqual(['c', 'b', 'a']);
  });

  it('clamps the index and no-ops an item that is not present', () => {
    const a = { id: 'a', g: 'x' }, b = { id: 'b', g: 'x' };
    expect(ids(reorderWithinGroup([a, b], key, a, 9))).toEqual(['b', 'a']);
    expect(ids(reorderWithinGroup([a, b], key, { id: 'z', g: 'x' }, 0))).toEqual(['a', 'b']);
  });
});

describe('displayName', () => {
  it('uses the rename override when present, else the folder name', () => {
    const names = new Map([['/x/alpha', 'My Project']]);
    expect(displayName('/x/alpha', names)).toBe('My Project');
    expect(displayName('/x/beta', names)).toBe('beta');
    expect(displayName('/x/beta')).toBe('beta'); // no map at all
    expect(displayName('/x/alpha', new Map([['/x/alpha', '']]))).toBe('alpha'); // blank falls back
  });
});

describe('sessionLabel', () => {
  it("names a session by Claude's title, else its first prompt, else as new in its folder", () => {
    expect(sessionLabel(session({ title: 'Fix the login', firstMessage: 'the login is broken', cwd: '/x/demo' }))).toBe('Fix the login');
    expect(sessionLabel(session({ title: '', firstMessage: 'the login is broken', cwd: '/x/demo' }))).toBe('the login is broken');
    expect(sessionLabel(session({ title: '', firstMessage: '', cwd: '/x/demo' }))).toBe('New: demo');
  });
});

describe('sessionsByKey with siblings', () => {
  it('keeps every session as its own tip, siblings and lone alike', () => {
    const lone = session({ id: 'lone', conversationId: 'L', lastActivity: '2026-01-01' });
    const s1 = session({ id: 's1', conversationId: 'C', isSibling: true, siblingIds: ['s2'], lastActivity: '2026-01-03' });
    const s2 = session({ id: 's2', conversationId: 'C', isSibling: true, siblingIds: ['s1'], lastActivity: '2026-01-02' });
    const tips = sessionsByKey([lone, s1, s2]);
    expect(tips.size).toBe(3);
    expect(tips.get('lone')?.id).toBe('lone');
    expect(tips.get('s1')?.id).toBe('s1');
    expect(tips.get('s2')?.id).toBe('s2');
  });
});

describe('buildProjectTree', () => {
  // Sessions arrive recency-sorted (newest first), as listSessions returns them.
  const s = (id: string, repoRoot = '/repo') => session({ id, conversationId: id, repoRoot });
  const group = (id: string, name: string, repoRoot: string | null = '/repo') => ({ id, name, repoRoot });
  const none = new Set<string>();

  it('puts groups first in registry order, then the sessions in no group', () => {
    const tree = buildProjectTree(
      [s('a'), s('b'), s('c')],
      { groups: [group('g1', 'First'), group('g2', 'Second')], groupOf: { a: 'g2', b: 'g1' } },
      none,
    );
    expect(tree).toHaveLength(1);
    expect(tree[0].groups.map((g) => [g.group.name, g.sessions.map((x) => x.id)])).toEqual([
      ['First', ['b']],
      ['Second', ['a']],
    ]);
    expect(tree[0].loose.map((x) => x.id)).toEqual(['c']);
    expect(tree[0].count).toBe(3); // grouped and loose together
  });

  it('keeps an empty group so a freshly created one is visible', () => {
    const tree = buildProjectTree([s('a')], { groups: [group('g1', 'Empty')], groupOf: {} }, none);
    expect(tree[0].groups.map((g) => g.group.name)).toEqual(['Empty']);
    expect(tree[0].groups[0].sessions).toEqual([]);
  });

  it('hides emptied groups while filtering, where they would just be noise', () => {
    const state = { groups: [group('g1', 'Empty'), group('g2', 'Has one')], groupOf: { a: 'g2' } };
    const tree = buildProjectTree([s('a')], state, none, true);
    expect(tree[0].groups.map((g) => g.group.name)).toEqual(['Has one']);
  });

  it('floats a pin to the top of its own section, never out of its group', () => {
    const state = { groups: [group('g1', 'G')], groupOf: { a: 'g1', b: 'g1' } };
    const tree = buildProjectTree([s('a'), s('b'), s('c'), s('d')], state, new Set(['b', 'd']));
    expect(tree[0].groups[0].sessions.map((x) => x.id)).toEqual(['b', 'a']); // pinned b rises inside G
    expect(tree[0].loose.map((x) => x.id)).toEqual(['d', 'c']);
  });

  it('shows a session whose group belongs to another project as loose in its own', () => {
    const state = { groups: [group('g1', 'Elsewhere', '/other')], groupOf: { a: 'g1' } };
    const tree = buildProjectTree([s('a', '/repo')], state, none);
    expect(tree[0].repoRoot).toBe('/repo');
    expect(tree[0].groups).toEqual([]);
    expect(tree[0].loose.map((x) => x.id)).toEqual(['a']); // visible, not swallowed
  });

  it('ignores a cross-project group until that feature exists', () => {
    const state = { groups: [group('g1', 'Everything', null)], groupOf: { a: 'g1' } };
    const tree = buildProjectTree([s('a')], state, none);
    expect(tree[0].groups).toEqual([]);
    expect(tree[0].loose.map((x) => x.id)).toEqual(['a']);
  });

  it('orders projects by first appearance and reports whether one is a git repo', () => {
    const repo = session({ id: 'r', conversationId: 'r', repoRoot: '/beta', isRepo: true });
    const tree = buildProjectTree([s('a', '/alpha'), repo], { groups: [], groupOf: {} }, none);
    expect(tree.map((p) => [p.repoRoot, p.isRepo])).toEqual([
      ['/alpha', false],
      ['/beta', true],
    ]);
  });

  it('keeps a project whose sessions are all archived in its place, with no rows, its groups, and how many it has archived', () => {
    const archived = [session({ id: 'x', conversationId: 'x', repoRoot: '/kept', isRepo: true }), session({ id: 'y', conversationId: 'y', repoRoot: '/kept', isRepo: true })];
    const state = { groups: [group('g1', 'Kept group', '/kept')], groupOf: { x: 'g1' } };
    const tree = buildProjectTree([s('a', '/alpha')], state, none, false, ['/kept', '/alpha'], new Map([['/kept', archived]]));
    expect(tree.map((p) => [p.repoRoot, p.count, p.archived, p.isRepo, p.rootExists])).toEqual([
      ['/kept', 0, 2, true, true],
      ['/alpha', 1, 0, false, true],
    ]);
    expect(tree[0].groups.map((g) => [g.group.name, g.sessions])).toEqual([['Kept group', []]]);
    expect(tree[0].loose).toEqual([]);
  });
});

describe('orderProjects', () => {
  const entries = (...roots: string[]): [string, number][] => roots.map((r, i) => [r, i]);

  it('follows the explicit order, whatever order the entries arrive in', () => {
    const out = orderProjects(entries('/b', '/a', '/c'), ['/a', '/b', '/c']);
    expect(out.map(([root]) => root)).toEqual(['/a', '/b', '/c']);
  });

  it('leaves an unseeded project at the end, in its incoming position', () => {
    // /new has no slot yet: it sorts last rather than guessing a place it would then jump out of.
    const out = orderProjects(entries('/new', '/b', '/a'), ['/a', '/b']);
    expect(out.map(([root]) => root)).toEqual(['/a', '/b', '/new']);
  });

  it('keeps unseeded projects in their incoming order relative to each other', () => {
    const out = orderProjects(entries('/x', '/a', '/y'), ['/a']);
    expect(out.map(([root]) => root)).toEqual(['/a', '/x', '/y']);
  });

  it('ignores slots for projects that are not present', () => {
    const out = orderProjects(entries('/c', '/a'), ['/a', '/gone', '/c']);
    expect(out.map(([root]) => root)).toEqual(['/a', '/c']);
  });
});

describe('groupJumpTargets', () => {
  const s = (id: string) => session({ id, conversationId: id, repoRoot: '/repo' });
  const group = (id: string, name: string) => ({ id, name, repoRoot: '/repo' });
  const none = new Set<string>();
  const tree = (groupOf: Record<string, string>, groups = [group('g1', 'First'), group('g2', 'Second')]) =>
    buildProjectTree([s('a'), s('b'), s('c')], { groups, groupOf }, none)[0];

  it('lists the groups in list order, then the ungrouped remainder', () => {
    const out = groupJumpTargets(tree({ a: 'g2', b: 'g1' }), new Map(), none, new Map());
    expect(out.map((t) => [t.name, t.count])).toEqual([
      ['First', 1],
      ['Second', 1],
      ['Ungrouped', 1],
    ]);
    expect(out.at(-1)!.groupId).toBeNull();
  });

  it('omits the ungrouped entry when every session is in a group', () => {
    const out = groupJumpTargets(tree({ a: 'g1', b: 'g1', c: 'g2' }), new Map(), none, new Map());
    expect(out.map((t) => t.name)).toEqual(['First', 'Second']);
  });

  it('keeps an empty group, which still has a heading to jump to', () => {
    const out = groupJumpTargets(tree({ a: 'g1', b: 'g1', c: 'g1' }), new Map(), none, new Map());
    expect(out.map((t) => [t.name, t.count])).toEqual([
      ['First', 3],
      ['Second', 0],
    ]);
  });

  it('rolls up the strongest unattended status in each target', () => {
    const statuses = new Map([
      ['a', 'busy'],
      ['b', 'waiting'],
      ['c', 'idle'],
    ]);
    const out = groupJumpTargets(tree({ a: 'g1', b: 'g1' }), statuses, none, new Map());
    expect(out.map((t) => t.badge)).toEqual(['waiting', null, 'idle']);
  });

  it('rolls up a needs-you mark over idle', () => {
    const out = groupJumpTargets(tree({ a: 'g1' }), new Map([['c', 'idle']]), none, new Map([['c', { reason: 'quit' as const, at: 1 }]]));
    expect(out.map((t) => t.badge)).toEqual([null, null, 'needs']);
  });

  it('ignores an acked session, so a muted group shows no dot', () => {
    const statuses = new Map([['a', 'waiting']]);
    const out = groupJumpTargets(tree({ a: 'g1' }), statuses, new Set(['a']), new Map());
    expect(out[0].badge).toBeNull();
  });
});

// The exact chunks a starting claude sends, captured from a real pty.
// The loader hides the terminal until something is actually drawn, so a false "visible" here is a pane that flashes and goes empty again — which is what happened when this only tested for the first BYTE.
describe('hasVisibleOutput', () => {
  it('ignores the terminal setup claude sends before drawing anything', () => {
    // ESC 7 and ESC 8 are the trap: two-char escapes whose second byte is a DIGIT, so a stripper that only handles CSI and letter-escapes leaves "7" behind and calls it content.
    expect(hasVisibleOutput('\x1b7\x1b[r\x1b8\x1b[?25h')).toBe(false);
    expect(hasVisibleOutput('\x1b[?25l')).toBe(false);
    expect(hasVisibleOutput('\x1b[?2004h\x1b[?1004h\x1b[?2031h')).toBe(false);
    expect(hasVisibleOutput('\x1b[>0q\x1b[c')).toBe(false);
  });

  it('ignores an OSC window-title sequence and bare whitespace', () => {
    expect(hasVisibleOutput('\x1b]0;claude\x07')).toBe(false);
    expect(hasVisibleOutput('\r\r\n\r\r\n')).toBe(false);
    expect(hasVisibleOutput('')).toBe(false);
  });

  it('reports the first chunk that actually draws', () => {
    expect(hasVisibleOutput('\r\n\x1b[38;2;255;193;7m────\x1b[39m\r\n\x1b[2GAccessing')).toBe(true);
    expect(hasVisibleOutput('hello')).toBe(true);
  });

  it('counts a sequence the chunk ends partway through as nothing yet, and the text after a complete one as content', () => {
    expect(hasVisibleOutput('\x1b]0;claude\x1b[?25l')).toBe(false);
    expect(hasVisibleOutput('\x1b[38;2;25')).toBe(false);
    expect(hasVisibleOutput('\x1bPq#0;2;0;0;0')).toBe(false);
    expect(hasVisibleOutput('\x1b[2GAccessing')).toBe(true);
  });
});

describe('orderAsTabs', () => {
  /** An item to place: its project, its group ('' for none), and a name to assert on. */
  const at = (item: string, repoRoot: string, groupId = '') => ({ repoRoot, groupId, item });
  /** The group registry, in the order the sidebar and the tab bar both use. */
  const groups = (byRoot: Record<string, string[]>) => (root: string) => byRoot[root] ?? [];
  const flat = (out: ReturnType<typeof orderAsTabs<string>>) => out.flatMap((c) => c.items);

  it('follows the given project order', () => {
    const out = orderAsTabs([at('a', '/late'), at('b', '/early')], groups({}), ['/early', '/late']);
    expect(out.map((c) => c.repoRoot)).toEqual(['/early', '/late']);
  });

  // The tab bar passes no project order and gets the order it met them in; the strip passes yours.
  // Same function, one parameter apart.
  it('falls back to the order projects first appear', () => {
    const out = orderAsTabs([at('a', '/second'), at('b', '/first')], groups({}));
    expect(out.map((c) => c.repoRoot)).toEqual(['/second', '/first']);
  });

  /**
   * The shape the tab bar draws: a project's ungrouped tabs first, then one run per group in REGISTRY order — not the order the tabs happen to sit in.
   * The strip flattens these back into one run per project, which is how it ends up matching the bar.
   */
  it('puts ungrouped items first, then each group in registry order', () => {
    const out = orderAsTabs(
      [at('in-g2', '/repo', 'g2'), at('loose-1', '/repo'), at('in-g1', '/repo', 'g1'), at('loose-2', '/repo')],
      groups({ '/repo': ['g1', 'g2'] }),
    );
    expect(out.map((c) => c.groupId)).toEqual(['', 'g1', 'g2']);
    expect(flat(out)).toEqual(['loose-1', 'loose-2', 'in-g1', 'in-g2']);
  });

  // Within a run, the caller's order is passed through untouched — no recency, no pins, no urgency.
  // Sorting by any of those is what made rows swap while they were being read.
  it('leaves a run in the order it was handed', () => {
    const out = orderAsTabs([at('c', '/repo'), at('a', '/repo'), at('b', '/repo')], groups({}));
    expect(flat(out)).toEqual(['c', 'a', 'b']);
  });

  // Moving a session into a group moves it in the bar, which is why the strip has to be built from this and not from the tabs array directly.
  it('moves an item when its group changes, without anything else moving', () => {
    const entries = [at('a', '/repo'), at('b', '/repo'), at('c', '/repo')];
    expect(flat(orderAsTabs(entries, groups({ '/repo': ['g1'] })))).toEqual(['a', 'b', 'c']);
    const regrouped = [at('a', '/repo'), at('b', '/repo', 'g1'), at('c', '/repo')];
    expect(flat(orderAsTabs(regrouped, groups({ '/repo': ['g1'] })))).toEqual(['a', 'c', 'b']);
  });

  // A group belonging to another project cannot be drawn under this one; the item is loose here rather than vanishing, which is what the sidebar's tree does too.
  it('treats a group this project does not own as no group at all', () => {
    const out = orderAsTabs([at('a', '/repo', 'group-of-elsewhere')], groups({ '/repo': ['g1'] }));
    expect(out).toEqual([{ repoRoot: '/repo', groupId: '', items: ['a'] }]);
  });

  it('keeps a project the order has never seen, rather than dropping it', () => {
    const out = orderAsTabs([at('a', '/unknown')], groups({}), ['/known']);
    expect(out.map((c) => c.repoRoot)).toEqual(['/unknown']);
  });

  it('omits a group with nothing open in it', () => {
    const out = orderAsTabs([at('a', '/repo')], groups({ '/repo': ['empty-group'] }));
    expect(out.map((c) => c.groupId)).toEqual(['']);
  });
});

describe('statusLabel', () => {
  it('names each status as a state', () => {
    expect(statusLabel('busy')).toBe('Busy');
    expect(statusLabel('idle')).toBe('Idle');
    expect(statusLabel('waiting')).toBe('Waiting for you');
    // Not "Stopped": the status arrives from SessionEnd, which fires whether the session was stopped, finished on its own, or had its tab closed — so naming the event would be wrong twice over.
    expect(statusLabel('closed')).toBe('Not running');
  });

  it('marks a read status without losing what it says', () => {
    expect(statusLabel('waiting', true)).toBe('Waiting for you (read)');
    expect(statusLabel('idle', false)).toBe('Idle');
  });

  it('says why a session needs you, by how the app closed while it ran', () => {
    expect(statusLabel('needs', false, [], { reason: 'quit', at: 1 })).toBe('Needs you — was running when the app quit');
    expect(statusLabel('needs', false, [], { reason: 'ended', at: 1 })).toBe('Needs you — was running when the app ended without quitting');
    expect(statusLabel('needs', false, [], { reason: 'unknown', at: 1 })).toBe('Needs you — was running when the app last closed');
    expect(statusLabel('needs', true, [], { reason: 'quit', at: 1 })).toBe('Needs you — was running when the app quit (read)');
  });

  it('says which day a reminder was for, from when it was marked', () => {
    expect(statusLabel('needs', false, [], { reason: 'reminder', at: new Date(2026, 10, 2, 9).getTime() })).toBe('Needs you — reminder for Mon 2 Nov, 09:00');
  });

  it('names a session on its way to a stop, and never as read, since its claude is leaving', () => {
    expect(statusLabel('stopping')).toBe('Stopping — waiting for claude to leave');
    expect(statusLabel('stopping', true)).toBe('Stopping — waiting for claude to leave');
  });

  it('says nothing at all for a session with no status', () => {
    // The hollow dot: no tooltip rather than an empty one, so closest() falls through to whatever it sits in.
    expect(statusLabel(undefined)).toBe(null);
    expect(statusLabel(undefined, true)).toBe(null);
    expect(statusLabel('')).toBe(null);
  });

  it('falls back to the raw value for a status it has never heard of', () => {
    // A new hook state should read oddly, not crash — but it SHOULD read oddly, which is the signal to name it here.
    expect(statusLabel('compacting')).toBe('compacting');
    expect(statusLabel('compacting', true)).toBe('compacting (read)');
  });

  // Counted per type, each type in the order claude listed it first.
  it('names the work still running behind a finished turn, counted by type', () => {
    expect(statusLabel('background', false, ['shell'])).toBe('Working in the background: 1 shell');
    expect(statusLabel('background', false, ['shell', 'subagent', 'shell'])).toBe('Working in the background: 2 shells, 1 subagent');
    expect(statusLabel('background', false, ['MCP task', 'MCP task'])).toBe('Working in the background: 2 MCP tasks');
  });

  // A status read back at launch, or work of a type the script could not read, says only what is known.
  it('says no more than that for background work it was told nothing about', () => {
    expect(statusLabel('background')).toBe('Working in the background');
    expect(statusLabel('background', false, [])).toBe('Working in the background');
  });

  it('names the work only for background', () => {
    expect(statusLabel('busy', false, ['shell'])).toBe('Busy');
  });
});

describe('sessionPart', () => {
  it('rolls a muted needs-you mark up as read, as its dot shows it, and claude working or asking over it as itself', () => {
    expect(sessionPart('idle', true, false, false)).toBe('needs');
    expect(sessionPart('idle', true, true, false)).toBeNull();
    expect(sessionPart(undefined, true, true, false)).toBeNull();
    expect(sessionPart('waiting', true, true, false)).toBe('waiting');
    expect(sessionPart('busy', true, true, false)).toBe('busy');
    expect(sessionPart('idle', false, false, false)).toBe('idle');
  });
});

describe('the days a later mark names', () => {
  // Local times, as the menu makes them: Thursday 29 October 2026, mid-afternoon.
  const thursday = new Date(2026, 9, 29, 15, 30).getTime();

  it('starts tomorrow at its midnight, across the end of a month too', () => {
    expect(dayStart(thursday, 1)).toBe(new Date(2026, 9, 30).getTime());
    expect(dayStart(new Date(2026, 9, 31, 23, 59).getTime(), 1)).toBe(new Date(2026, 10, 1).getTime());
  });

  it('comes due at the time of day given on the day chosen, a week on being the same weekday', () => {
    expect(onDayAt(dayStart(thursday, 1), '09:00')).toBe(new Date(2026, 9, 30, 9, 0).getTime());
    expect(onDayAt(dayStart(thursday, 7), '17:45')).toBe(new Date(2026, 10, 5, 17, 45).getTime());
    // A time that does not read leaves the day's start.
    expect(onDayAt(dayStart(thursday, 1), '9am')).toBe(new Date(2026, 9, 30).getTime());
  });

  it('names a day short, a moment by its day and time, and a mark by its moment or as whenever', () => {
    expect(dayLabel(new Date(2026, 10, 2).getTime())).toBe('Mon 2 Nov');
    expect(momentLabel(new Date(2026, 10, 2, 9, 5).getTime())).toBe('Mon 2 Nov, 09:05');
    expect(laterLabel({ due: new Date(2026, 10, 5, 9).getTime(), at: thursday })).toBe('Later: Thu 5 Nov, 09:00');
    expect(laterLabel({ due: null, at: thursday })).toBe('Later');
  });
});

describe('stripLine', () => {
  it('counts what runs, and of those what wants you', () => {
    expect(stripLine({ live: 3, needing: 0, among: 3 })).toBe('3 live');
    expect(stripLine({ live: 3, needing: 2, among: 3 })).toBe('2 of 3 need you');
  });

  // A tab marked as needing you is in hand whether or not it runs, as after a launch that marked what ran.
  it('counts a marked tab that does not run among those that want you', () => {
    expect(stripLine({ live: 0, needing: 3, among: 3 })).toBe('3 of 3 need you');
    expect(stripLine({ live: 1, needing: 2, among: 3 })).toBe('2 of 3 need you');
  });

  // Marked read, a cold marked row wants nothing more of the line, but is still listed, so the line still counts it.
  it('counts marked rows seen and not running apart, so the line is never empty while rows are listed', () => {
    expect(stripLine({ live: 0, needing: 0, among: 1 })).toBe('1 marked');
    expect(stripLine({ live: 1, needing: 0, among: 3 })).toBe('1 live · 2 marked');
  });
});

describe('scheduledLines', () => {
  const cron = { prompt: 'say the word tock', recurring: true, cron: 'Every 10 minutes' };
  const wakeup = { prompt: '/loop check the deploy', recurring: false, cron: null };

  it("names each task on a line of its own, a cron with its schedule in claude's words, each with what a stop does to it, and says nothing for none", () => {
    expect(scheduledLines([])).toBe(null);
    expect(scheduledLines([wakeup, cron])).toEqual(['Scheduled:', '/loop check the deploy · ends with the session', 'say the word tock · Every 10 minutes · comes back when you open the session']);
  });

  it('names what a tab kept from when its claude went under a heading of its own', () => {
    expect(scheduledLines([cron], 'Scheduled when stopped:')).toEqual(['Scheduled when stopped:', 'say the word tock · Every 10 minutes · comes back when you open the session']);
  });
});

describe('clockOf', () => {
  const tock = [{ prompt: 'say the word tock', recurring: true, cron: 'Every 10 minutes' }];
  const tick = [{ prompt: 'say tock again', recurring: false, cron: 'Runs once in 1h' }];

  it("shows what the session's claude last reported, over anything its tab kept", () => {
    expect(clockOf(tock, { scheduledWhenStopped: tick })).toEqual({ tasks: tock, stopped: false });
    expect(clockOf(tock, undefined)).toEqual({ tasks: tock, stopped: false });
  });

  it('shows what its tab kept from when its claude went, muted, while nothing is reported', () => {
    expect(clockOf(undefined, { scheduledWhenStopped: tick })).toEqual({ tasks: tick, stopped: true });
    expect(clockOf([], { scheduledWhenStopped: tick })).toEqual({ tasks: tick, stopped: true });
  });

  it('shows nothing for neither', () => {
    expect(clockOf(undefined, { scheduledWhenStopped: null })).toBe(null);
    expect(clockOf(undefined, undefined)).toBe(null);
  });
});

describe('clockText', () => {
  const tock = [{ prompt: 'say the word tock', recurring: true, cron: 'Every 10 minutes' }];

  it('says the tasks under the heading for live ones, or for the ones a stopped tab kept', () => {
    expect(clockText({ tasks: tock, stopped: false })).toBe('Scheduled:\nsay the word tock · Every 10 minutes · comes back when you open the session');
    expect(clockText({ tasks: tock, stopped: true })).toBe('Scheduled when stopped:\nsay the word tock · Every 10 minutes · comes back when you open the session');
    expect(clockLines({ tasks: tock, stopped: true })).toEqual(['Scheduled when stopped:', 'say the word tock · Every 10 minutes · comes back when you open the session']);
  });

  it('says nothing for no clock', () => {
    expect(clockText(null)).toBe(null);
    expect(clockLines(null)).toBe(null);
  });
});

describe('notLeftWords', () => {
  const LIVE = 3;

  it('says a stop has not left once it has gone on long enough', () => {
    expect(notLeftWords({ terminalId: LIVE, stopping: true, forceable: true, notLeft: true })).toBe("hasn't left");
  });

  it('says nothing before then, or for a tab not stopping', () => {
    expect(notLeftWords({ terminalId: LIVE, stopping: true, forceable: true })).toBe(null);
    expect(notLeftWords({ terminalId: LIVE, notLeft: true })).toBe(null);
    expect(notLeftWords({ terminalId: null })).toBe(null);
  });
});

describe('leaveLabel', () => {
  it("names each leave item, as the button's tooltip says it where it says only that", () => {
    expect(leaveLabel('stop')).toBe('Stop session');
    expect(leaveLabel('close')).toBe('Close tab');
    expect(leaveLabel('archive')).toBe('Archive');
    expect(tabButton({ terminalId: 7 }).tooltip).toBe(leaveLabel('stop'));
    expect(tabButton({ terminalId: null }).tooltip).toBe(leaveLabel('close'));
  });
});

// A running tab's process; any id will do.
const LIVE = 7;
const FORCE_WHY = ': claude has not left yet — it may be asking you something';

describe('leaveUnderWay', () => {
  it('names what a leaving tab leaves for, by what its exit does', () => {
    expect(leaveUnderWay({ terminalId: LIVE })).toBe(null);
    expect(leaveUnderWay({ terminalId: LIVE, stopping: true })).toBe('stop');
    expect(leaveUnderWay({ terminalId: LIVE, stopping: true, onExit: 'cool' })).toBe('stop');
    expect(leaveUnderWay({ terminalId: LIVE, stopping: true, onExit: 'close' })).toBe('close');
    expect(leaveUnderWay({ terminalId: LIVE, stopping: true, onExit: 'archive' })).toBe('archive');
  });
});

describe('leaveAction', () => {
  it('offers each of the three on a running tab, each its own press', () => {
    expect(leaveAction({ terminalId: LIVE }, 'stop')).toEqual({ disabled: false, tooltip: 'Stop session', mark: 'stop', label: 'Stop session', action: 'stop' });
    expect(leaveAction({ terminalId: LIVE }, 'close')).toEqual({ disabled: false, tooltip: 'Close tab', mark: 'close', label: 'Close tab', action: 'close' });
    expect(leaveAction({ terminalId: LIVE }, 'archive')).toEqual({ disabled: false, tooltip: 'Archive', mark: 'archive', label: 'Archive', action: 'archive' });
  });

  it('has nothing to stop on a cold tab, which closes and archives at once', () => {
    expect(leaveAction({ terminalId: null }, 'stop')).toEqual({ disabled: true, tooltip: 'Not running', mark: 'stop', label: 'Stop session', action: 'stop' });
    expect(leaveAction({ terminalId: null }, 'close').disabled).toBe(false);
    expect(leaveAction({ terminalId: null }, 'archive').disabled).toBe(false);
  });

  it('refuses every item while the tab starts, ARRIVING winning over a leave it also carries', () => {
    for (const action of ['stop', 'close', 'archive'] as const) {
      expect(leaveAction({ terminalId: null, starting: true }, action)).toMatchObject({ disabled: true, tooltip: 'Starting…', mark: action });
      expect(leaveAction({ terminalId: null, starting: true, stopping: true }, action)).toMatchObject({ disabled: true, tooltip: 'Starting…' });
    }
  });

  it("makes the item of what was asked its force, unavailable for its first moment and named for it", () => {
    expect(leaveAction({ terminalId: LIVE, stopping: true }, 'stop')).toEqual({ disabled: true, tooltip: 'Stopping…', mark: 'stop', label: 'Force stop', action: 'stop' });
    expect(leaveAction({ terminalId: LIVE, stopping: true, onExit: 'close' }, 'close')).toEqual({ disabled: true, tooltip: 'Closing…', mark: 'close', label: 'Force close', action: 'close' });
    expect(leaveAction({ terminalId: LIVE, stopping: true, onExit: 'archive' }, 'archive')).toEqual({ disabled: true, tooltip: 'Archiving…', mark: 'archive', label: 'Force archive', action: 'archive' });
  });

  it('offers the force once it may, saying claude may be asking', () => {
    expect(leaveAction({ terminalId: LIVE, stopping: true, forceable: true }, 'stop')).toEqual({ disabled: false, tooltip: `Force stop${FORCE_WHY}`, mark: 'force-stop', label: 'Force stop', action: 'stop' });
    expect(leaveAction({ terminalId: LIVE, stopping: true, forceable: true, onExit: 'close' }, 'close')).toEqual({ disabled: false, tooltip: `Force close${FORCE_WHY}`, mark: 'force-close', label: 'Force close', action: 'close' });
    expect(leaveAction({ terminalId: LIVE, stopping: true, forceable: true, onExit: 'archive' }, 'archive')).toEqual({ disabled: false, tooltip: `Force archive${FORCE_WHY}`, mark: 'force-archive', label: 'Force archive', action: 'archive' });
    // Only a leave on its way can become a force.
    expect(leaveAction({ terminalId: LIVE, forceable: true }, 'stop')).toMatchObject({ disabled: false, mark: 'stop', label: 'Stop session' });
  });

  it('lets every other item change what the exit does, a stop turning a close or an archive back', () => {
    expect(leaveAction({ terminalId: LIVE, stopping: true }, 'close')).toMatchObject({ disabled: false, mark: 'close', label: 'Close tab' });
    expect(leaveAction({ terminalId: LIVE, stopping: true }, 'archive')).toMatchObject({ disabled: false, mark: 'archive', label: 'Archive' });
    expect(leaveAction({ terminalId: LIVE, stopping: true, onExit: 'close' }, 'stop')).toMatchObject({ disabled: false, mark: 'stop', label: 'Stop session' });
    expect(leaveAction({ terminalId: LIVE, stopping: true, onExit: 'archive' }, 'close')).toMatchObject({ disabled: false, mark: 'close', label: 'Close tab' });
    // Forced, the exit can still be changed: claude is going whatever it is asked.
    expect(leaveAction({ terminalId: LIVE, stopping: true, onExit: 'close' }, 'archive').disabled).toBe(false);
  });
});

describe('tabButton', () => {
  it('stops a settled session', () => {
    expect(tabButton({ terminalId: LIVE })).toEqual({ disabled: false, tooltip: 'Stop session', mark: 'stop', label: 'Stop session', action: 'stop' });
    expect(tabButton({ terminalId: LIVE, starting: false, stopping: false })).toMatchObject({ disabled: false, mark: 'stop' });
  });

  it('refuses both ends of a session lifetime, and says which end it is', () => {
    expect(tabButton({ terminalId: null, starting: true })).toEqual({ disabled: true, tooltip: 'Starting…', mark: 'stop', label: 'Stop session', action: 'stop' });
    expect(tabButton({ terminalId: LIVE, stopping: true })).toEqual({ disabled: true, tooltip: 'Stopping…', mark: 'stop', label: 'Force stop', action: 'stop' });
  });

  it('reports ARRIVING when a tab somehow carries both flags', () => {
    // The precedence is load-bearing: a tab that is both is one being started, and calling it "Stopping…" would tell the user the opposite of what is happening.
    expect(tabButton({ terminalId: null, starting: true, stopping: true })).toMatchObject({ disabled: true, tooltip: 'Starting…', mark: 'stop' });
  });

  it('is the force of whatever claude is leaving for, so it stays the press that ends claude', () => {
    expect(tabButton({ terminalId: LIVE, stopping: true, forceable: true })).toMatchObject({ disabled: false, mark: 'force-stop', action: 'stop' });
    expect(tabButton({ terminalId: LIVE, stopping: true, onExit: 'close' })).toMatchObject({ disabled: true, tooltip: 'Closing…', mark: 'close', action: 'close' });
    expect(tabButton({ terminalId: LIVE, stopping: true, forceable: true, onExit: 'close' })).toMatchObject({ disabled: false, mark: 'force-close', label: 'Force close', action: 'close' });
    expect(tabButton({ terminalId: LIVE, stopping: true, forceable: true, onExit: 'archive' })).toMatchObject({ disabled: false, mark: 'force-archive', label: 'Force archive', action: 'archive' });
  });

  it("closes a cold tab, which has nothing to stop, or archives it when that is the stopped tab's button", () => {
    expect(tabButton({ terminalId: null })).toEqual({ disabled: false, tooltip: 'Close tab', mark: 'close', label: 'Close tab', action: 'close' });
    expect(tabButton({ terminalId: null }, 'archive')).toEqual({ disabled: false, tooltip: 'Archive', mark: 'archive', label: 'Archive', action: 'archive' });
    // A running tab stops whichever it is.
    expect(tabButton({ terminalId: LIVE }, 'archive')).toMatchObject({ mark: 'stop', action: 'stop' });
  });
});
