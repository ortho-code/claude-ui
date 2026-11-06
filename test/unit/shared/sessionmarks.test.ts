import { describe, it, expect } from 'vitest';

import { finishedFrom, cameDue, clearedSetAside, clearedNeedsYou, keptFrom, markedSetAside, markedNeedsYou, mutedBySetAside, purgedSession, togglePinned, clearedFinished, unkept, withoutSession, type SessionMarks } from '../../../src/shared/sessionmarks';

// Main's own tests (test/unit/main/meta.test.ts) hold what meta.json ends up with; these hold what the window's checks rely on too: a new value every time, the given one untouched.

describe('togglePinned', () => {
  it('adds a pin at the end and removes it again, keeping the order of the rest', () => {
    const pinned = ['a', 'b'];
    expect(togglePinned(pinned, 'c')).toEqual(['a', 'b', 'c']);
    expect(togglePinned(['a', 'c', 'b'], 'c')).toEqual(['a', 'b']);
    expect(pinned).toEqual(['a', 'b']);
  });
});

describe('finishedFrom', () => {
  it('finishes from the time given, and leaves a session already finished from when it was', () => {
    const finished = { a: 1 };
    expect(finishedFrom(finished, 'b', 42)).toEqual({ a: 1, b: 42 });
    expect(finishedFrom(finished, 'a', 42)).toEqual({ a: 1 });
    expect(finishedFrom(finished, 'a', 42)).not.toBe(finished);
    expect(finished).toEqual({ a: 1 });
  });
});

describe('clearedFinished', () => {
  it('makes it unfinished, and leaves a session that is not finished as it is', () => {
    const finished = { a: 1 };
    expect(clearedFinished(finished, 'a')).toEqual({});
    expect(clearedFinished(finished, 'b')).toEqual({ a: 1 });
    expect(finished).toEqual({ a: 1 });
  });
});

describe('markedNeedsYou', () => {
  it('adds the reasons given to each session, beside the reasons it already has', () => {
    const needsYou = { a: [{ type: 'app.reminder' as const, at: 1 }] };
    expect(markedNeedsYou(needsYou, ['a', 'b'], [{ type: 'app.was-running', at: 42, how: 'quit' }])).toEqual({
      a: [
        { type: 'app.reminder', at: 1 },
        { type: 'app.was-running', at: 42, how: 'quit' },
      ],
      b: [{ type: 'app.was-running', at: 42, how: 'quit' }],
    });
    expect(needsYou).toEqual({ a: [{ type: 'app.reminder', at: 1 }] });
  });

  it('replaces a reason of the same kind: one launch reason, one reminder', () => {
    const needsYou = {
      a: [
        { type: 'app.was-running' as const, at: 1, how: 'ended' as const },
        { type: 'app.reminder' as const, at: 2 },
      ],
    };
    expect(markedNeedsYou(needsYou, ['a'], [{ type: 'app.was-running', at: 42, how: 'quit' }])).toEqual({
      a: [
        { type: 'app.reminder', at: 2 },
        { type: 'app.was-running', at: 42, how: 'quit' },
      ],
    });
    expect(markedNeedsYou(needsYou, ['a'], [{ type: 'app.reminder', at: 42 }])).toEqual({
      a: [
        { type: 'app.was-running', at: 1, how: 'ended' },
        { type: 'app.reminder', at: 42 },
      ],
    });
  });

  it("replaces every reason of a PR with that PR's newer change, of any type, and keeps another PR's", () => {
    const needsYou = {
      a: [
        { type: 'pr.checks-failed' as const, at: 1, pr: 'acme/app#1' },
        { type: 'pr.approved' as const, at: 1, pr: 'acme/app#1' },
        { type: 'pr.merged' as const, at: 2, pr: 'acme/app#2' },
      ],
    };
    expect(markedNeedsYou(needsYou, ['a'], [{ type: 'pr.merged', at: 3, pr: 'acme/app#1' }])).toEqual({
      a: [
        { type: 'pr.merged', at: 2, pr: 'acme/app#2' },
        { type: 'pr.merged', at: 3, pr: 'acme/app#1' },
      ],
    });
  });

  it("adds every change one answer found for a PR, a reason each, and replaces none of them with another", () => {
    expect(markedNeedsYou({}, ['a'], [{ type: 'pr.checks-failed', at: 3, pr: 'acme/app#1' }, { type: 'pr.approved', at: 3, pr: 'acme/app#1' }])).toEqual({
      a: [
        { type: 'pr.checks-failed', at: 3, pr: 'acme/app#1' },
        { type: 'pr.approved', at: 3, pr: 'acme/app#1' },
      ],
    });
  });

  it('changes nothing with no sessions or no reasons', () => {
    const needsYou = { a: [{ type: 'app.was-running' as const, at: 1, how: 'ended' as const }] };
    expect(markedNeedsYou(needsYou, [], [{ type: 'app.was-running', at: 42, how: 'quit' }])).toEqual(needsYou);
    expect(markedNeedsYou(needsYou, ['b'], [])).toEqual(needsYou);
  });
});

describe('clearedNeedsYou', () => {
  it('takes the mark off, and leaves a session that has none as it is', () => {
    const needsYou = {
      a: [
        { type: 'app.was-running' as const, at: 1, how: 'quit' as const },
        { type: 'app.reminder' as const, at: 2 },
      ],
    };
    expect(clearedNeedsYou(needsYou, 'a')).toEqual({});
    expect(clearedNeedsYou(needsYou, 'b')).toEqual(needsYou);
    expect(needsYou.a).toHaveLength(2);
  });
});

