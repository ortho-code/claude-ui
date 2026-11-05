import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '../../../src/shared/types';
import { isReadyToFinish, keptWithin, readyNote, REVIEW, reviewCount, reviewSections, untouchedFor, type ReviewFacts } from '../../../src/renderer/review';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-04T12:00:00.000Z');
const ago = (days: number): string => new Date(NOW - days * DAY).toISOString();

function session(id: string, days: number, prs: number[] = []): SessionSummary {
  return {
    id, conversationId: id, cwd: '/p', repoRoot: '/p', isRepo: true, worktree: '', leftWorktree: '', movedOutOfWorktree: false, workCwd: '', checkouts: [],
    title: id, firstMessage: '', model: '', lastActivity: ago(days), isSibling: false, siblingIds: [], postCompactHeads: [], cwdExists: true, repoRootExists: true,
    prs: prs.map((number) => ({ repository: 'acme/app', number, url: `https://github.com/acme/app/pull/${number}` })),
  };
}

function facts(overrides: Partial<ReviewFacts> = {}): ReviewFacts {
  return {
    tabbed: new Set(), archived: new Set(), pendingDeletes: new Set(), setAside: new Map(), kept: new Map(), notes: new Map(),
    prStatus: { statuses: { 'acme/app#1': { state: 'merged' }, 'acme/app#2': { state: 'closed' }, 'acme/app#3': { state: 'open', draft: false, review: null, checks: null, conflict: false } }, problem: null },
    prStatusOn: true,
    ...overrides,
  };
}

const ids = (sections: ReturnType<typeof reviewSections>): string[][] => sections.map((section) => section.rows.map((row) => row.session.id));

describe('the terms', () => {
  it('untouched: more than the days given since last active, at either side of the bound', () => {
    expect(untouchedFor(session('a', 31), 30, NOW)).toBe(true);
    expect(untouchedFor(session('a', 29), 30, NOW)).toBe(false);
  });

  it('kept: less than the days given since kept, at either side of the bound', () => {
    expect(keptWithin(session('a', 40), facts({ kept: new Map([['a', NOW - 29 * DAY]]) }), 30, NOW)).toBe(true);
    expect(keptWithin(session('a', 40), facts({ kept: new Map([['a', NOW - 31 * DAY]]) }), 30, NOW)).toBe(false);
    expect(keptWithin(session('a', 40), facts(), 30, NOW)).toBe(false);
  });

  it('ready to finish: at least one PR, every one merged or closed, none unknown, and nothing known after a failed ask or with PR status off', () => {
    expect(isReadyToFinish(session('a', 1, [1, 2]), facts())).toBe(true);
    expect(isReadyToFinish(session('a', 1), facts())).toBe(false);
    expect(isReadyToFinish(session('a', 1, [1, 3]), facts())).toBe(false);
    expect(isReadyToFinish(session('a', 1, [1, 9]), facts())).toBe(false);
    expect(isReadyToFinish(session('a', 1, [1]), facts({ prStatus: { statuses: facts().prStatus.statuses, problem: 'gh is missing' } }))).toBe(false);
    expect(isReadyToFinish(session('a', 1, [1]), facts({ prStatus: { statuses: {}, problem: null }, prStatusOn: false }))).toBe(false);
  });

  it('the definition holds both numbers of days, 30, in its terms', () => {
    expect(REVIEW.shared).toBe('is:unfinished -is:set-aside -kept:<30d');
    expect(REVIEW.sets.map((set) => set.query)).toEqual(['is:ready-to-finish', 'untouched:>30d']);
  });
});

describe('the sets', () => {
  const ready = session('ready', 2, [1]);
  const old = session('old', 40);
  const both = session('both', 50, [1, 2]);
  const fresh = session('fresh', 3);

  it('hold the ready and the untouched, oldest first, one in both shown once under Ready to finish', () => {
    const sections = reviewSections([fresh, ready, old, both], facts(), NOW);
    expect(sections.map((section) => section.name)).toEqual(['Ready to finish', 'Untouched 30+ days']);
    expect(ids(sections)).toEqual([['both', 'ready'], ['old']]);
    expect(reviewCount(sections)).toBe(3);
  });

  it('leave out a session with a tab, archived, set aside, or kept within its days, from both sets', () => {
    const sections = reviewSections([ready, old], facts({ tabbed: new Set(['ready']), setAside: new Map([['old', { due: null, at: 1 }]]) }), NOW);
    expect(ids(sections)).toEqual([[], []]);
    expect(ids(reviewSections([ready, old], facts({ kept: new Map([['ready', NOW - DAY], ['old', NOW - DAY]]) }), NOW))).toEqual([[], []]);
    expect(ids(reviewSections([ready, old], facts({ archived: new Set(['ready', 'old']) }), NOW))).toEqual([[], []]);
    // A stamp past its days holds nothing out.
    expect(ids(reviewSections([old], facts({ kept: new Map([['old', NOW - 31 * DAY]]) }), NOW))).toEqual([[], ['old']]);
  });

  it('say why each row is there', () => {
    const sections = reviewSections([session('one', 2, [1]), session('two', 3, [1, 2]), session('closed', 4, [2]), session('noted', 41)], facts({ notes: new Map([['noted', 'blocked on design\nmore']]) }), NOW);
    expect(sections[0]?.rows.map((row) => row.why)).toEqual(['Its PR closed · 4 d ago', 'Its 2 PRs merged or closed · 3 d ago', 'Its PR merged · 2 d ago']);
    expect(sections[1]?.rows.map((row) => row.why)).toEqual(['41 days · note: “blocked on design”']);
  });
});

describe("Ready to finish's line", () => {
  const offered = [session('a', 40, [1])];
  it('says why it cannot answer: PR status off, a failed ask, or no answer yet; and nothing while it can, or while nothing links a PR', () => {
    expect(readyNote(offered, facts({ prStatusOn: false, prStatus: { statuses: {}, problem: null } }))).toBe("PR status is off in Settings, so which sessions' PRs are settled is not known.");
    expect(readyNote(offered, facts({ prStatus: { statuses: {}, problem: 'gh is missing' } }))).toBe('GitHub could not be asked: gh is missing');
    expect(readyNote(offered, facts({ prStatus: { statuses: {}, problem: null } }))).toBe('Asking GitHub…');
    expect(readyNote(offered, facts())).toBeNull();
    expect(readyNote([session('b', 40)], facts({ prStatusOn: false }))).toBeNull();
  });
});
