import type { QueryFacts } from '../../shared/query/facts';
import type { FieldRegistry } from '../../shared/query/field';
import type { PrStatusRead, SessionSummary } from '../../shared/types';
import { offeredBy, sectioned, type SectionedView, type ShownSection } from './sectioned-view';

/**
 * THE REVIEW, pure (docs/architecture/session-list.md § The review): which sessions it offers, and in which of its two sets.
 * It is queries in the query language, so the review, a query typed by hand and a needs-you type can never disagree about a term.
 * The review itself is a definition, data rather than code, a view whose sections are its sets; its two numbers of days are written there and nowhere else (decided 2026-11-04).
 */

/** How long a session goes untouched before the review offers it, and how long Keep holds one out, each counted in whole days from today's midnight: the review's own terms, here and nowhere else, so what Keep says it does is read from here. */
const UNTOUCHED_DAYS = 30;
export const KEPT_DAYS = 30;

/**
 * THE REVIEW'S DEFINITION: the query every set shares, and its sets in the order they are shown, a session in more than one shown once, in the first (decided 2026-11-04), each oldest activity first.
 * Shared, so that every act of the bar that decides a row takes it out of the review, Finished, Set aside… and Keep alike, and the review can end; a session with a tab is work in hand, for its tab to decide.
 */
export const REVIEW = {
  id: 'review',
  name: 'Review',
  shared: `is:unfinished -is:set-aside -kept:>=today-${KEPT_DAYS}d`,
  sections: [
    { id: 'ready', name: 'Ready to finish', query: 'is:ready-to-finish', sort: 'activity-oldest' },
    { id: 'untouched', name: `Untouched ${UNTOUCHED_DAYS}+ days`, query: `active:<today-${UNTOUCHED_DAYS}d`, sort: 'activity-oldest' },
  ],
} as const satisfies SectionedView;

/** What Ready to finish's line reads: GitHub's answer, and whether the setting lets the app ask. */
export interface ReadyFacts {
  prStatus: PrStatusRead;
  prStatusOn: boolean;
}

/**
 * A set as shown: its id, name and rows, and for Ready to finish, the line saying why it cannot answer, null while it can.
 * A row reads as it does anywhere else in the list, its set's heading saying why it is there (decided 2026-11-12).
 */
export interface ReviewSection extends ShownSection {
  note: string | null;
}

/**
 * The review over `sessions`, the ones in scope (`sectionsOf`); a set with none is still there, so its note can say why it is empty.
 * The note reads every session the review would look at, in a set or not.
 */
export function reviewSections(sessions: readonly SessionSummary[], fields: FieldRegistry, facts: QueryFacts, ready: ReadyFacts): ReviewSection[] {
  const offered = offeredBy(REVIEW, sessions, fields, facts);
  return sectioned(REVIEW, offered, fields, facts).map((section) => ({ ...section, note: section.id === 'ready' ? readyNote(offered, ready) : null }));
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
