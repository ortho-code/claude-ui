import { describe, it, expect } from 'vitest';

import { PR_TYPES } from '../../../src/shared/needsyou';
import { approvalsIn, linkedPrs, needsYouNow, nextAsk, NO_PR_STATUS, prChanges, prDetails, prMark, prVerdict, rollUpPrTone, settledState, verdictOf } from '../../../src/renderer/prstatus';
import type { Approvals } from '../../../src/shared/prs';
import type { PrRef, PrSeen, PrStatus, SessionPr } from '../../../src/shared/types';

/** An open PR waiting on nobody: not a draft, approved, its checks passed, no conflict. */
function open(overrides: Partial<Extract<PrStatus, { state: 'open' }>> = {}): PrStatus {
  return { state: 'open', role: 'own', draft: false, review: 'approved', checks: 'passed', conflict: false, approvals: 1, newCommits: false, reviewAsked: false, changesRequested: [], ...overrides };
}

/** No repository needs a number of approvals: GitHub's decision alone says approved. */
const GITHUB_DECIDES: Approvals = {};

/** The repository the PRs here are in needs two approvals, written in another case than the PRs spell it. */
const TWO: Approvals = { 'Acme/App': 2 };

describe('prChanges', () => {
  const pr: PrRef = { repository: 'acme/app', number: 7 };
  const ref = 'acme/app#7';
  /** What was seen of the PR before, as `prChanges` keeps it. */
  const was = (status: PrStatus): PrSeen => prChanges({}, [pr], { statuses: { [ref]: status }, problem: null }, GITHUB_DECIDES).seen ?? {};
  /** The changes from `before` to `after`, strongest first and joined, null for none that marks. */
  const change = (before: PrStatus, after: PrStatus, approvals = GITHUB_DECIDES): string | null =>
    prChanges(was(before), [pr], { statuses: { [ref]: after }, problem: null }, approvals).changes[0]?.types.map((type) => PR_TYPES[type]).join(', ') ?? null;

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
    const unknown = prChanges(seen, [pr], { statuses: { [ref]: open({ conflict: null }) }, problem: null }, GITHUB_DECIDES);
    expect(unknown.changes).toEqual([]);
    expect(unknown.seen?.[ref]).toEqual(open({ conflict: true }));
    expect(prChanges(unknown.seen, [pr], { statuses: { [ref]: open({ conflict: true }) }, problem: null }, GITHUB_DECIDES).changes).toEqual([]);
  });

  // Approved marks only when the review itself turns approved (decided 2026-10-29), not when it shows again once a push's checks have run.
  it('marks approved when the review turns approved, checks running or not, and not when it comes back from running checks', () => {
    expect(change(open({ review: 'changes-requested' }), open({ review: 'approved' }))).toBe('approved');
    expect(change(open({ review: 'changes-requested' }), open({ review: 'approved', checks: 'running' }))).toBe('approved');
    expect(change(open({ review: 'approved', checks: 'running' }), open({ review: 'approved' }))).toBeNull();
  });

  it('marks approved in a repository that needs two only at the second approval', () => {
    expect(change(open({ review: 'review-required', approvals: 0 }), open({ approvals: 1 }), TWO)).toBeNull();
    expect(change(open({ approvals: 1 }), open({ approvals: 2 }), TWO)).toBe('approved');
  });

  it('marks nothing from the repository’s number being set while the PR stays as it was', () => {
    const seen = was(open({ approvals: 1 }));
    expect(prChanges(seen, [pr], { statuses: { [ref]: open({ approvals: 1 }) }, problem: null }, TWO).changes).toEqual([]);
  });

  // GitHub's review decision stays changes requested while any request stands, so only the reviews tell a new one.
  it('marks changes requested again for a second reviewer’s request, or a new round of the same one’s, while one already stands', () => {
    const asking = (...ids: string[]): PrStatus => open({ review: 'changes-requested', changesRequested: ids });
    expect(change(asking('PRR_a'), asking('PRR_a', 'PRR_b'))).toBe('changes requested');
    expect(change(asking('PRR_a'), asking('PRR_c'))).toBe('changes requested');
  });

  it('does not mark changes requested again for the same requests, one going, or reviews not known on either side', () => {
    const asking = (...ids: string[]): PrStatus => open({ review: 'changes-requested', changesRequested: ids });
    expect(change(asking('PRR_a', 'PRR_b'), asking('PRR_a', 'PRR_b'))).toBeNull();
    expect(change(asking('PRR_a', 'PRR_b'), asking('PRR_b'))).toBeNull();
    expect(change(open({ review: 'changes-requested', changesRequested: null }), asking('PRR_a'))).toBeNull();
    expect(change(asking('PRR_a'), open({ review: 'changes-requested', changesRequested: null }))).toBeNull();
  });

  it('marks commits since your review once a push moves the PR off the commit you reviewed, and not again for a second push before your next review', () => {
    const reviewed = (newCommits: boolean): PrStatus => open({ role: 'reviewing', review: 'changes-requested', newCommits });
    expect(change(reviewed(false), reviewed(true))).toBe('new commits since your review');
    expect(change(reviewed(true), reviewed(true))).toBeNull();
    expect(change(reviewed(false), reviewed(false))).toBeNull();
  });

  it('marks a request for your review when one comes, including after your review, and not while one stands', () => {
    const reviewed = (reviewAsked: boolean): PrStatus => open({ role: 'reviewing', review: 'review-required', reviewAsked });
    expect(change(reviewed(false), reviewed(true))).toBe('your review asked again');
    expect(change(reviewed(true), reviewed(true))).toBeNull();
  });

  // A status kept before the app asked about your review knows none of it.
  it('marks nothing for a review field coming to be known, and marks its next change', () => {
    const unknown = open({ role: 'reviewing', newCommits: null, reviewAsked: null, approvals: null });
    expect(change(unknown, open({ role: 'reviewing', newCommits: true, reviewAsked: true }))).toBeNull();
    const known = prChanges(was(unknown), [pr], { statuses: { [ref]: open({ role: 'reviewing', newCommits: false }) }, problem: null }, GITHUB_DECIDES);
    expect(known.changes).toEqual([]);
    expect(prChanges(known.seen, [pr], { statuses: { [ref]: open({ role: 'reviewing', newCommits: true }) }, problem: null }, GITHUB_DECIDES).changes[0]?.types).toEqual(['pr.new-commits']);
  });

  // What it holds when it opens again would otherwise be recorded unmarked.
  it('marks a closed PR opened again as reopened, with everything it holds then', () => {
    expect(change({ state: 'closed', role: 'own' }, open({ review: 'review-required' }))).toBe('reopened');
    expect(change({ state: 'closed', role: 'own' }, open({ checks: 'failed', conflict: true }))).toBe('checks failed, merge conflict, reopened, approved');
  });

  it('records a PR seen for the first time without marking it, whatever it reads', () => {
    const first = prChanges({}, [pr], { statuses: { [ref]: { state: 'merged', role: 'own' } }, problem: null }, GITHUB_DECIDES);
    expect(first).toEqual({ seen: { [ref]: { state: 'merged', role: 'own' } }, changes: [] });
    expect(prChanges(null, [pr], { statuses: { [ref]: open() }, problem: null }, GITHUB_DECIDES)).toEqual({ seen: { [ref]: open() }, changes: [] });
  });

  it('changes nothing for an answer main could not get, and keeps what was seen of a PR with no status', () => {
    const seen = was(open());
    expect(prChanges(seen, [pr], { statuses: { [ref]: { state: 'merged', role: 'own' } }, problem: 'gh was not found' }, GITHUB_DECIDES)).toEqual({ seen, changes: [] });
    expect(prChanges(seen, [pr], { statuses: {}, problem: null }, GITHUB_DECIDES)).toEqual({ seen, changes: [] });
    expect(prChanges(null, [pr], { statuses: {}, problem: 'gh was not found' }, GITHUB_DECIDES)).toEqual({ seen: null, changes: [] });
  });
});

