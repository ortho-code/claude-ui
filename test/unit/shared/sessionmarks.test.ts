import { describe, it, expect } from 'vitest';

import { purgedSession, togglePinned, toggleArchived, withoutSession, type SessionMarks } from '../../../src/shared/sessionmarks';

// Main's own tests (test/unit/main/meta.test.ts) hold what meta.json ends up with; these hold what the window's checks rely on too: a new value every time, the given one untouched.

describe('togglePinned', () => {
  it('adds a pin at the end and removes it again, keeping the order of the rest', () => {
    const pinned = ['a', 'b'];
    expect(togglePinned(pinned, 'c')).toEqual(['a', 'b', 'c']);
    expect(togglePinned(['a', 'c', 'b'], 'c')).toEqual(['a', 'b']);
    expect(pinned).toEqual(['a', 'b']);
  });
});

describe('toggleArchived', () => {
  it('archives from the time given and unarchives', () => {
    const archived = { a: 1 };
    expect(toggleArchived(archived, 'b', 42)).toEqual({ a: 1, b: 42 });
    expect(toggleArchived(archived, 'a', 42)).toEqual({});
    expect(archived).toEqual({ a: 1 });
  });
});

describe('withoutSession', () => {
  it('forgets the session\'s pin, archive entry and note, and keeps everyone else\'s', () => {
    const marks: SessionMarks = { pinned: ['a', 'b'], archived: { a: 1, b: 2 }, notes: { a: 'x', b: 'y' } };
    expect(withoutSession(marks, 'a')).toEqual({ pinned: ['b'], archived: { b: 2 }, notes: { b: 'y' } });
    expect(marks).toEqual({ pinned: ['a', 'b'], archived: { a: 1, b: 2 }, notes: { a: 'x', b: 'y' } });
  });
});

describe('purgedSession', () => {
  it('forgets the session\'s marks, its open tab, its place as the tab on show and its group, and keeps everyone else\'s', () => {
    const meta = {
      pinned: ['a', 'b'],
      archived: { a: 1 },
      notes: { a: 'x' },
      openSessions: ['a', 'b'],
      activeSession: 'a',
      activeSessionByProject: { '/p': 'a', '/q': 'b' },
      groupOf: { a: 'g1', b: 'g1' },
    };
    expect(purgedSession(meta, 'a')).toEqual({ pinned: ['b'], archived: {}, notes: {}, openSessions: ['b'], activeSession: null, activeSessionByProject: { '/q': 'b' }, groupOf: { b: 'g1' } });
    // Another session on show stays on show.
    expect(purgedSession(meta, 'b').activeSession).toBe('a');
    expect(meta.groupOf).toEqual({ a: 'g1', b: 'g1' });
  });
});
