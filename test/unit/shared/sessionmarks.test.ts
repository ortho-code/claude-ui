import { describe, it, expect } from 'vitest';

import { archivedFrom, cameDue, clearedLater, clearedNeedsYou, markedLater, markedNeedsYou, mutedByLater, purgedSession, togglePinned, unarchived, withoutSession, type SessionMarks } from '../../../src/shared/sessionmarks';

// Main's own tests (test/unit/main/meta.test.ts) hold what meta.json ends up with; these hold what the window's checks rely on too: a new value every time, the given one untouched.

describe('togglePinned', () => {
  it('adds a pin at the end and removes it again, keeping the order of the rest', () => {
    const pinned = ['a', 'b'];
    expect(togglePinned(pinned, 'c')).toEqual(['a', 'b', 'c']);
    expect(togglePinned(['a', 'c', 'b'], 'c')).toEqual(['a', 'b']);
    expect(pinned).toEqual(['a', 'b']);
  });
});

describe('archivedFrom', () => {
  it('archives from the time given, and leaves a session already archived from when it was', () => {
    const archived = { a: 1 };
    expect(archivedFrom(archived, 'b', 42)).toEqual({ a: 1, b: 42 });
    expect(archivedFrom(archived, 'a', 42)).toEqual({ a: 1 });
    expect(archivedFrom(archived, 'a', 42)).not.toBe(archived);
    expect(archived).toEqual({ a: 1 });
  });
});

describe('unarchived', () => {
  it('unarchives, and leaves a session that is not archived as it is', () => {
    const archived = { a: 1 };
    expect(unarchived(archived, 'a')).toEqual({});
    expect(unarchived(archived, 'b')).toEqual({ a: 1 });
    expect(archived).toEqual({ a: 1 });
  });
});

describe('markedNeedsYou', () => {
  it('marks each session for the reason given, from the time given, a session already marked taking the newer reason', () => {
    const needsYou = { a: { reason: 'ended' as const, at: 1 } };
    expect(markedNeedsYou(needsYou, ['a', 'b'], 'quit', 42)).toEqual({ a: { reason: 'quit', at: 42 }, b: { reason: 'quit', at: 42 } });
    expect(markedNeedsYou(needsYou, [], 'quit', 42)).toEqual(needsYou);
    expect(needsYou).toEqual({ a: { reason: 'ended', at: 1 } });
  });
});

describe('clearedNeedsYou', () => {
  it('takes the mark off, and leaves a session that has none as it is', () => {
    const needsYou = { a: { reason: 'quit' as const, at: 1 } };
    expect(clearedNeedsYou(needsYou, 'a')).toEqual({});
    expect(clearedNeedsYou(needsYou, 'b')).toEqual(needsYou);
    expect(needsYou).toEqual({ a: { reason: 'quit', at: 1 } });
  });
});

describe('markedLater', () => {
  it('marks the session from the time given, until its day or whenever, replacing a mark already there', () => {
    const later = { a: { due: 100, at: 1 } };
    expect(markedLater(later, 'a', null, 42)).toEqual({ a: { due: null, at: 42 } });
    expect(markedLater(later, 'b', 200, 42)).toEqual({ a: { due: 100, at: 1 }, b: { due: 200, at: 42 } });
    expect(later).toEqual({ a: { due: 100, at: 1 } });
  });
});

describe('clearedLater', () => {
  it('takes the mark off, and leaves a session that has none as it is', () => {
    const later = { a: { due: null, at: 1 } };
    expect(clearedLater(later, 'a')).toEqual({});
    expect(clearedLater(later, 'b')).toEqual(later);
    expect(later).toEqual({ a: { due: null, at: 1 } });
  });
});

