import { describe, it, expect } from 'vitest';

import { PR_TYPES } from '../../../src/shared/needsyou';
import { linkedPrs, needsYouNow, nextAsk, NO_PR_STATUS, prChanges, prMark, prVerdict, rollUpPrTone, verdictOf } from '../../../src/renderer/prstatus';
import type { PrRef, PrSeen, PrStatus, SessionPr } from '../../../src/shared/types';

/** An open PR waiting on nobody: not a draft, approved, its checks passed, no conflict. */
function open(overrides: Partial<Extract<PrStatus, { state: 'open' }>> = {}): PrStatus {
  return { state: 'open', role: 'own', draft: false, review: 'approved', checks: 'passed', conflict: false, approvals: 1, newCommits: false, reviewAsked: false, changesRequested: [], ...overrides };
}

describe('prChanges', () => {
  const pr: PrRef = { repository: 'acme/app', number: 7 };
  const ref = 'acme/app#7';
  /** What was seen of the PR before, as `prChanges` keeps it. */
  const was = (status: PrStatus): PrSeen => prChanges({}, [pr], { statuses: { [ref]: status }, problem: null }).seen ?? {};
  /** The changes from `before` to `after`, strongest first and joined, null for none that marks. */
  const change = (before: PrStatus, after: PrStatus): string | null => prChanges(was(before), [pr], { statuses: { [ref]: after }, problem: null }).changes[0]?.types.map((type) => PR_TYPES[type]).join(', ') ?? null;

  it('marks a PR turning into checks failed, a conflict, changes requested, merged or closed', () => {
    expect(change(open({ checks: 'running' }), open({ checks: 'failed' }))).toBe('checks failed');
    expect(change(open(), open({ conflict: true }))).toBe('merge conflict');
    expect(change(open({ review: 'review-required' }), open({ review: 'changes-requested' }))).toBe('changes requested');
    expect(change(open(), { state: 'merged', role: 'own' })).toBe('merged');
    expect(change(open(), { state: 'closed', role: 'own' })).toBe('closed');
  });

  it('does not mark one turning into a draft, running checks, a review required or plain open', () => {
    expect(change(open(), open({ draft: true }))).toBeNull();
    expect(change(open(), open({ checks: 'running' }))).toBeNull();
    expect(change(open({ review: 'changes-requested' }), open({ review: 'review-required' }))).toBeNull();
    expect(change(open({ review: 'review-required' }), open({ review: null }))).toBeNull();
  });

  it('does not mark what was there already', () => {
    expect(change(open({ checks: 'failed' }), open({ checks: 'failed', review: 'review-required' }))).toBeNull();
    expect(change({ state: 'merged', role: 'own' }, { state: 'merged', role: 'own' })).toBeNull();
  });

  // Each thing that needs you is told apart, where the words name only the strongest (decided 2026-10-29).
  it('does not mark changes requested again once failing checks on top of it pass', () => {
    expect(change(open({ review: 'changes-requested', checks: 'failed' }), open({ review: 'changes-requested', checks: 'running' }))).toBeNull();
    expect(change(open({ conflict: true, checks: 'failed' }), open({ conflict: true }))).toBeNull();
  });

  it('marks a conflict that comes while checks are failing, which the words would hide', () => {
    expect(change(open({ checks: 'failed' }), open({ checks: 'failed', conflict: true }))).toBe('merge conflict');
  });

  // An approval that comes with failing checks would otherwise be recorded unmarked, and never mark once the checks pass.
  it('marks every one of several that come at once, strongest first', () => {
    expect(change(open({ review: 'review-required' }), open({ review: 'approved', checks: 'failed' }))).toBe('checks failed, approved');
    expect(change(open({ review: 'review-required' }), open({ review: 'changes-requested', checks: 'failed' }))).toBe('checks failed, changes requested');
  });

  // GitHub works a conflict out again after a push, saying neither meanwhile.
  it('takes a conflict GitHub has not worked out yet as what it was, so one that stays does not mark again', () => {
    const seen = was(open({ conflict: true }));
    const unknown = prChanges(seen, [pr], { statuses: { [ref]: open({ conflict: null }) }, problem: null });
    expect(unknown.changes).toEqual([]);
    expect(unknown.seen?.[ref]).toEqual(open({ conflict: true }));
    expect(prChanges(unknown.seen, [pr], { statuses: { [ref]: open({ conflict: true }) }, problem: null }).changes).toEqual([]);
  });

  // Approved marks only when the review itself turns approved (decided 2026-10-29), not when it shows again once a push's checks have run.
  it('marks approved when the review turns approved, checks running or not, and not when it comes back from running checks', () => {
    expect(change(open({ review: 'changes-requested' }), open({ review: 'approved' }))).toBe('approved');
    expect(change(open({ review: 'changes-requested' }), open({ review: 'approved', checks: 'running' }))).toBe('approved');
    expect(change(open({ review: 'approved', checks: 'running' }), open({ review: 'approved' }))).toBeNull();
  });

  // What it holds when it opens again would otherwise be recorded unmarked.
  it('marks a closed PR opened again as reopened, with everything it holds then', () => {
    expect(change({ state: 'closed', role: 'own' }, open({ review: 'review-required' }))).toBe('reopened');
    expect(change({ state: 'closed', role: 'own' }, open({ checks: 'failed', conflict: true }))).toBe('checks failed, merge conflict, reopened, approved');
  });

  it('records a PR seen for the first time without marking it, whatever it reads', () => {
    const first = prChanges({}, [pr], { statuses: { [ref]: { state: 'merged', role: 'own' } }, problem: null });
    expect(first).toEqual({ seen: { [ref]: { state: 'merged', role: 'own' } }, changes: [] });
    expect(prChanges(null, [pr], { statuses: { [ref]: open() }, problem: null })).toEqual({ seen: { [ref]: open() }, changes: [] });
  });

  it('changes nothing for an answer main could not get, and keeps what was seen of a PR with no status', () => {
    const seen = was(open());
    expect(prChanges(seen, [pr], { statuses: { [ref]: { state: 'merged', role: 'own' } }, problem: 'gh was not found' })).toEqual({ seen, changes: [] });
    expect(prChanges(seen, [pr], { statuses: {}, problem: null })).toEqual({ seen, changes: [] });
    expect(prChanges(null, [pr], { statuses: {}, problem: 'gh was not found' })).toEqual({ seen: null, changes: [] });
  });
});

