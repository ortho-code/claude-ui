import { describe, it, expect } from 'vitest';
import { elsewhere, projectsForSwitcher } from '../../../../src/renderer/rules/switcher';
import { DEFAULT_RANKING } from '../../../../src/renderer/status/shown';
import { session } from '../fixtures';

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