describe('cameDue', () => {
  it('turns a mark whose day has come into needing you, with the reminder from its day, and leaves the rest', () => {
    const marks = { needsYou: {}, later: { a: { due: 100, at: 1 }, b: { due: 200, at: 1 }, c: { due: null, at: 1 } } };
    expect(cameDue(marks, 100)).toEqual({ needsYou: { a: { reason: 'reminder', at: 100 } }, later: { b: { due: 200, at: 1 }, c: { due: null, at: 1 } } });
    expect(marks.later).toEqual({ a: { due: 100, at: 1 }, b: { due: 200, at: 1 }, c: { due: null, at: 1 } });
  });

  it('keeps the reason a session already needed you for, so it still says why', () => {
    const marks = { needsYou: { a: { reason: 'quit' as const, at: 5 } }, later: { a: { due: 100, at: 10 } } };
    expect(cameDue(marks, 150)).toEqual({ needsYou: { a: { reason: 'quit', at: 5 } }, later: {} });
  });
});

describe('mutedByLater', () => {
  it('mutes a needs-you mark set before the later mark, and not one that came after it', () => {
    expect(mutedByLater({ reason: 'quit', at: 5 }, { due: null, at: 10 })).toBe(true);
    expect(mutedByLater({ reason: 'quit', at: 10 }, { due: null, at: 10 })).toBe(true);
    expect(mutedByLater({ reason: 'quit', at: 15 }, { due: null, at: 10 })).toBe(false);
    expect(mutedByLater({ reason: 'quit', at: 5 }, undefined)).toBe(false);
    expect(mutedByLater(undefined, { due: null, at: 10 })).toBe(false);
  });
});

describe('withoutSession', () => {
  it('forgets the session\'s pin, archive entry, note, needs-you mark and later mark, and keeps everyone else\'s', () => {
    const marks: SessionMarks = {
      pinned: ['a', 'b'],
      archived: { a: 1, b: 2 },
      notes: { a: 'x', b: 'y' },
      needsYou: { a: { reason: 'quit', at: 1 }, b: { reason: 'ended', at: 2 } },
      later: { a: { due: null, at: 1 }, b: { due: 9, at: 2 } },
    };
    expect(withoutSession(marks, 'a')).toEqual({ pinned: ['b'], archived: { b: 2 }, notes: { b: 'y' }, needsYou: { b: { reason: 'ended', at: 2 } }, later: { b: { due: 9, at: 2 } } });
    expect(marks.needsYou).toEqual({ a: { reason: 'quit', at: 1 }, b: { reason: 'ended', at: 2 } });
  });
});

describe('purgedSession', () => {
  it('forgets the session\'s marks, its open tab, its running one and its paused one, what it had scheduled, its place as the tab on show and its group, and keeps everyone else\'s', () => {
    const tock = [{ prompt: 'say the word tock', recurring: true, cron: 'Every 10 minutes' }];
    const meta = {
      pinned: ['a', 'b'],
      archived: { a: 1 },
      notes: { a: 'x' },
      needsYou: { a: { reason: 'quit' as const, at: 1 } },
      later: { a: { due: null, at: 1 } },
      openSessions: ['a', 'b'],
      runningSessions: ['a', 'b'],
      pausedSessions: ['a', 'b'],
      scheduledWhenStopped: { a: tock, b: tock },
      activeSession: 'a',
      activeSessionByProject: { '/p': 'a', '/q': 'b' },
      groupOf: { a: 'g1', b: 'g1' },
    };
    expect(purgedSession(meta, 'a')).toEqual({
      pinned: ['b'],
      archived: {},
      notes: {},
      needsYou: {},
      later: {},
      openSessions: ['b'],
      runningSessions: ['b'],
      pausedSessions: ['b'],
      scheduledWhenStopped: { b: tock },
      activeSession: null,
      activeSessionByProject: { '/q': 'b' },
      groupOf: { b: 'g1' },
    });
    // Another session on show stays on show.
    expect(purgedSession(meta, 'b').activeSession).toBe('a');
    expect(meta.groupOf).toEqual({ a: 'g1', b: 'g1' });
  });
});