describe('needsYouNow', () => {
  it('names everything a PR already needs you for, strongest first, as the first run marks it, and nothing where it needs nothing', () => {
    expect(needsYouNow({ state: 'merged', role: 'own' }, null)).toEqual(['pr.merged']);
    expect(needsYouNow(open({ review: 'changes-requested' }), null)).toEqual(['pr.changes-requested']);
    expect(needsYouNow(open({ checks: 'failed' }), null)).toEqual(['pr.checks-failed', 'pr.approved']);
    expect(needsYouNow(open({ review: 'review-required' }), null)).toEqual([]);
  });

  it('names an approval only once it reaches the number the repository needs', () => {
    expect(needsYouNow(open({ approvals: 1 }), 2)).toEqual([]);
    expect(needsYouNow(open({ approvals: 2 }), 2)).toEqual(['pr.approved']);
  });
});

describe('prVerdict', () => {
  it('is normal with no words while its status is not known', () => {
    expect(prVerdict(null, null)).toEqual({ tone: 'normal', words: null });
  });

  it('mutes a merged or a closed PR', () => {
    expect(prVerdict({ state: 'merged', role: 'own' }, null)).toEqual({ tone: 'muted', words: 'merged' });
    expect(prVerdict({ state: 'closed', role: 'own' }, null)).toEqual({ tone: 'muted', words: 'closed' });
  });

  it('is danger for failed checks or a conflict, over everything below', () => {
    expect(prVerdict(open({ checks: 'failed', review: 'changes-requested', draft: true }), null)).toEqual({ tone: 'danger', words: 'checks failed' });
    expect(prVerdict(open({ conflict: true, review: 'changes-requested' }), null)).toEqual({ tone: 'danger', words: 'merge conflict' });
  });

  it('is attention for changes requested, over a draft and running checks', () => {
    expect(prVerdict(open({ review: 'changes-requested', draft: true, checks: 'running' }), null)).toEqual({ tone: 'attention', words: 'changes requested' });
  });

  it('is positive only when approved, not a draft, its checks passed or none, and no conflict', () => {
    expect(prVerdict(open(), null)).toEqual({ tone: 'positive', words: 'approved' });
    expect(prVerdict(open({ checks: null }), null)).toEqual({ tone: 'positive', words: 'approved' });
    expect(prVerdict(open({ draft: true }), null)).toEqual({ tone: 'normal', words: 'draft' });
    expect(prVerdict(open({ checks: 'running' }), null)).toEqual({ tone: 'normal', words: 'checks running' });
    expect(prVerdict(open({ conflict: null }), null)).toEqual({ tone: 'normal', words: 'approved' });
  });

  it('is normal while it waits on a review, or has no review decision', () => {
    expect(prVerdict(open({ review: 'review-required' }), null)).toEqual({ tone: 'normal', words: 'review required' });
    expect(prVerdict(open({ review: null }), null)).toEqual({ tone: 'normal', words: 'open' });
  });

  it('reads a PR GitHub calls approved as waiting on a review while it has fewer approvals than its repository needs, or a count not known', () => {
    expect(prVerdict(open({ approvals: 1 }), 2)).toEqual({ tone: 'normal', words: 'review required' });
    expect(prVerdict(open({ approvals: null }), 2)).toEqual({ tone: 'normal', words: 'review required' });
    expect(prVerdict(open({ approvals: 2 }), 2)).toEqual({ tone: 'positive', words: 'approved' });
  });

  it('never reads approved where GitHub does not, whatever the count', () => {
    expect(prVerdict(open({ review: 'review-required', approvals: 3 }), 2)).toEqual({ tone: 'normal', words: 'review required' });
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
    expect(verdictOf(pr, { statuses: { 'acme/app#1': { state: 'merged', role: 'own' } }, problem: null }, GITHUB_DECIDES)).toEqual({ tone: 'muted', words: 'merged' });
    expect(verdictOf(pr, NO_PR_STATUS, GITHUB_DECIDES)).toEqual({ tone: 'normal', words: null });
  });

  it('reads no status while main could not ask, whatever the answer still holds', () => {
    expect(verdictOf(pr, { statuses: { 'acme/app#1': { state: 'merged', role: 'own' } }, problem: 'gh was not found' }, GITHUB_DECIDES)).toEqual({ tone: 'normal', words: null });
  });

  it('reads with the number the PR’s repository needs, matched in any case', () => {
    const read = { statuses: { 'acme/app#1': open({ approvals: 1 }) }, problem: null };
    expect(verdictOf(pr, read, TWO)).toEqual({ tone: 'normal', words: 'review required' });
    expect(verdictOf(pr, read, { 'acme/lib': 2 })).toEqual({ tone: 'positive', words: 'approved' });
  });
});

