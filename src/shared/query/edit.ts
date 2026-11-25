import { parseQuery, type Query, type Term, type Vocabulary } from './parse';

/** Whether two terms say the same: the field, the comparison, the values in any order and without regard to capitals, and the `-`. */
function sameTerm(a: Term, b: Term): boolean {
  const values = (term: Term): string => term.values.map((value) => value.toLowerCase()).sort().join('\n');
  return a.field === b.field && a.comparison === b.comparison && a.negated === b.negated && values(a) === values(b);
}

/** The one term a text says, which the app's own terms always are. */
function termOf(text: string, vocabulary: Vocabulary): Term {
  const [term, ...rest] = parseQuery(text, vocabulary).parts.flat();
  if (term === undefined || rest.length > 0) throw new Error(`"${text}" is not one term`);
  return term;
}

/** A query's text again from its parts, each term as it was typed. */
function textOf(text: string, parts: readonly (readonly Term[])[], extra: readonly string[] = []): string {
  return parts.map((part) => [...part.map((term) => text.slice(term.from, term.to)), ...extra].join(' ')).join(' OR ');
}

/** Whether the query is empty: one part without terms, which every session meets. */
const isEmpty = (query: Query): boolean => query.parts.length === 1 && query.parts[0]?.length === 0;

/** Whether a query holds a term in every part, so the term is ANDed with all of it: what a pill shows on for. */
export function hasTerm(text: string, term: string, vocabulary: Vocabulary): boolean {
  const query = parseQuery(text, vocabulary);
  const wanted = termOf(term, vocabulary);
  return query.problems.length === 0 && !isEmpty(query) && query.parts.every((part) => part.some((each) => sameTerm(each, wanted)));
}

/**
 * The query with terms ANDed to all of it: added to every part, since without parentheses that is how AND reaches past an OR; a term a part has already is not added twice.
 * A query that does not read gets them at its end, where they read as they would in any query.
 */
export function withTerms(text: string, terms: readonly string[], vocabulary: Vocabulary): string {
  const query = parseQuery(text, vocabulary);
  if (query.problems.length > 0) return [text.trim(), ...terms].filter((part) => part !== '').join(' ');
  if (isEmpty(query)) return terms.join(' ');
  const wanted = terms.map((term) => ({ text: term, term: termOf(term, vocabulary) }));
  return query.parts.map((part) => textOf(text, [part], wanted.filter((each) => !part.some((own) => sameTerm(own, each.term))).map((each) => each.text))).join(' OR ');
}

/**
 * The query without the terms `drop` picks, taken from every part; a query that does not read is left as it is.
 * A part left with no terms meets every session, and so the whole query does: it comes back empty.
 */
export function withoutTerms(text: string, drop: (term: Term) => boolean, vocabulary: Vocabulary): string {
  const query = parseQuery(text, vocabulary);
  if (query.problems.length > 0) return text;
  const parts = query.parts.map((part) => part.filter((term) => !drop(term)));
  return parts.some((part) => part.length === 0) ? '' : textOf(text, parts);
}

/** The query without a term, from every part: a pill turned off. */
export function withoutTerm(text: string, term: string, vocabulary: Vocabulary): string {
  const unwanted = termOf(term, vocabulary);
  return withoutTerms(text, (each) => sameTerm(each, unwanted), vocabulary);
}
