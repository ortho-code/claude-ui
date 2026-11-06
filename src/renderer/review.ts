import type { SetAside, PrStatusRead, SessionSummary } from '../shared/types';
import { entityKey, relativeTime } from './logic';
import { settledState } from './prstatus';

/**
 * THE REVIEW, pure (docs/architecture.md § The review): which sessions it offers, in which of its two sets, and the line that says why each is there.
 * One function per term the review is made of, each named for the query term it becomes when the session-model design's stage 3 brings the query language, so the review, a query typed by hand and a needs-you type can never disagree about them: `is:unfinished`, `is:set-aside`, `kept:<Nd`, `untouched:>Nd`, `is:ready-to-finish`.
 * The review itself is a definition, data rather than code, which stage 3 moves into the bundled `views/review.json` as a view in review mode; its two numbers of days are written there and nowhere else (decided 2026-11-04).
 */

const DAY = 86_400_000;

/** What the terms read besides the session itself: what the store holds of it. */
export interface ReviewFacts {
  /** The sessions with a tab, by key. */
  tabbed: ReadonlySet<string>;
  finished: { has(key: string): boolean };
  pendingDeletes: ReadonlySet<string>;
  setAside: ReadonlyMap<string, SetAside>;
  kept: ReadonlyMap<string, number>;
  notes: ReadonlyMap<string, string>;
  /** What GitHub said of the PRs, as the PR marks read it; empty while the setting is off (`Settings.prStatus`). */
  prStatus: PrStatusRead;
  /** Whether the setting lets the app ask GitHub. */
  prStatusOn: boolean;
}

/** `is:unfinished`: no tab, not finished, and not on its way to the trash. */
export function isUnfinished(session: SessionSummary, facts: ReviewFacts): boolean {
  const key = entityKey(session);
  return !facts.tabbed.has(key) && !facts.finished.has(key) && !facts.pendingDeletes.has(key);
}

/** `is:set-aside`: set aside, with a day or whenever. */
export function isSetAside(session: SessionSummary, facts: ReviewFacts): boolean {
  return facts.setAside.has(entityKey(session));
}

/** `kept:<Nd`: kept out of the review less than `days` days before `now`. */
export function keptWithin(session: SessionSummary, facts: ReviewFacts, days: number, now: number): boolean {
  const at = facts.kept.get(entityKey(session));
  return at !== undefined && now - at < days * DAY;
}

/** `untouched:>Nd`: last active more than `days` days before `now`. */
export function untouchedFor(session: SessionSummary, days: number, now: number): boolean {
  return now - Date.parse(session.lastActivity) > days * DAY;
}

/**
 * `is:ready-to-finish`: every link settled, so at least one link, since a session that links nothing has nothing settled; today a link is a PR, settled when merged or closed as the PR marks read GitHub's answer (`settledState`).
 * A PR GitHub has not answered for is not settled, nor any after a failed ask, nor any while the setting is off and nothing is asked.
 * Stage 4's folder links add "no changes left in a folder only it worked in" here.
 */
export function isReadyToFinish(session: SessionSummary, facts: ReviewFacts): boolean {
  return session.prs.length > 0 && session.prs.every((pr) => settledState(pr, facts.prStatus) !== null);
}

/** One of the review's sets: its id and name, the term that puts a session in it, and the line that says why a session is there. */
export interface ReviewSet {
  id: 'ready' | 'untouched';
  name: string;
  /** The term, as stage 3's query language will write it. */
  query: string;
  holds: (session: SessionSummary, facts: ReviewFacts, now: number) => boolean;
  why: (session: SessionSummary, facts: ReviewFacts, now: number) => string;
}

/** How long a session goes untouched before the review offers it, and how long Keep holds one out: the review's own terms, here and nowhere else, so what Keep says it does is read from here. */
const UNTOUCHED_DAYS = 30;
export const KEPT_DAYS = 30;

