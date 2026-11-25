import { matches } from '../../shared/query/evaluate';
import type { QueryFacts } from '../../shared/query/facts';
import type { FieldRegistry } from '../../shared/query/field';
import { parseQuery, type Query } from '../../shared/query/parse';
import type { PrStatusRead, SessionSummary } from '../../shared/types';
import { entityKey } from './sessions';

/**
 * THE REVIEW, pure (docs/architecture/session-list.md § The review): which sessions it offers, and in which of its two sets.
 * It is queries in the query language, so the review, a query typed by hand and a needs-you type can never disagree about a term.
 * The review itself is a definition, data rather than code, which stage 3 moves into the bundled `views/review.json` as a view in review mode; its two numbers of days are written there and nowhere else (decided 2026-11-04).
 */

/** One of the review's sets: its id and name, which its heading says, and the query that puts a session in it. */
export interface ReviewSet {
  id: 'ready' | 'untouched';
  name: string;
  query: string;
}

/** How long a session goes untouched before the review offers it, and how long Keep holds one out, each counted in whole days from today's midnight: the review's own terms, here and nowhere else, so what Keep says it does is read from here. */
const UNTOUCHED_DAYS = 30;
export const KEPT_DAYS = 30;

/**
 * THE REVIEW'S DEFINITION: the query every set shares, and its sets in the order they are shown, a session in more than one shown once, in the first (decided 2026-11-04).
 * Shared, so that every act of the bar that decides a row takes it out of the review, Finished, Set aside… and Keep alike, and the review can end; a session with a tab is work in hand, for its tab to decide.
 */
export const REVIEW = {
  id: 'review',
  name: 'Review',
  shared: `is:unfinished -is:set-aside -kept:>=today-${KEPT_DAYS}d`,
  sets: [
    { id: 'ready', name: 'Ready to finish', query: 'is:ready-to-finish' },
    { id: 'untouched', name: `Untouched ${UNTOUCHED_DAYS}+ days`, query: `active:<today-${UNTOUCHED_DAYS}d` },
  ] satisfies ReviewSet[],
} as const;

/** What Ready to finish's line reads: GitHub's answer, and whether the setting lets the app ask. */
export interface ReadyFacts {
  prStatus: PrStatusRead;
  prStatusOn: boolean;
}

/**
 * A set as shown: its id, name and rows, and for Ready to finish, the line saying why it cannot answer, null while it can.
 * A row reads as it does anywhere else in the list, its set's heading saying why it is there (decided 2026-11-12).
 */
export interface ReviewSection {
  id: ReviewSet['id'];
  name: string;
  rows: SessionSummary[];
  note: string | null;
}

/** One of the review's own queries, read; one that does not read is a mistake in the app, so it throws rather than offering nothing. */
function reviewQuery(text: string, fields: FieldRegistry): Query {
  const query = parseQuery(text, fields.fields);
  if (query.problems.length > 0) throw new Error(`The review's query "${text}" does not read: ${query.problems.map((problem) => problem.message).join(' ')}`);
  return query;
}

/**
 * The review over `sessions`, the ones in scope: each set's rows, oldest activity first, a session in both under the first only; a set with none is still there, so its note can say why it is empty.
 */
export function reviewSections(sessions: readonly SessionSummary[], fields: FieldRegistry, facts: QueryFacts, ready: ReadyFacts): ReviewSection[] {
  const shared = reviewQuery(REVIEW.shared, fields);
  const offered = sessions.filter((session) => matches(session, shared, fields, facts)).sort((a, b) => Date.parse(a.lastActivity) - Date.parse(b.lastActivity));
  const shown = new Set<string>();
  return REVIEW.sets.map((set: ReviewSet) => {
    const query = reviewQuery(set.query, fields);
    const rows = offered.filter((session) => !shown.has(entityKey(session)) && matches(session, query, fields, facts));
    for (const session of rows) shown.add(entityKey(session));
    return { id: set.id, name: set.name, rows, note: set.id === 'ready' ? readyNote(offered, ready) : null };
  });
}

/** How many sessions the review offers: what the Review button counts. */
export function reviewCount(sections: readonly ReviewSection[]): number {
  return sections.reduce((count, section) => count + section.rows.length, 0);
}

/**
 * Why Ready to finish cannot say which sessions are ready, null while it can, or while no session it would look at links a PR: PR status off in Settings, GitHub's ask failed, or its first answer not in yet.
 * Said on the set rather than leaving it empty as if nothing were ready (docs/principles.md, Failures show).
 */
export function readyNote(offered: readonly SessionSummary[], ready: ReadyFacts): string | null {
  if (!offered.some((session) => session.prs.length > 0)) return null;
  if (!ready.prStatusOn) return "PR status is off in Settings, so which sessions' PRs are settled is not known.";
  if (ready.prStatus.problem !== null) return `GitHub could not be asked: ${ready.prStatus.problem}`;
  if (Object.keys(ready.prStatus.statuses).length === 0) return 'Asking GitHub…';
  return null;
}
