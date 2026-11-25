import type { SessionSummary } from '../../shared/types';
import { matches } from '../../shared/query/evaluate';
import { parseQuery, type Problem, type Query } from '../../shared/query/parse';
import { inView } from '../rules/session-filter';
import { entityKey } from '../rules/sessions';
import type { View } from './app';
import { queryFacts, queryFields, type QueryView } from './query-facts';

/** A query no session meets: what is in force while the field does not read and nothing read before it. */
const NOTHING: Query = { parts: [], problems: [] };

/** The query field read: what it says, or why it does not read, and the query in force meanwhile. */
export interface FilterQuery {
  /** What the list filters by: null for no query, every session meeting it. */
  inForce: Query | null;
  problems: Problem[];
}

let read: { text: string; fields: unknown; result: FilterQuery } | null = null;
/** The last query that read, null for an empty field, undefined before any read. */
let lastGood: Query | null | undefined;

/**
 * The query field as the list filters by it, read again only when its text or the fields change.
 * While the text does not read, the last query that did stays in force, so a term half typed does not empty the list; before any did, nothing is in force.
 */
export function filterQuery(view: View<'filter' | 'needsYouTypes'>): FilterQuery {
  const fields = queryFields(view);
  const text = view.filter.query;
  if (read?.text === text && read.fields === fields) return read.result;
  let result: FilterQuery;
  if (text.trim() === '') {
    lastGood = null;
    result = { inForce: null, problems: [] };
  } else {
    const query = parseQuery(text, fields.fields);
    if (query.problems.length === 0) lastGood = query;
    result = { inForce: query.problems.length === 0 ? query : (lastGood === undefined ? NOTHING : lastGood), problems: query.problems };
  }
  read = { text, fields, result };
  return result;
}

/**
 * Forget the last query that read, so the next query that does not read has nothing in force: what a launch does before it puts back the stored filter, since the store's empty filter it drew with until then was no query anyone left.
 */
export function forgetLastQuery(): void {
  read = null;
  lastGood = undefined;
}

/** Whether each session passes the filter: in the set the finished switch shows, and meeting the query in force; the facts are made once for the whole pass. */
export function passesFilter(view: QueryView & View<'filter' | 'needsYouTypes'>): (session: SessionSummary) => boolean {
  const { inForce } = filterQuery(view);
  const fields = queryFields(view);
  const facts = inForce === null ? null : queryFacts(view);
  return (session) => inView(entityKey(session), view.filter.finished, view.finished, view.pendingDeletes) && (inForce === null || facts === null || matches(session, inForce, fields, facts));
}

/** Which of the slices the list is not told of a query reads, so the list draws again when one of them changes: the tabs, the tabs that run claude, and claude's statuses with the needs-you reasons and read marks. */
export interface QueryReads {
  tabs: boolean;
  running: boolean;
  statuses: boolean;
}

/** What the query in force reads beyond the slices that draw the list on their own (`QueryReads`). */
export function queryReads(view: View<'filter' | 'needsYouTypes'>): QueryReads {
  const terms = filterQuery(view).inForce?.parts.flat() ?? [];
  const isOne = (...values: string[]): boolean => terms.some((term) => term.field === 'is' && term.values.some((value) => values.includes(value.toLowerCase())));
  return { tabs: isOne('working', 'unfinished'), running: isOne('running'), statuses: isOne('asking') || terms.some((term) => term.field === 'status' || term.field === 'needs') };
}
