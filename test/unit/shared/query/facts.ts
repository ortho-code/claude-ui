import type { QueryFacts } from '../../../../src/shared/query/facts';
import type { SessionSummary } from '../../../../src/shared/types';

/** Wednesday 25 November 2026, 15:30 local time: late enough in a day that counting from midnight and from now give different answers. */
export const NOW = new Date(2026, 10, 25, 15, 30).getTime();

const DAY = 86_400_000;

/** `days` before NOW, to the minute, as a transcript writes it. */
export const ago = (days: number): string => new Date(NOW - days * DAY).toISOString();

/** A fact that holds for the sessions named. */
export const only =
  (...ids: string[]) =>
  (session: SessionSummary): boolean =>
    ids.includes(session.id);

/** Facts of a session that is nothing but itself: no tab, not pinned, no marks, no reasons, no PR known; each case overrides what it is about. */
export function facts(over: Partial<QueryFacts> = {}): QueryFacts {
  return {
    now: NOW,
    current: null,
    pinned: () => false,
    tabbed: () => false,
    running: () => false,
    finished: () => false,
    deleting: () => false,
    status: () => undefined,
    setAside: () => undefined,
    kept: () => undefined,
    note: () => undefined,
    groupName: () => undefined,
    projectName: (session) => session.repoRoot.split('/').pop() ?? '',
    label: (session) => session.title,
    reasons: () => [],
    claudeAsks: () => null,
    asking: () => false,
    rank: () => null,
    worktree: () => false,
    gone: () => false,
    prRole: () => null,
    prStates: () => new Set(),
    prTitle: () => undefined,
    ...over,
  };
}
