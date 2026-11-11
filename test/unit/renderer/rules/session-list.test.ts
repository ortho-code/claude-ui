import { describe, it, expect } from 'vitest';
import { buildProjectTree, groupByRepo, groupJumpTargets, orderProjects } from '../../../../src/renderer/rules/session-list';
import { session, wasRunning } from '../fixtures';

describe('groupByRepo', () => {
  it('groups sessions by their repo root', () => {
    const projects = groupByRepo([session({ repoRoot: '/x' }), session({ repoRoot: '/y' }), session({ repoRoot: '/x' })]);
    const map = new Map(projects);
    expect(map.get('/x')?.length).toBe(2);
    expect(map.get('/y')?.length).toBe(1);
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
