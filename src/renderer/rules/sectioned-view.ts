import { matches } from '../../shared/query/evaluate';
import type { QueryFacts } from '../../shared/query/facts';
import type { FieldRegistry } from '../../shared/query/field';
import { parseQuery, type Query } from '../../shared/query/parse';
import { SORTS, type SortName } from '../../shared/query/sorts';
import type { SessionSummary } from '../../shared/types';
import { entityKey } from './sessions';

/**
 * A VIEW WITH SECTIONS, pure (docs/architecture/session-list.md § The review): sessions sectioned by queries, each section with its own order.
 */

/**
 * What a row says under its title: `time`, when it was last active, its model and its marks; `state`, a line per state it is in, as its dot's tooltip lists them, a reason without "Needs you — " since its section's heading says why it is there, the first beside its marks; `compact`, only where it sits, every state in its tooltip.
 */
export type RowLines = 'time' | 'state' | 'compact';

/**
 * One section: its id and name, which its heading says, the query that puts a session in it, the order of its rows, and what each row says under its title.
 * `empty` is what it says while it has no rows; `inProject` shows it only while the view shows one project, for a section of what is elsewhere, which the query alone cannot tell from a section with nothing in it.
 */
export interface ViewSection {
  id: string;
  name: string;
  query: string;
  sort: SortName;
  lines: RowLines;
  empty?: string;
  inProject?: boolean;
}

/** A view's sections in the order they are shown, a session in the first whose query holds, and the query every section's rows also meet. */
export interface SectionedView {
  id: string;
  name: string;
  shared: string;
  sections: readonly ViewSection[];
}

/** A section as shown: its rows, under what its definition says. */
export interface ShownSection extends Omit<ViewSection, 'query' | 'sort'> {
  rows: SessionSummary[];
}

/** One of a view's own queries, read; one that does not read is a mistake in the app, so it throws rather than showing nothing. */
function viewQuery(view: SectionedView, text: string, fields: FieldRegistry): Query {
  const query = parseQuery(text, fields.fields);
  if (query.problems.length > 0) throw new Error(`The ${view.name} view's query "${text}" does not read: ${query.problems.map((problem) => problem.message).join(' ')}`);
  return query;
}

/** The sessions out of `sessions` that meet the view's shared query, whichever section takes them, if any. */
export function offeredBy(view: SectionedView, sessions: readonly SessionSummary[], fields: FieldRegistry, facts: QueryFacts): SessionSummary[] {
  const shared = viewQuery(view, view.shared, fields);
  return sessions.filter((session) => matches(session, shared, fields, facts));
}

/** Each section's rows out of `sessions`, a session in the first section whose query holds, each section in its own order; a section with none is still there. */
export function sectionsOf(view: SectionedView, sessions: readonly SessionSummary[], fields: FieldRegistry, facts: QueryFacts): ShownSection[] {
  return sectioned(view, offeredBy(view, sessions, fields, facts), fields, facts);
}

/** `sectionsOf` over sessions already known to meet the view's shared query (`offeredBy`). */
export function sectioned(view: SectionedView, offered: readonly SessionSummary[], fields: FieldRegistry, facts: QueryFacts): ShownSection[] {
  const shown = new Set<string>();
  return view.sections.map((section) => {
    const query = viewQuery(view, section.query, fields);
    const rows = offered.filter((session) => !shown.has(entityKey(session)) && matches(session, query, fields, facts)).sort((a, b) => SORTS[section.sort](a, b, facts));
    for (const session of rows) shown.add(entityKey(session));
    return { id: section.id, name: section.name, lines: section.lines, empty: section.empty, inProject: section.inProject, rows };
  });
}