describe('needsYouNow', () => {
  it('names everything a PR already needs you for, strongest first, as the first run marks it, and nothing where it needs nothing', () => {
    expect(needsYouNow({ state: 'merged', role: 'own' })).toEqual(['pr.merged']);
    expect(needsYouNow(open({ review: 'changes-requested' }))).toEqual(['pr.changes-requested']);
    expect(needsYouNow(open({ checks: 'failed' }))).toEqual(['pr.checks-failed', 'pr.approved']);
    expect(needsYouNow(open({ review: 'review-required' }))).toEqual([]);
  });
});

describe('prVerdict', () => {
  it('is normal with no words while its status is not known', () => {
    expect(prVerdict(null)).toEqual({ tone: 'normal', words: null });
  });

  it('mutes a merged or a closed PR', () => {
    expect(prVerdict({ state: 'merged', role: 'own' })).toEqual({ tone: 'muted', words: 'merged' });
    expect(prVerdict({ state: 'closed', role: 'own' })).toEqual({ tone: 'muted', words: 'closed' });
  });

  it('is danger for failed checks or a conflict, over everything below', () => {
    expect(prVerdict(open({ checks: 'failed', review: 'changes-requested', draft: true }))).toEqual({ tone: 'danger', words: 'checks failed' });
    expect(prVerdict(open({ conflict: true, review: 'changes-requested' }))).toEqual({ tone: 'danger', words: 'merge conflict' });
  });

  it('is attention for changes requested, over a draft and running checks', () => {
    expect(prVerdict(open({ review: 'changes-requested', draft: true, checks: 'running' }))).toEqual({ tone: 'attention', words: 'changes requested' });
  });

  it('is positive only when approved, not a draft, its checks passed or none, and no conflict', () => {
    expect(prVerdict(open())).toEqual({ tone: 'positive', words: 'approved' });
    expect(prVerdict(open({ checks: null }))).toEqual({ tone: 'positive', words: 'approved' });
    expect(prVerdict(open({ draft: true }))).toEqual({ tone: 'normal', words: 'draft' });
    expect(prVerdict(open({ checks: 'running' }))).toEqual({ tone: 'normal', words: 'checks running' });
    expect(prVerdict(open({ conflict: null }))).toEqual({ tone: 'normal', words: 'approved' });
  });

  it('is normal while it waits on a review, or has no review decision', () => {
    expect(prVerdict(open({ review: 'review-required' }))).toEqual({ tone: 'normal', words: 'review required' });
    expect(prVerdict(open({ review: null }))).toEqual({ tone: 'normal', words: 'open' });
  });
});

describe('rollUpPrTone', () => {
  it('takes whatever most needs a person', () => {
    expect(rollUpPrTone(['muted', 'normal', 'positive', 'attention', 'danger'])).toBe('danger');
    expect(rollUpPrTone(['muted', 'normal', 'positive', 'attention'])).toBe('attention');
    expect(rollUpPrTone(['muted', 'normal', 'positive'])).toBe('positive');
    expect(rollUpPrTone(['muted', 'normal'])).toBe('normal');
  });

  it('is muted when every PR is', () => {
    expect(rollUpPrTone(['muted', 'muted'])).toBe('muted');
  });

  it('is normal for none', () => {
    expect(rollUpPrTone([])).toBe('normal');
  });
});

