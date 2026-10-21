import { describe, it, expect } from 'vitest';

import { linkedPrs, nextAsk, NO_PR_STATUS, prVerdict, rollUpPrTone } from '../../../src/renderer/prstatus';
import type { PrRef, PrStatus, SessionPr } from '../../../src/shared/types';

/** An open PR waiting on nobody: not a draft, approved, its checks passed, no conflict. */
function open(overrides: Partial<Extract<PrStatus, { state: 'open' }>> = {}): PrStatus {
  return { state: 'open', draft: false, review: 'approved', checks: 'passed', conflict: false, ...overrides };
}

describe('prVerdict', () => {
  it('is normal with no words while its status is not known', () => {
    expect(prVerdict(null)).toEqual({ tone: 'normal', words: null });
  });

  it('mutes a merged or a closed PR', () => {
    expect(prVerdict({ state: 'merged' })).toEqual({ tone: 'muted', words: 'merged' });
    expect(prVerdict({ state: 'closed' })).toEqual({ tone: 'muted', words: 'closed' });
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
    expect(nextAsk(prs, read(open({ checks: 'running' }), { state: 'merged' }))).toBe(60_000);
  });

  it('asks again in five while a PR is open, closed or has no status, or main could not ask', () => {
    expect(nextAsk(prs, read(open(), { state: 'merged' }))).toBe(300_000);
    expect(nextAsk(prs, read({ state: 'closed' }, { state: 'merged' }))).toBe(300_000);
    expect(nextAsk(prs, read(undefined, { state: 'merged' }))).toBe(300_000);
    expect(nextAsk(prs, read({ state: 'merged' }, { state: 'merged' }, 'gh was not found'))).toBe(300_000);
    expect(nextAsk(prs, NO_PR_STATUS)).toBe(300_000);
  });

  it('asks no more once every PR is merged', () => {
    expect(nextAsk(prs, read({ state: 'merged' }, { state: 'merged' }))).toBe('off');
  });
});
