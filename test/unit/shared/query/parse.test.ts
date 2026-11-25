import { describe, it, expect } from 'vitest';

import { parseQuery, type FieldSyntax, type Term, type Vocabulary } from '../../../../src/shared/query/parse';

const words = (...values: string[]): FieldSyntax => ({ kind: 'word', values: values.map((value) => ({ value })) });

const vocabulary: Vocabulary = new Map<string, FieldSyntax>([
  ['is', words('pinned', 'running', 'set-aside', 'working')],
  ['pr', { ...words('own', 'reviewing', 'other'), accepts: (value) => /^\d+$/.test(value) }],
  ['pr.state', words('merged', 'closed', 'open')],
  ['active', { kind: 'moment' }],
  ['group', { kind: 'text' }],
]);

/** A query's parts as `field:values` strings, `-` for negated, so a test reads like the query it checks. */
function shape(text: string): string[][] {
  const query = parseQuery(text, vocabulary);
  expect(query.problems).toEqual([]);
  const said = (term: Term): string => `${term.negated ? '-' : ''}${term.field === null ? '' : `${term.field}:${term.comparison === ':' ? '' : term.comparison}`}${term.values.join(',')}`;
  return query.parts.map((part) => part.map(said));
}

const messages = (text: string): string[] => parseQuery(text, vocabulary).problems.map((problem) => problem.message);

describe('parseQuery', () => {
  it('reads an empty query as one part without terms', () => {
    expect(parseQuery('   ', vocabulary)).toEqual({ parts: [[]], problems: [] });
  });

  it('reads an OR across kinds of filter as one part per side', () => {
    expect(shape('is:pinned OR is:running OR is:set-aside')).toEqual([['is:pinned'], ['is:running'], ['is:set-aside']]);
  });

  it('reads a - as not', () => {
    expect(shape('-is:pinned')).toEqual([['-is:pinned']]);
  });

  it('binds terms side by side tighter than OR', () => {
    expect(shape('-is:pinned is:running OR is:set-aside')).toEqual([['-is:pinned', 'is:running'], ['is:set-aside']]);
  });

  it('reads AND as a space', () => {
    expect(shape('is:pinned AND is:running')).toEqual([['is:pinned', 'is:running']]);
  });

  it('reads a comma as any of a field\'s values', () => {
    expect(shape('pr.state:merged,closed')).toEqual([['pr.state:merged,closed']]);
  });

  it('takes a value beyond a field\'s list where the field accepts it', () => {
    expect(shape('pr:123 pr:own')).toEqual([['pr:123', 'pr:own']]);
  });

  it('reads a quoted value with its spaces, without its quotes', () => {
    expect(shape('group:"Code reviews" "fix login"')).toEqual([['group:Code reviews', 'fix login']]);
  });

  it('reads comparisons on a moment', () => {
    expect(shape('active:<today-30d active:>=2026-11-01 active:today')).toEqual([['active:<today-30d', 'active:>=2026-11-01', 'active:today']]);
  });

  it('reads a word whose colon follows no field name as a free word', () => {
    expect(shape('12:30 fix')).toEqual([['12:30', 'fix']]);
  });

  it('reads a - or a colon inside quotes as part of the words, so a literal -text or text:text is found by quoting it', () => {
    expect(shape('"-text" "text:text" "is:pinned" -"-text"')).toEqual([['-text', 'text:text', 'is:pinned', '--text']]);
  });

  it('reads OR and AND only in capitals, so a lower-case or is a word', () => {
    expect(shape('this or that')).toEqual([['this', 'or', 'that']]);
  });

  it('places each term in the text, its - included', () => {
    const [part = []] = parseQuery('fix -is:pinned', vocabulary).parts;
    expect(part.map((term) => [term.from, term.to])).toEqual([
      [0, 3],
      [4, 14],
    ]);
  });

  it('names a field it does not know, a value a field does not take and an empty value, each at its place', () => {
    const query = parseQuery('foo:bar is:pin is:', vocabulary);
    expect(query.problems).toEqual([
      { from: 0, to: 7, message: 'There is no field foo:.' },
      { from: 8, to: 14, message: 'pin is not a value of is:.' },
      { from: 15, to: 18, message: 'is: needs a value.' },
    ]);
  });

  it('refuses a comparison on a field that is not a moment, and on several values', () => {
    expect(messages('is:>pinned active:<today,yesterday')).toEqual(['is: takes no >.', 'A < takes one value.']);
  });

  it('refuses a value that names no day', () => {
    expect(messages('active:<soon active:2026-02-30')).toEqual(['soon is not a date or a day such as today-7d.', '2026-02-30 is not a date or a day such as today-7d.']);
  });

  it('refuses parentheses, which wait for views', () => {
    expect(messages('(is:pinned OR is:running) fix')).toEqual(['Grouping with parentheses is not supported yet.', 'Grouping with parentheses is not supported yet.']);
  });

  it('refuses an OR without a term on each side', () => {
    expect(messages('OR is:pinned')).toEqual(['OR needs a term on each side.']);
    expect(messages('is:pinned OR')).toEqual(['OR needs a term on each side.']);
    expect(messages('is:pinned OR OR is:running')).toEqual(['OR needs a term on each side.']);
  });

  it('refuses an unclosed quote, a lone - and an empty phrase', () => {
    expect(messages('"fix login')).toEqual(['A quote is not closed.']);
    expect(messages('- ""')).toEqual(['A - needs a term after it.', 'An empty phrase finds nothing.']);
  });
});