const linked = (repository: string, number: number): SessionPr => ({ repository, number, url: `https://github.com/${repository}/pull/${number}` });

describe('linkedPrs', () => {
  it('names every PR the sessions link once, in the order first named', () => {
    const sessions = [{ prs: [linked('acme/app', 2), linked('acme/app', 1)] }, { prs: [] }, { prs: [linked('acme/lib', 2), linked('acme/app', 2)] }];
    expect(linkedPrs(sessions)).toEqual([
      { repository: 'acme/app', number: 2 },
      { repository: 'acme/app', number: 1 },
      { repository: 'acme/lib', number: 2 },
    ]);
  });
});

describe('verdictOf', () => {
  const pr: PrRef = { repository: 'acme/app', number: 1 };

  it('reads the PR’s status from the answer, and no status for one it lacks', () => {
    expect(verdictOf(pr, { statuses: { 'acme/app#1': { state: 'merged', role: 'own' } }, problem: null })).toEqual({ tone: 'muted', words: 'merged' });
    expect(verdictOf(pr, NO_PR_STATUS)).toEqual({ tone: 'normal', words: null });
  });

  it('reads no status while main could not ask, whatever the answer still holds', () => {
    expect(verdictOf(pr, { statuses: { 'acme/app#1': { state: 'merged', role: 'own' } }, problem: 'gh was not found' })).toEqual({ tone: 'normal', words: null });
  });
});

describe('prMark', () => {
  const prs: PrRef[] = [1, 2, 3].map((number) => ({ repository: 'acme/app', number }));
  const read = (statuses: Record<string, PrStatus>, problem: string | null = null) => ({ statuses, problem });

  it('takes the roll-up tone, and counts only the PRs that set it, by state', () => {
    expect(prMark(prs, read({ 'acme/app#1': open({ checks: 'failed' }), 'acme/app#2': open({ conflict: true }), 'acme/app#3': { state: 'merged', role: 'own' } }))).toEqual({
      tone: 'danger',
      says: '1 with failing checks, 1 with a merge conflict',
    });
    expect(prMark(prs, read({ 'acme/app#1': { state: 'merged', role: 'own' }, 'acme/app#2': { state: 'merged', role: 'own' }, 'acme/app#3': { state: 'closed', role: 'own' } }))).toEqual({ tone: 'muted', says: '2 merged, 1 closed' });
  });

  it('is normal and says nothing while no PR has a status', () => {
    expect(prMark(prs, NO_PR_STATUS)).toEqual({ tone: 'normal', says: null });
  });

  it('counts a PR with no status as normal beside the others, naming only those it has words for', () => {
    expect(prMark(prs, read({ 'acme/app#1': open({ review: 'review-required' }), 'acme/app#3': { state: 'merged', role: 'own' } }))).toEqual({ tone: 'normal', says: '1 awaiting review' });
  });

  it('is normal and says why when main could not ask, whatever statuses it still holds', () => {
    expect(prMark(prs, read({ 'acme/app#1': open({ checks: 'failed' }) }, 'gh was not found'))).toEqual({ tone: 'normal', says: 'no status: gh was not found' });
  });
});

describe('nextAsk', () => {
  const prs: PrRef[] = [
    { repository: 'acme/app', number: 1 },
    { repository: 'acme/app', number: 2 },
  ];
  const read = (one: PrStatus | undefined, two: PrStatus | undefined, problem: string | null = null) => ({
    statuses: { ...(one ? { 'acme/app#1': one } : {}), ...(two ? { 'acme/app#2': two } : {}) },
    problem,
  });

  it('asks again in a minute while any open PR’s checks run', () => {
    expect(nextAsk(prs, read(open({ checks: 'running' }), { state: 'merged', role: 'own' }))).toBe(60_000);
  });

  it('asks again in five while a PR is open, closed or has no status, or main could not ask', () => {
    expect(nextAsk(prs, read(open(), { state: 'merged', role: 'own' }))).toBe(300_000);
    expect(nextAsk(prs, read({ state: 'closed', role: 'own' }, { state: 'merged', role: 'own' }))).toBe(300_000);
    expect(nextAsk(prs, read(undefined, { state: 'merged', role: 'own' }))).toBe(300_000);
    expect(nextAsk(prs, read({ state: 'merged', role: 'own' }, { state: 'merged', role: 'own' }, 'gh was not found'))).toBe(300_000);
    expect(nextAsk(prs, NO_PR_STATUS)).toBe(300_000);
  });

  it('asks no more once every PR is merged', () => {
    expect(nextAsk(prs, read({ state: 'merged', role: 'own' }, { state: 'merged', role: 'own' }))).toBe('off');
  });
});