describe('settledState', () => {
  const pr: PrRef = { repository: 'acme/app', number: 1 };

  it('is merged or closed by the answer, and null for an open PR, one it lacks, or while main could not ask', () => {
    expect(settledState(pr, { statuses: { 'acme/app#1': { state: 'closed', role: 'own' } }, problem: null })).toBe('closed');
    expect(settledState(pr, { statuses: { 'acme/app#1': open() }, problem: null })).toBeNull();
    expect(settledState(pr, NO_PR_STATUS)).toBeNull();
    expect(settledState(pr, { statuses: { 'acme/app#1': { state: 'merged', role: 'own' } }, problem: 'gh was not found' })).toBeNull();
  });
});

describe('prDetails', () => {
  const pr: PrRef = { repository: 'acme/app', number: 1 };
  const details = (status: PrStatus, approvals = GITHUB_DECIDES): string[] => prDetails(pr, { statuses: { 'acme/app#1': status }, problem: null }, approvals);

  it('names the role only for a PR that is not yours', () => {
    expect(details({ state: 'closed', role: 'own' })).toEqual(['closed']);
    expect(details({ state: 'closed', role: 'reviewing' })).toEqual(['reviewing', 'closed']);
    expect(details({ state: 'closed', role: 'other' })).toEqual(['someone else’s', 'closed']);
    expect(details({ state: 'closed', role: null })).toEqual(['closed']);
  });

  it('counts an open PR’s approvals against its repository’s number, and alone without one', () => {
    expect(details(open({ review: 'changes-requested', approvals: 1 }), TWO)).toEqual(['changes requested', '1 of 2 approvals']);
    expect(details(open({ review: 'review-required', approvals: 0 }), TWO)).toEqual(['review required', '0 of 2 approvals']);
    expect(details(open({ approvals: 1 }))).toEqual(['approved', '1 approval']);
    expect(details(open({ approvals: 3 }))).toEqual(['approved', '3 approvals']);
    expect(details(open({ review: 'review-required', approvals: 0 }))).toEqual(['review required']);
    expect(details(open({ approvals: null }), TWO)).toEqual(['review required']);
  });

  it('says nothing while main could not ask, or for a PR it has no status for', () => {
    expect(prDetails(pr, { statuses: { 'acme/app#1': open() }, problem: 'gh was not found' }, GITHUB_DECIDES)).toEqual([]);
    expect(prDetails(pr, NO_PR_STATUS, GITHUB_DECIDES)).toEqual([]);
  });
});

