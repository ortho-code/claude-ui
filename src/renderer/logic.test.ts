import { describe, it, expect } from 'vitest';
import type { SessionSummary } from '../shared/types';
import {
  tipsByConversation,
  structuralSignature,
  groupByRepo,
  groupName,
  relativeTime,
  datePresetRange,
  sessionPasses,
  type FilterCriteria,
} from './logic';

function session(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'id',
    conversationId: 'conv',
    cwd: '/repo',
    repoRoot: '/repo',
    worktree: '',
    title: 'Title',
    firstMessage: 'first',
    lastActivity: '2026-07-28T10:00:00.000Z',
    eventCount: 1,
    ...over,
  };
}

describe('tipsByConversation', () => {
  it('keeps the latest branch per conversation', () => {
    const older = session({ id: 'a', conversationId: 'c', lastActivity: '2026-07-01T00:00:00.000Z' });
    const newer = session({ id: 'b', conversationId: 'c', lastActivity: '2026-07-28T00:00:00.000Z' });
    const tips = tipsByConversation([older, newer]);
    expect(tips.size).toBe(1);
    expect(tips.get('c')?.id).toBe('b');
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

describe('groupByRepo / groupName', () => {
  it('groups sessions by their repo root', () => {
    const groups = groupByRepo([session({ repoRoot: '/x' }), session({ repoRoot: '/y' }), session({ repoRoot: '/x' })]);
    const map = new Map(groups);
    expect(map.get('/x')?.length).toBe(2);
    expect(map.get('/y')?.length).toBe(1);
  });

  it('names a group by the last path segment', () => {
    expect(groupName('/home/jille/development/scienta')).toBe('scienta');
    expect(groupName('scienta')).toBe('scienta');
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
    archivedOnly: false,
    dateFrom: null,
    dateTo: null,
    pinned: new Set(),
    archived: new Set(),
    pendingDeletes: new Set(),
  };

  it('hides pending deletes and archived (unless in the archived view)', () => {
    expect(sessionPasses(session({ conversationId: 'c' }), { ...base, pendingDeletes: new Set(['c']) })).toBe(false);
    expect(sessionPasses(session({ conversationId: 'c' }), { ...base, archived: new Set(['c']) })).toBe(false);
    expect(
      sessionPasses(session({ conversationId: 'c' }), { ...base, archivedOnly: true, archived: new Set(['c']) }),
    ).toBe(true);
  });

  it('applies pinned-only, worktree-only, text and date filters', () => {
    expect(sessionPasses(session({ conversationId: 'c' }), { ...base, pinnedOnly: true })).toBe(false);
    expect(sessionPasses(session({ conversationId: 'c' }), { ...base, pinnedOnly: true, pinned: new Set(['c']) })).toBe(true);
    expect(sessionPasses(session({ worktree: '' }), { ...base, worktreeOnly: true })).toBe(false);
    expect(sessionPasses(session({ worktree: 'wt' }), { ...base, worktreeOnly: true })).toBe(true);
    expect(sessionPasses(session({ title: 'Fix the bug' }), { ...base, text: 'BUG' })).toBe(true);
    expect(sessionPasses(session({ title: 'Fix the bug' }), { ...base, text: 'perf' })).toBe(false);
    const activity = Date.parse('2026-07-28T10:00:00.000Z');
    expect(sessionPasses(session(), { ...base, dateFrom: activity + 1 })).toBe(false);
    expect(sessionPasses(session(), { ...base, dateFrom: activity - 1 })).toBe(true);
  });
});
