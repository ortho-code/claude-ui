import { describe, it, expect } from 'vitest';

import { togglePinned, toggleArchived, withNote, withoutSession, type SessionMarks } from '../../../src/shared/sessionmarks';

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

describe('withNote', () => {
  it('trims a note, and a blank one removes the entry', () => {
    const notes = { a: 'one' };
    expect(withNote(notes, 'b', '  two  ')).toEqual({ a: 'one', b: 'two' });
    expect(withNote(notes, 'a', '   ')).toEqual({});
    expect(notes).toEqual({ a: 'one' });
  });
});

describe('withoutSession', () => {
  it('forgets the session\'s pin, archive entry and note, and keeps everyone else\'s', () => {
    const marks: SessionMarks = { pinned: ['a', 'b'], archived: { a: 1, b: 2 }, notes: { a: 'x', b: 'y' } };
    expect(withoutSession(marks, 'a')).toEqual({ pinned: ['b'], archived: { b: 2 }, notes: { b: 'y' } });
    expect(marks).toEqual({ pinned: ['a', 'b'], archived: { a: 1, b: 2 }, notes: { a: 'x', b: 'y' } });
  });
});