describe('approvalsIn', () => {
  it('is no number for any repository before the settings are read', () => {
    expect(approvalsIn(null)).toEqual({});
  });
});

describe('prMark', () => {
  const prs: PrRef[] = [1, 2, 3].map((number) => ({ repository: 'acme/app', number }));
  const read = (statuses: Record<string, PrStatus>, problem: string | null = null) => ({ statuses, problem });

  it('takes the roll-up tone, and counts only the PRs that set it, by state', () => {
    expect(prMark(prs, read({ 'acme/app#1': open({ checks: 'failed' }), 'acme/app#2': open({ conflict: true }), 'acme/app#3': { state: 'merged', role: 'own' } }), GITHUB_DECIDES)).toEqual({
      tone: 'danger',
      says: '1 with failing checks, 1 with a merge conflict',
    });
    expect(prMark(prs, read({ 'acme/app#1': { state: 'merged', role: 'own' }, 'acme/app#2': { state: 'merged', role: 'own' }, 'acme/app#3': { state: 'closed', role: 'own' } }), GITHUB_DECIDES)).toEqual({
      tone: 'muted',
      says: '2 merged, 1 closed',
    });
  });

  it('is normal and says nothing while no PR has a status', () => {
    expect(prMark(prs, NO_PR_STATUS, GITHUB_DECIDES)).toEqual({ tone: 'normal', says: null });
  });

  it('counts a PR with no status as normal beside the others, naming only those it has words for', () => {
    expect(prMark(prs, read({ 'acme/app#1': open({ review: 'review-required' }), 'acme/app#3': { state: 'merged', role: 'own' } }), GITHUB_DECIDES)).toEqual({ tone: 'normal', says: '1 awaiting review' });
  });

  it('counts an approval below its repository’s number as awaiting review', () => {
    expect(prMark(prs, read({ 'acme/app#1': open({ approvals: 1 }), 'acme/app#2': open({ approvals: 2 }) }), TWO)).toEqual({ tone: 'positive', says: '1 approved' });
    expect(prMark(prs, read({ 'acme/app#1': open({ approvals: 1 }) }), TWO)).toEqual({ tone: 'normal', says: '1 awaiting review' });
  });

  it('is normal and says why when main could not ask, whatever statuses it still holds', () => {
    expect(prMark(prs, read({ 'acme/app#1': open({ checks: 'failed' }) }, 'gh was not found'), GITHUB_DECIDES)).toEqual({ tone: 'normal', says: 'no status: gh was not found' });
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