describe('markedSetAside', () => {
  it('marks the session from the time given, until its day or whenever, replacing a mark already there', () => {
    const setAside = { a: { due: 100, at: 1 } };
    expect(markedSetAside(setAside, 'a', null, 42)).toEqual({ a: { due: null, at: 42 } });
    expect(markedSetAside(setAside, 'b', 200, 42)).toEqual({ a: { due: 100, at: 1 }, b: { due: 200, at: 42 } });
    expect(setAside).toEqual({ a: { due: 100, at: 1 } });
  });
});

describe('clearedSetAside', () => {
  it('takes the mark off, and leaves a session that has none as it is', () => {
    const setAside = { a: { due: null, at: 1 } };
    expect(clearedSetAside(setAside, 'a')).toEqual({});
    expect(clearedSetAside(setAside, 'b')).toEqual(setAside);
    expect(setAside).toEqual({ a: { due: null, at: 1 } });
  });
});

describe('cameDue', () => {
  it('turns a mark whose day has come into needing you, with the reminder from its day, and leaves the rest', () => {
    const marks = { needsYou: {}, setAside: { a: { due: 100, at: 1 }, b: { due: 200, at: 1 }, c: { due: null, at: 1 } } };
    expect(cameDue(marks, 100)).toEqual({ needsYou: { a: [{ type: 'app.reminder', at: 100 }] }, setAside: { b: { due: 200, at: 1 }, c: { due: null, at: 1 } } });
    expect(marks.setAside).toEqual({ a: { due: 100, at: 1 }, b: { due: 200, at: 1 }, c: { due: null, at: 1 } });
  });

  it('keeps the reason a session already needed you for, so it still says why', () => {
    const marks = { needsYou: { a: [{ type: 'app.was-running' as const, at: 5, how: 'quit' as const }] }, setAside: { a: { due: 100, at: 10 } } };
    expect(cameDue(marks, 150)).toEqual({ needsYou: { a: [{ type: 'app.was-running', at: 5, how: 'quit' }] }, setAside: {} });
  });
});

describe('mutedBySetAside', () => {
  it('mutes a needs-you mark whose newest reason came before the set-aside mark, and not one with a reason after it', () => {
    expect(mutedBySetAside([{ type: 'app.was-running', at: 5, how: 'quit' }], { due: null, at: 10 })).toBe(true);
    expect(mutedBySetAside([{ type: 'app.was-running', at: 10, how: 'quit' }], { due: null, at: 10 })).toBe(true);
    expect(mutedBySetAside([{ type: 'app.was-running', at: 15, how: 'quit' }], { due: null, at: 10 })).toBe(false);
    expect(
      mutedBySetAside(
        [
          { type: 'app.reminder', at: 15 },
          { type: 'app.was-running', at: 5, how: 'quit' },
        ],
        { due: null, at: 10 },
      ),
    ).toBe(false);
    expect(mutedBySetAside([{ type: 'app.was-running', at: 5, how: 'quit' }], undefined)).toBe(false);
    expect(mutedBySetAside(undefined, { due: null, at: 10 })).toBe(false);
    expect(mutedBySetAside([], { due: null, at: 10 })).toBe(false);
  });
});

describe('keep stamps', () => {
  it('stamp sessions from a moment, a second Keep starting afresh, and are taken off, the rest left as they were', () => {
    const kept = keptFrom({ a: 1 }, ['a', 'b'], 5);
    expect(kept).toEqual({ a: 5, b: 5 });
    expect(unkept(kept, ['a', 'gone'])).toEqual({ b: 5 });
    expect(kept).toEqual({ a: 5, b: 5 });
  });
});

describe('withoutSession', () => {
  it('forgets the session\'s pin, finished entry, note, needs-you mark, set-aside mark and keep stamp, and keeps everyone else\'s', () => {
    const marks: SessionMarks = {
      pinned: ['a', 'b'],
      finished: { a: 1, b: 2 },
      notes: { a: 'x', b: 'y' },
      needsYou: { a: [{ type: 'app.was-running', at: 1, how: 'quit' }], b: [{ type: 'app.was-running', at: 2, how: 'ended' }] },
      setAside: { a: { due: null, at: 1 }, b: { due: 9, at: 2 } },
      kept: { a: 3, b: 4 },
    };
    expect(withoutSession(marks, 'a')).toEqual({ pinned: ['b'], finished: { b: 2 }, notes: { b: 'y' }, needsYou: { b: [{ type: 'app.was-running', at: 2, how: 'ended' }] }, setAside: { b: { due: 9, at: 2 } }, kept: { b: 4 } });
    expect(marks.needsYou).toEqual({ a: [{ type: 'app.was-running', at: 1, how: 'quit' }], b: [{ type: 'app.was-running', at: 2, how: 'ended' }] });
  });
});

describe('purgedSession', () => {
  it('forgets the session\'s marks, its open tab and its running one, what it had scheduled, its place as the tab on show and its group, and keeps everyone else\'s', () => {
    const tock = [{ prompt: 'say the word tock', recurring: true, cron: 'Every 10 minutes' }];
    const meta = {
      pinned: ['a', 'b'],
      finished: { a: 1 },
      notes: { a: 'x' },
      needsYou: { a: [{ type: 'app.was-running' as const, at: 1, how: 'quit' as const }] },
      setAside: { a: { due: null, at: 1 } },
      kept: { a: 2 },
      openSessions: ['a', 'b'],
      runningSessions: ['a', 'b'],
      scheduledWhenStopped: { a: tock, b: tock },
      activeSession: 'a',
      activeSessionByProject: { '/p': 'a', '/q': 'b' },
      groupOf: { a: 'g1', b: 'g1' },
    };
    expect(purgedSession(meta, 'a')).toEqual({
      pinned: ['b'],
      finished: {},
      notes: {},
      needsYou: {},
      setAside: {},
      kept: {},
      openSessions: ['b'],
      runningSessions: ['b'],
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
