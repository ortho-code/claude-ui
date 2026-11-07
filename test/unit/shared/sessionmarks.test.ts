import { describe, it, expect } from 'vitest';

import { finishedFrom, cameDue, clearedSetAside, clearedNeedsYou, keptFrom, markedSetAside, markedNeedsYou, markedWithHistory, mutedBySetAside, purgedSession, restoredNeedsYou, settledNeedsYou, settledTypes, HISTORY_KEPT, togglePinned, clearedFinished, unkept, withoutSession, withPrLink, type SessionMarks } from '../../../src/shared/sessionmarks';

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

  it("replaces a PR's reasons with its newer change spelt with other capitals, as one PR", () => {
    const needsYou = { a: [{ type: 'pr.checks-failed' as const, at: 1, pr: 'acme/app#1' }] };
    expect(markedNeedsYou(needsYou, ['a'], [{ type: 'pr.merged', at: 3, pr: 'Acme/App#1' }])).toEqual({ a: [{ type: 'pr.merged', at: 3, pr: 'Acme/App#1' }] });
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

describe('the needs-you history', () => {
  const quit = { type: 'app.was-running' as const, at: 1, how: 'quit' as const };
  const merged = { type: 'pr.merged' as const, at: 2, pr: 'acme/app#1' };

  it('takes every reason of a session off at once, into its history in front, settled now by what settled it', () => {
    const marks = { needsYou: { a: [quit, merged], b: [quit] }, needsYouHistory: { a: [{ ...quit, at: 0, settled: 1, by: 'closed' as const }] } };
    expect(settledNeedsYou(marks, 'a', 'prompt', 9)).toEqual({
      needsYou: { b: [quit] },
      needsYouHistory: {
        a: [
          { ...quit, settled: 9, by: 'prompt' },
          { ...merged, settled: 9, by: 'prompt' },
          { ...quit, at: 0, settled: 1, by: 'closed' },
        ],
      },
    });
    expect(marks.needsYou.a).toEqual([quit, merged]);
    expect(settledNeedsYou(marks, 'none', 'cleared', 9)).toEqual(marks);
  });

  it('keeps the newest twenty of a session', () => {
    const many = Array.from({ length: HISTORY_KEPT }, (_, i) => ({ type: 'app.reminder' as const, at: i, settled: i, by: 'prompt' as const }));
    const { needsYouHistory } = settledNeedsYou({ needsYou: { a: [quit] }, needsYouHistory: { a: many } }, 'a', 'cleared', 99);
    expect(needsYouHistory.a).toHaveLength(HISTORY_KEPT);
    expect(needsYouHistory.a[0]).toEqual({ ...quit, settled: 99, by: 'cleared' });
    expect(needsYouHistory.a.at(-1)).toEqual(many.at(-2));
  });

  it("records what a new reason replaces as replaced, and nothing for a reason added beside the others", () => {
    const checks = { type: 'pr.checks-failed' as const, at: 1, pr: 'acme/app#1' };
    const approved = { type: 'pr.approved' as const, at: 1, pr: 'acme/app#1' };
    const marks = { needsYou: { a: [quit, checks, approved] }, needsYouHistory: {} };
    expect(markedWithHistory(marks, ['a', 'b'], [merged], 5)).toEqual({
      needsYou: { a: [quit, merged], b: [merged] },
      needsYouHistory: { a: [{ ...checks, settled: 5, by: 'replaced' }, { ...approved, settled: 5, by: 'replaced' }] },
    });
    expect(markedWithHistory(marks, ['a'], [{ type: 'app.reminder', at: 5 }], 5).needsYouHistory).toEqual({});
  });

  it('puts reasons back as Undo does, taking them back off the history and leaving its older entries', () => {
    const older = { ...quit, at: 0, settled: 1, by: 'closed' as const };
    const closed = settledNeedsYou({ needsYou: { a: [quit, merged] }, needsYouHistory: { a: [older] } }, 'a', 'closed', 9);
    expect(restoredNeedsYou(closed, 'a', [quit, merged])).toEqual({ needsYou: { a: [quit, merged] }, needsYouHistory: { a: [older] } });
    expect(restoredNeedsYou(settledNeedsYou({ needsYou: { a: [quit] }, needsYouHistory: {} }, 'a', 'finished', 9), 'a', [quit])).toEqual({ needsYou: { a: [quit] }, needsYouHistory: {} });
  });
});

describe('settledTypes', () => {
  it("takes a switched-off type's reasons off every session into its history as off, and leaves the rest", () => {
    const quit = { type: 'app.was-running' as const, at: 1, how: 'quit' as const };
    const approved = { type: 'pr.approved' as const, at: 2, pr: 'acme/app#1' };
    const merged = { type: 'pr.merged' as const, at: 2, pr: 'acme/app#1' };
    expect(settledTypes({ needsYou: { a: [quit, approved], b: [approved], c: [merged] }, needsYouHistory: {} }, ['pr.approved'], 9)).toEqual({
      needsYou: { a: [quit], c: [merged] },
      needsYouHistory: { a: [{ ...approved, settled: 9, by: 'off' }], b: [{ ...approved, settled: 9, by: 'off' }] },
    });
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

  it('with the reminder switched off, takes the marks whose day has come off and marks nothing', () => {
    const marks = { needsYou: {}, setAside: { a: { due: 100, at: 1 }, b: { due: 200, at: 1 } } };
    expect(cameDue(marks, 100, false)).toEqual({ needsYou: {}, setAside: { b: { due: 200, at: 1 } } });
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

const prA = { repository: 'acme/app', number: 1, url: 'https://github.com/acme/app/pull/1' };
const prB = { repository: 'acme/app', number: 2, url: 'https://github.com/acme/app/pull/2' };

describe('withPrLink', () => {
  it('adds the PR at a page after the session\'s others, once whatever its repository\'s capitals, and leaves the links it was given alone', () => {
    const links = { s: [prA] };
    expect(withPrLink(links, 's', `${prB.url}/files`)).toEqual({ s: [prA, prB] });
    expect(withPrLink(links, 's', 'https://github.com/Acme/App/pull/1')).toEqual({ s: [prA] });
    expect(withPrLink(links, 't', prB.url)).toEqual({ s: [prA], t: [prB] });
    expect(links).toEqual({ s: [prA] });
  });

  it('adds nothing for an address that is no GitHub pull request page, or no session', () => {
    expect(withPrLink({}, 's', 'https://github.com/acme/app/issues/2')).toEqual({});
    expect(withPrLink({}, '', prB.url)).toEqual({});
  });
});

describe('withoutSession', () => {
  it('forgets the session\'s pin, finished entry, note, needs-you mark and its history, set-aside mark, keep stamp and PR links, and keeps everyone else\'s', () => {
    const marks: SessionMarks = {
      pinned: ['a', 'b'],
      finished: { a: 1, b: 2 },
      notes: { a: 'x', b: 'y' },
      needsYou: { a: [{ type: 'app.was-running', at: 1, how: 'quit' }], b: [{ type: 'app.was-running', at: 2, how: 'ended' }] },
      needsYouHistory: { a: [{ type: 'app.reminder', at: 0, settled: 1, by: 'prompt' }], b: [{ type: 'app.reminder', at: 0, settled: 1, by: 'cleared' }] },
      setAside: { a: { due: null, at: 1 }, b: { due: 9, at: 2 } },
      kept: { a: 3, b: 4 },
      prLinks: { a: [prA], b: [prB] },
    };
    expect(withoutSession(marks, 'a')).toEqual({
      pinned: ['b'],
      finished: { b: 2 },
      notes: { b: 'y' },
      needsYou: { b: [{ type: 'app.was-running', at: 2, how: 'ended' }] },
      needsYouHistory: { b: [{ type: 'app.reminder', at: 0, settled: 1, by: 'cleared' }] },
      setAside: { b: { due: 9, at: 2 } },
      kept: { b: 4 },
      prLinks: { b: [prB] },
    });
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
      needsYouHistory: { a: [{ type: 'app.reminder' as const, at: 0, settled: 1, by: 'prompt' as const }] },
      setAside: { a: { due: null, at: 1 } },
      kept: { a: 2 },
      prLinks: { a: [prA] },
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
      needsYouHistory: {},
      setAside: {},
      kept: {},
      prLinks: {},
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
