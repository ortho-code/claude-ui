import type { SessionSummary } from '../types';
import { containsIgnoringCase } from './contains';
import type { QueryFacts } from './facts';
import type { FieldRegistry } from './field';
import type { Query, Term } from './parse';

/** Whether a term holds before its `-`: a free word in one text of one word source, a field's term for any of its values. */
function holds(session: SessionSummary, term: Term, registry: FieldRegistry, facts: QueryFacts): boolean {
  if (term.field === null) {
    const word = term.values[0] ?? '';
    return registry.words.some((source) => source.texts(session, facts).some((text) => (source.matches ?? containsIgnoringCase)(text, word)));
  }
  const field = registry.fields.get(term.field);
  return field !== undefined && term.values.some((value) => field.holds(session, value, term.comparison, facts));
}

/** Whether a session meets a query: any of its parts, each with all its terms. */
export function matches(session: SessionSummary, query: Query, registry: FieldRegistry, facts: QueryFacts): boolean {
  return query.parts.some((part) => part.every((term) => holds(session, term, registry, facts) !== term.negated));
}
