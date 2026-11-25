import type { SessionSummary } from '../types';
import type { QueryFacts } from './facts';
import type { Comparison } from './moment';
import type { FieldSyntax } from './parse';

/** One value a word field lists, with what it means in the help card's words. */
export interface FieldValue {
  value: string;
  words: string;
}

/** A field a query can name: how it reads, what it means, and whether a session holds one of its values. */
export interface Field extends FieldSyntax {
  name: string;
  /** What the field asks, one line for the help card. */
  words: string;
  values?: readonly FieldValue[];
  holds(session: SessionSummary, value: string, comparison: Comparison, facts: QueryFacts): boolean;
}

/** A text of a session that free words search: each word must be in one text of one source. */
export interface WordSource {
  id: string;
  texts(session: SessionSummary, facts: QueryFacts): readonly string[];
  /** Whether a word matches one of its texts, without regard to capitals; anywhere in it when left out. */
  matches?(text: string, word: string): boolean;
}

/** Every field by its name in lower case, which is also what the parser reads, and every text free words search. */
export interface FieldRegistry {
  fields: ReadonlyMap<string, Field>;
  words: readonly WordSource[];
}

/** One value of a word field: what it means, and whether a session holds it. */
export interface WordValue {
  words: string;
  holds(session: SessionSummary, facts: QueryFacts): boolean;
}

/** A field of listed words, each with its own test; a value it does not list holds for no session. */
export function wordField(name: string, words: string, table: Readonly<Record<string, WordValue>>): Field {
  return {
    name,
    words,
    kind: 'word',
    values: Object.entries(table).map(([value, each]) => ({ value, words: each.words })),
    holds: (session, value, _comparison, facts) => table[value.toLowerCase()]?.holds(session, facts) ?? false,
  };
}