/**
 * THE REVIEW'S DEFINITION: the terms every set shares, and its sets in the order they are shown, a session in more than one shown once, in the first (decided 2026-11-04).
 * Shared, so that every act of the bar that decides a row takes it out of the review, Finished, Set aside… and Keep alike, and the review can end; a session with a tab is work in hand, for its tab to decide.
 */
export const REVIEW = {
  id: 'review',
  name: 'Review',
  shared: `is:unfinished -is:set-aside -kept:<${KEPT_DAYS}d`,
  holds: (session: SessionSummary, facts: ReviewFacts, now: number): boolean => isUnfinished(session, facts) && !isSetAside(session, facts) && !keptWithin(session, facts, KEPT_DAYS, now),
  sets: [
    { id: 'ready', name: 'Ready to finish', query: 'is:ready-to-finish', holds: (session, facts) => isReadyToFinish(session, facts), why: (session, facts, now) => `${settledWords(session, facts)} · ${relativeTime(session.lastActivity, now)}` },
    { id: 'untouched', name: `Untouched ${UNTOUCHED_DAYS}+ days`, query: `untouched:>${UNTOUCHED_DAYS}d`, holds: (session, _facts, now) => untouchedFor(session, UNTOUCHED_DAYS, now), why: (session, facts, now) => untouchedWords(session, facts, now) },
  ] satisfies ReviewSet[],
} as const;

/** What settled a ready session's PRs: "Its PR merged", "Its 3 PRs merged", "Its 2 PRs merged or closed". */
function settledWords(session: SessionSummary, facts: ReviewFacts): string {
  const states = new Set(session.prs.map((pr) => settledState(pr, facts.prStatus)));
  const how = states.size > 1 ? 'merged or closed' : states.has('closed') ? 'closed' : 'merged';
  return session.prs.length === 1 ? `Its PR ${how}` : `Its ${session.prs.length} PRs ${how}`;
}

/** How long an untouched session has been, "41 days", then the start of its note where it has one, which says where it stands. */
function untouchedWords(session: SessionSummary, facts: ReviewFacts, now: number): string {
  const days = `${Math.floor((now - Date.parse(session.lastActivity)) / DAY)} days`;
  const note = facts.notes.get(entityKey(session))?.split('\n')[0]?.trim();
  if (!note) return days;
  return `${days} · note: “${note.length > 60 ? `${note.slice(0, 60)}…` : note}”`;
}

/** A row of the review: its session and why it is there. */
export interface ReviewRow {
  session: SessionSummary;
  why: string;
}

/** A set as shown: its id, name and rows, and for Ready to finish, the line saying why it cannot answer, null while it can. */
export interface ReviewSection {
  id: ReviewSet['id'];
  name: string;
  rows: ReviewRow[];
  note: string | null;
}

/**
 * The review over `sessions`, the ones in scope: each set's rows, oldest activity first, a session in both under the first only; a set with none is still there, so its note can say why it is empty.
 */
export function reviewSections(sessions: readonly SessionSummary[], facts: ReviewFacts, now: number): ReviewSection[] {
  const offered = [...sessions].filter((session) => REVIEW.holds(session, facts, now)).sort((a, b) => Date.parse(a.lastActivity) - Date.parse(b.lastActivity));
  const shown = new Set<string>();
  return REVIEW.sets.map((set: ReviewSet) => {
    const rows = offered
      .filter((session) => !shown.has(entityKey(session)) && set.holds(session, facts, now))
      .map((session) => {
        shown.add(entityKey(session));
        return { session, why: set.why(session, facts, now) };
      });
    return { id: set.id, name: set.name, rows, note: set.id === 'ready' ? readyNote(offered, facts) : null };
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
export function readyNote(offered: readonly SessionSummary[], facts: ReviewFacts): string | null {
  if (!offered.some((session) => session.prs.length > 0)) return null;
  if (!facts.prStatusOn) return "PR status is off in Settings, so which sessions' PRs are settled is not known.";
  if (facts.prStatus.problem !== null) return `GitHub could not be asked: ${facts.prStatus.problem}`;
  if (Object.keys(facts.prStatus.statuses).length === 0) return 'Asking GitHub…';
  return null;
}
