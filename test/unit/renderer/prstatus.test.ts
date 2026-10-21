import { describe, it, expect } from 'vitest';

import { prVerdict, rollUpPrTone } from '../../../src/renderer/prstatus';
import type { PrStatus } from '../../../src/shared/types';

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
