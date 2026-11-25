import type { SessionSummary } from '../types';

/** An order of sessions: negative when `a` goes before `b`. */
type Sort = (a: SessionSummary, b: SessionSummary) => number;

/** When a session was last active, read as a time rather than compared as text, since the ISO form is how Claude Code writes it today rather than a contract; one that cannot be read counts as the oldest. */
const activeAt = (session: SessionSummary): number => Date.parse(session.lastActivity) || 0;

/**
 * The orders a view's section can be sorted in, by name.
 * `activity-oldest` compares times that cannot be read as NaN, which leaves such a session wherever the sort happens to put it, where `activity` puts it last.
 */
export const SORTS = {
  activity: (a, b) => activeAt(b) - activeAt(a),
  'activity-oldest': (a, b) => Date.parse(a.lastActivity) - Date.parse(b.lastActivity),
} satisfies Record<string, Sort>;

export type SortName = keyof typeof SORTS;
