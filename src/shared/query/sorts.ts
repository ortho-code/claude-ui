import type { SessionSummary } from '../types';
import type { QueryFacts } from './facts';

/** An order of sessions: negative when `a` goes before `b`. */
type Sort = (a: SessionSummary, b: SessionSummary, facts: QueryFacts) => number;

/** When a session was last active, read as a time rather than compared as text, since the ISO form is how Claude Code writes it today rather than a contract; one that cannot be read counts as the oldest. */
const activeAt = (session: SessionSummary): number => Date.parse(session.lastActivity) || 0;

/** Text in code-unit order, so the order holds from one run to the next whatever the language. */
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** When its newest and its oldest reason came, null without a reason. */
function reasonsAt(session: SessionSummary, facts: QueryFacts): { newest: number | null; oldest: number | null } {
  const at = facts.reasons(session).map((reason) => reason.at);
  return at.length === 0 ? { newest: null, oldest: null } : { newest: Math.max(...at), oldest: Math.min(...at) };
}

const newestReasonFirst = (a: SessionSummary, b: SessionSummary, facts: QueryFacts): number => (reasonsAt(b, facts).newest ?? -Infinity) - (reasonsAt(a, facts).newest ?? -Infinity);
const oldestReasonFirst = (a: SessionSummary, b: SessionSummary, facts: QueryFacts): number => (reasonsAt(a, facts).oldest ?? Infinity) - (reasonsAt(b, facts).oldest ?? Infinity);
const setAsideLast = (a: SessionSummary, b: SessionSummary, facts: QueryFacts): number => Number(facts.setAside(a) !== undefined) - Number(facts.setAside(b) !== undefined);
const claudeAsksFirst = (a: SessionSummary, b: SessionSummary, facts: QueryFacts): number => Number(facts.claudeAsks(b) !== null) - Number(facts.claudeAsks(a) !== null);

/**
 * What asks for you, in the order it does: what is not set aside first, then by where its dot stands in the strength order, so the list and the dots follow one order; within that, those claude asks of first, each by its newest reason, then those of reasons only, the one that has waited longest first; the id last, so the order holds.
 */
const strength: Sort = (a, b, facts) =>
  setAsideLast(a, b, facts) ||
  (facts.rank(a) ?? Infinity) - (facts.rank(b) ?? Infinity) ||
  claudeAsksFirst(a, b, facts) ||
  (facts.claudeAsks(a) !== null ? newestReasonFirst(a, b, facts) : oldestReasonFirst(a, b, facts)) ||
  byText(a.id, b.id);

/** By project folder, then what its row is called, then the id. */
const project: Sort = (a, b, facts) => byText(a.repoRoot, b.repoRoot) || byText(facts.label(a), facts.label(b)) || byText(a.id, b.id);

/** When it comes back: the set-aside ones first, the soonest first and the undated last; then the newest reason first; the id last. */
const due: Sort = (a, b, facts) =>
  -setAsideLast(a, b, facts) || (facts.setAside(a)?.due ?? Infinity) - (facts.setAside(b)?.due ?? Infinity) || newestReasonFirst(a, b, facts) || byText(a.id, b.id);

/**
 * The orders a view's section can be sorted in, by name.
 * `activity-oldest` compares times that cannot be read as NaN, which leaves such a session wherever the sort happens to put it, where `activity` puts it last.
 */
export const SORTS = {
  activity: (a, b) => activeAt(b) - activeAt(a),
  'activity-oldest': (a, b) => Date.parse(a.lastActivity) - Date.parse(b.lastActivity),
  strength,
  project,
  due,
  /** What asks for you, by `strength`, then the rest by `project`. */
  'asking-then-project': (a, b, facts) => Number(facts.asking(b)) - Number(facts.asking(a)) || (facts.asking(a) ? strength(a, b, facts) : project(a, b, facts)),
} satisfies Record<string, Sort>;

export type SortName = keyof typeof SORTS;
