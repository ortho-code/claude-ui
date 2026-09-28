import { describe, it, expect } from 'vitest';
import type { SessionSummary } from '../shared/types';
import {
  hasVisibleOutput,
  statusLabel,
  stopControlState,
  sessionsByKey,
  structuralSignature,
  groupByRepo,
  folderName,
  displayName,
  relativeTime,
  datePresetRange,
  sessionPasses,
  inView,
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
} from './logic';

function session(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'id',
    conversationId: 'conv',
    cwd: '/repo',
    repoRoot: '/repo',
    isRepo: false,
    worktree: '',
    title: 'Title',
    firstMessage: 'first',
    model: '',
    lastActivity: '2026-07-28T10:00:00.000Z',
    isSibling: false,
    siblingIds: [],
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
   * Every field a row is drawn from, one case each. The sidebar is only redrawn when this string moves, so a field missing here is a row that FREEZES — it keeps the old value until something unrelated changes.
   * `model` is the one that was actually missing: switching model mid-session left the old label on the row.
   */
  it.each([
    ['model', { model: 'claude-opus-4' }],
    ['worktree', { worktree: 'feature-x' }],
    ['repoRoot', { repoRoot: '/elsewhere' }],
    ['isRepo', { isRepo: true }],
    ['cwd', { cwd: '/elsewhere' }],
    ['firstMessage', { firstMessage: 'hello' }],
    ['isSibling', { isSibling: true }],
    ['siblingIds', { siblingIds: ['other'] }],
    ['id', { id: 'other' }],
    ['conversationId', { conversationId: 'other' }],
  ])('changes when %s changes', (_field, over) => {
    expect(structuralSignature([session()])).not.toBe(structuralSignature([session(over)]));
  });

  // The two that must NOT move it: one is rewritten on every message of a running session, the other is never drawn.
  it.each([
    ['lastActivity', { lastActivity: '2030-01-01T00:00:00Z' }],
    ['postCompactHeads', { postCompactHeads: ['head-1'] }],
  ])('ignores %s', (_field, over) => {
    expect(structuralSignature([session()])).toBe(structuralSignature([session(over)]));
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
    worktreeOnly: false,
    goneOnly: false,
    siblingOnly: false,
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

  it("matches a group name only on that group's own members", () => {
    const groupNames = new Map([['other', 'Terminal work']]);
    expect(sessionPasses(session({ id: 's1' }), { ...base, text: 'terminal', groupNames })).toBe(false);
  });

  // The set worth finding: what to clean up, or what to put a folder back for. It asks the row's own question rather than a second rule that could disagree with the dimming.
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
    expect(sessionPasses(session({ isSibling: false }), { ...base, siblingOnly: true })).toBe(false);
    expect(sessionPasses(session({ isSibling: true, siblingIds: ['p'] }), { ...base, siblingOnly: true })).toBe(true);
    expect(sessionPasses(session({ title: 'Fix the bug' }), { ...base, text: 'BUG' })).toBe(true);
    expect(sessionPasses(session({ title: 'Fix the bug' }), { ...base, text: 'perf' })).toBe(false);
    const activity = Date.parse('2026-07-28T10:00:00.000Z');
    expect(sessionPasses(session(), { ...base, dateFrom: activity + 1 })).toBe(false);
    expect(sessionPasses(session(), { ...base, dateFrom: activity - 1 })).toBe(true);
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
    );
    expect(model.all.count).toBe(3);
    expect(model.projects.map((f) => [f.name, f.count])).toEqual([
      ['alpha', 2],
      ['beta', 1],
    ]);
  });

  it('orders projects by recency (most-recent session first)', () => {
    const model = projectsForSwitcher([s('b1', '/x/beta'), s('a1', '/x/alpha')], new Map(), new Set());
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
    );
    const byName = new Map(model.projects.map((f) => [f.name, f.badge]));
    expect(byName.get('alpha')).toBe('waiting'); // waiting beats busy
    expect(byName.get('beta')).toBe('idle'); // idle beats busy
    expect(model.all.badge).toBe('waiting'); // strongest across everything
  });

  it('mutes acked sessions so the badge falls through to the next status', () => {
    const statuses = new Map([
      ['a1', 'waiting'],
      ['a2', 'idle'],
    ]);
    const model = projectsForSwitcher([s('a1', '/x/alpha'), s('a2', '/x/alpha')], statuses, new Set(['a1']));
    expect(model.projects[0].badge).toBe('idle'); // waiting is acked, so idle wins
  });

  it('badge is null when a folder has no live status (or all acked)', () => {
    const statuses = new Map([['a1', 'waiting']]);
    expect(projectsForSwitcher([s('a1', '/x/alpha')], new Map(), new Set())[
      'projects'
    ][0].badge).toBeNull();
    expect(
      projectsForSwitcher([s('a1', '/x/alpha')], statuses, new Set(['a1'])).projects[0].badge,
    ).toBeNull();
  });

  // The switcher marks a dead project the way its heading does, so the two are answered by the same rule.
  it('says which projects have lost their folder', () => {
    const model = projectsForSwitcher(
      [session({ id: 'a', repoRoot: '/x/alive' }), session({ id: 'g', repoRoot: '/x/gone', repoRootExists: false, cwdExists: false })],
      new Map(),
      new Set(),
    );
    expect(model.projects.map((f) => [f.name, f.rootExists])).toEqual([
      ['alive', true],
      ['gone', false],
    ]);
  });

  it('handles an empty session list', () => {
    const model = projectsForSwitcher([], new Map(), new Set());
    expect(model.projects).toEqual([]);
    expect(model.all).toEqual({ count: 0, badge: null });
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
    const out = groupJumpTargets(tree({ a: 'g2', b: 'g1' }), new Map(), none);
    expect(out.map((t) => [t.name, t.count])).toEqual([
      ['First', 1],
      ['Second', 1],
      ['Ungrouped', 1],
    ]);
    expect(out.at(-1)!.groupId).toBeNull();
  });

  it('omits the ungrouped entry when every session is in a group', () => {
    const out = groupJumpTargets(tree({ a: 'g1', b: 'g1', c: 'g2' }), new Map(), none);
    expect(out.map((t) => t.name)).toEqual(['First', 'Second']);
  });

  it('keeps an empty group, which still has a heading to jump to', () => {
    const out = groupJumpTargets(tree({ a: 'g1', b: 'g1', c: 'g1' }), new Map(), none);
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
    const out = groupJumpTargets(tree({ a: 'g1', b: 'g1' }), statuses, none);
    expect(out.map((t) => t.badge)).toEqual(['waiting', null, 'idle']);
  });

  it('ignores an acked session, so a muted group shows no dot', () => {
    const statuses = new Map([['a', 'waiting']]);
    const out = groupJumpTargets(tree({ a: 'g1' }), statuses, new Set(['a']));
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

  // The tab bar passes no project order and gets the order it met them in; the strip passes yours. Same function, one parameter apart.
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

  // Within a run, the caller's order is passed through untouched — no recency, no pins, no urgency. Sorting by any of those is what made rows swap while they were being read.
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
    // Not "Stopped": the status arrives from SessionEnd, which fires whether the session was stopped,
    // finished on its own, or had its tab closed — so naming the event would be wrong twice over.
    expect(statusLabel('closed')).toBe('Not running');
  });

  it('marks a read status without losing what it says', () => {
    expect(statusLabel('waiting', true)).toBe('Waiting for you (read)');
    expect(statusLabel('idle', false)).toBe('Idle');
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
});

describe('stopControlState', () => {
  it('offers to stop a settled session', () => {
    expect(stopControlState({})).toEqual({ disabled: false, tooltip: 'Stop session' });
    expect(stopControlState({ starting: false, stopping: false })).toEqual({ disabled: false, tooltip: 'Stop session' });
  });

  it('refuses both ends of a session lifetime, and says which end it is', () => {
    expect(stopControlState({ starting: true })).toEqual({ disabled: true, tooltip: 'Starting…' });
    expect(stopControlState({ stopping: true })).toEqual({ disabled: true, tooltip: 'Stopping…' });
  });

  it('reports ARRIVING when a tab somehow carries both flags', () => {
    // The precedence is load-bearing and was implicit until this test: a tab that is both is one being
    // started, and calling it "Stopping…" would tell the user the opposite of what is happening.
    expect(stopControlState({ starting: true, stopping: true })).toEqual({ disabled: true, tooltip: 'Starting…' });
  });
});
