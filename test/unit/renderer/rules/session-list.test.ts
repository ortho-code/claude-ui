import { describe, it, expect } from 'vitest';
import {
  buildProjectTree,
  datePresetRange,
  elsewhere,
  groupByRepo,
  groupJumpTargets,
  inView,
  orderProjects,
  projectsForSwitcher,
  sessionPasses,
  type FilterCriteria,
} from '../../../../src/renderer/rules/session-list';
import { DEFAULT_RANKING } from '../../../../src/renderer/status/shown';
import { session, wasRunning } from '../fixtures';

describe('groupByRepo', () => {
  it('groups sessions by their repo root', () => {
    const projects = groupByRepo([session({ repoRoot: '/x' }), session({ repoRoot: '/y' }), session({ repoRoot: '/x' })]);
    const map = new Map(projects);
    expect(map.get('/x')?.length).toBe(2);
    expect(map.get('/y')?.length).toBe(1);
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

  it('rolls up the strongest nudge per folder: waiting > ready > busy', () => {
    const statuses = new Map([
      ['a1', 'busy'],
      ['a2', 'waiting'],
      ['b1', 'busy'],
      ['b2', 'ready'],
    ]);
    const model = projectsForSwitcher(
      [s('a1', '/x/alpha'), s('a2', '/x/alpha'), s('b1', '/x/beta'), s('b2', '/x/beta')],
      statuses,
      new Set(),
      new Map(),
    );
    const byName = new Map(model.projects.map((f) => [f.name, f.badge]));
    expect(byName.get('alpha')).toBe('waiting'); // waiting beats busy
    expect(byName.get('beta')).toBe('ready'); // ready beats busy
    expect(model.all.badge).toBe('waiting'); // strongest across everything
  });

  // A session marked as needing you counts where claude says nothing more pressing: over ready, under waiting, and not while claude works.
  it('rolls up a needs-you mark between waiting and ready, and not over busy', () => {
    const mark = [{ type: 'app.was-running' as const, at: 1, how: 'quit' as const }];
    const statuses = new Map([
      ['a2', 'ready'],
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
    expect(byName.get('alpha')).toBe('needs:app.was-running');
    expect(byName.get('beta')).toBe('waiting');
    expect(byName.get('gamma')).toBe('busy');
    // Read, it falls through as any other.
    expect(projectsForSwitcher([s('a1', '/x/alpha'), s('a2', '/x/alpha')], statuses, new Set(['a1']), needsYou).projects[0].badge).toBe('ready');
  });

  it('mutes acked sessions so the badge falls through to the next status', () => {
    const statuses = new Map([
      ['a1', 'waiting'],
      ['a2', 'ready'],
    ]);
    const model = projectsForSwitcher([s('a1', '/x/alpha'), s('a2', '/x/alpha')], statuses, new Set(['a1']), new Map());
    expect(model.projects[0].badge).toBe('ready'); // waiting is acked, so ready wins
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
    expect(model.all).toEqual({ count: 0, asking: 0, working: 0, badge: null });
  });

  it('counts per project and in all the sessions that ask for you and those at work, by what each one\'s dot shows', () => {
    const mark = [{ type: 'pr.merged' as const, at: 1, pr: 'o/r#1' }];
    const statuses = new Map([
      ['waiting', 'waiting'],
      ['ready', 'ready'],
      ['read', 'waiting'],
      ['busy-marked', 'busy'],
      ['background', 'background'],
    ]);
    const model = projectsForSwitcher(
      [s('waiting', '/x/alpha'), s('ready', '/x/alpha'), s('marked', '/x/alpha'), s('read', '/x/beta'), s('busy-marked', '/x/beta'), s('background', '/x/beta')],
      statuses,
      new Set(['read']),
      new Map([
        ['marked', mark],
        ['busy-marked', mark],
      ]),
    );
    expect(model.projects.map((p) => [p.name, p.asking, p.working])).toEqual([
      ['alpha', 3, 0],
      ['beta', 0, 2],
    ]);
    expect([model.all.asking, model.all.working]).toEqual([3, 2]);
  });

  // The list keeps the same project (buildProjectTree), so the two agree on which projects there are and where each sits.
  it('lists a project whose sessions are all finished at none, in its place, its folder answered by those sessions', () => {
    const finished = new Map([['/x/gone', [session({ id: 'g', repoRoot: '/x/gone', repoRootExists: false, cwdExists: false })]]]);
    const model = projectsForSwitcher([s('a1', '/x/alpha')], new Map([['g', 'waiting']]), new Set(), new Map(), undefined, ['/x/gone', '/x/alpha'], finished);
    expect(model.projects.map((f) => [f.name, f.count, f.badge, f.rootExists])).toEqual([
      ['gone', 0, null, false],
      ['alpha', 1, null, true],
    ]);
    expect(model.all.count).toBe(1);
  });
});

describe('elsewhere', () => {
  const s = (id: string, repoRoot: string) => session({ id, conversationId: id, repoRoot });
  const model = projectsForSwitcher(
    [s('a', '/x/alpha'), s('b', '/x/beta'), s('c', '/x/gamma'), s('d', '/x/gamma')],
    new Map([
      ['a', 'waiting'],
      ['b', 'ready'],
      ['c', 'busy'],
      ['d', 'ready'],
    ]),
    new Set(),
    new Map(),
  );

  it('adds up every project but the one on show, the strongest of them its badge', () => {
    expect(elsewhere(model, '/x/alpha', DEFAULT_RANKING)).toEqual({ asking: 2, working: 1, badge: 'ready' });
    expect(elsewhere(model, '/x/gamma', DEFAULT_RANKING)).toEqual({ asking: 2, working: 0, badge: 'waiting' });
  });

  it('is every project in All', () => {
    expect(elsewhere(model, null, DEFAULT_RANKING)).toEqual({ count: 4, asking: 3, working: 1, badge: 'waiting' });
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

  it('keeps a project whose sessions are all finished in its place, with no rows, its groups, and how many it has finished', () => {
    const finished = [session({ id: 'x', conversationId: 'x', repoRoot: '/kept', isRepo: true }), session({ id: 'y', conversationId: 'y', repoRoot: '/kept', isRepo: true })];
    const state = { groups: [group('g1', 'Kept group', '/kept')], groupOf: { x: 'g1' } };
    const tree = buildProjectTree([s('a', '/alpha')], state, none, false, ['/kept', '/alpha'], new Map([['/kept', finished]]));
    expect(tree.map((p) => [p.repoRoot, p.count, p.finished, p.isRepo, p.rootExists])).toEqual([
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
      ['c', 'ready'],
    ]);
    const out = groupJumpTargets(tree({ a: 'g1', b: 'g1' }), statuses, none, new Map());
    expect(out.map((t) => t.badge)).toEqual(['waiting', null, 'ready']);
  });

  it('rolls up a needs-you mark over ready', () => {
    const out = groupJumpTargets(tree({ a: 'g1' }), new Map([['c', 'ready']]), none, new Map([['c', [wasRunning]]]));
    expect(out.map((t) => t.badge)).toEqual([null, null, 'needs:app.was-running']);
  });

  it('ignores an acked session, so a muted group shows no dot', () => {
    const statuses = new Map([['a', 'waiting']]);
    const out = groupJumpTargets(tree({ a: 'g1' }), statuses, new Set(['a']), new Map());
    expect(out[0].badge).toBeNull();
  });
});
