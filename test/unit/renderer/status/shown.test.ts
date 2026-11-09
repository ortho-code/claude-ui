import { describe, it, expect } from 'vitest';
import type { NeedsYou } from '../../../../src/shared/types';
import { DEFAULT_RANKING, shownState } from '../../../../src/renderer/status/shown';
import { APP_ORDER, strengthOf, wasRunning } from '../fixtures';

describe('shownState', () => {
  // The order decided 2026-10-28: claude working or asking shows over the mark, and the mark over a turn that finished or no status at all.
  it('shows the needs-you mark over ready, closed and no status, and busy, background and waiting over it', () => {
    for (const status of ['ready', 'closed', undefined]) expect(shownState(status, [wasRunning], APP_ORDER), `${status} marked`).toBe('needs:app.was-running');
    for (const status of ['busy', 'background', 'waiting']) expect(shownState(status, [wasRunning], APP_ORDER), `${status} marked`).toBe(status);
    for (const status of ['ready', 'busy', undefined]) expect(shownState(status, [], APP_ORDER), `${status} unmarked`).toBe(status);
  });

  it("shows the strongest category's newest reason, one answer's changes by the order the PR types are named in", () => {
    const merged: NeedsYou = { type: 'pr.merged', at: 9, pr: 'acme/app#1' };
    const conflict: NeedsYou = { type: 'pr.conflict', at: 2, pr: 'acme/app#2' };
    const checks: NeedsYou = { type: 'pr.checks-failed', at: 5, pr: 'acme/app#3' };
    expect(shownState(undefined, [merged, conflict], APP_ORDER)).toBe('needs:pr.conflict');
    expect(shownState(undefined, [conflict, checks], APP_ORDER)).toBe('needs:pr.checks-failed');
    expect(shownState(undefined, [{ ...conflict, at: 5, pr: 'acme/app#3' }, checks], APP_ORDER)).toBe('needs:pr.checks-failed');
  });

  it('follows an order of your own: a category over busy, or ready over the categories', () => {
    expect(shownState('busy', [wasRunning], strengthOf(['waiting', 'reminders', 'busy', 'background', 'needs-you', 'ready', 'closed']))).toBe('needs:app.was-running');
    expect(shownState('ready', [wasRunning], strengthOf(['waiting', 'busy', 'background', 'ready', 'needs-you', 'closed']))).toBe('ready');
  });

  it('shows a status the order does not know as itself, and under any reason', () => {
    expect(shownState('compacting', [], APP_ORDER)).toBe('compacting');
    expect(shownState('compacting', [wasRunning], APP_ORDER)).toBe('needs:app.was-running');
  });

  it('places a reason of a category not known yet at needs-you, as before the categories are read', () => {
    expect(shownState('ready', [wasRunning], DEFAULT_RANKING)).toBe('needs:app.was-running');
    expect(shownState('busy', [wasRunning], DEFAULT_RANKING)).toBe('busy');
  });
});
