import { describe, it, expect } from 'vitest';
import type { SessionSummary } from '../shared/types';
import {
  sessionsByKey,
  structuralSignature,
  groupByRepo,
  folderName,
  displayName,
  relativeTime,
  datePresetRange,
  sessionPasses,
  projectsForSwitcher,
  modelLabel,
  reorderWithinGroup,
  type FilterCriteria,
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
    eventCount: 1,
    isSibling: false,
    siblingIds: [],
    postCompactHeads: [],
    ...over,
  };
}

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
  it('is stable regardless of order and ignores activity/eventCount', () => {
    const a = session({ id: 'a', conversationId: 'ca' });
    const b = session({ id: 'b', conversationId: 'cb' });
    const sigActivityChanged = session({ id: 'a', conversationId: 'ca', lastActivity: 'x', eventCount: 99 });
    expect(structuralSignature([a, b])).toBe(structuralSignature([b, a]));
    expect(structuralSignature([a])).toBe(structuralSignature([sigActivityChanged]));
  });

  it('changes when a title changes', () => {
    const a = session();
    expect(structuralSignature([a])).not.toBe(structuralSignature([session({ title: 'Renamed' })]));
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

describe('sessionPasses', () => {
  const base: FilterCriteria = {
    text: '',
    pinnedOnly: false,
    worktreeOnly: false,
    siblingOnly: false,
    archivedOnly: false,
    dateFrom: null,
    dateTo: null,
    pinned: new Set(),
    archived: new Set(),
    pendingDeletes: new Set(),
  };

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
