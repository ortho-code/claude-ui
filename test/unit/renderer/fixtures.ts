import { DEFAULT_STRENGTH, expandedStrength } from '../../../src/shared/status/looks';
import { categoryOf } from '../../../src/shared/status/needs-you';
import type { NeedsYou, SessionSummary } from '../../../src/shared/types';
import type { Strength } from '../../../src/renderer/status/shown';
import { bundledNeedsYou } from '../../renderer/support/needs-you';

export function session(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'id',
    conversationId: 'conv',
    cwd: '/repo',
    repoRoot: '/repo',
    isRepo: false,
    worktree: '',
    leftWorktree: '',
    movedOutOfWorktree: false,
    workCwd: '',
    checkouts: [],
    title: 'Title',
    firstMessage: 'first',
    model: '',
    lastActivity: '2026-07-28T10:00:00.000Z',
    isSibling: false,
    siblingIds: [],
    prs: [],
    postCompactHeads: [],
    // A session whose folders are both there, which is every case except the ones that say otherwise.
    cwdExists: true,
    repoRootExists: true,
    ...over,
  };
}

/** The strength order with the app's own categories, as `strengthNow` builds it. */
export function strengthOf(list: readonly string[] = DEFAULT_STRENGTH): Strength {
  const registry = bundledNeedsYou();
  return { order: expandedStrength(list, registry), categoryOf: (type) => categoryOf(registry, type) };
}

export const APP_ORDER = strengthOf();

export const wasRunning: NeedsYou = { type: 'app.was-running', at: 1, how: 'quit' };
