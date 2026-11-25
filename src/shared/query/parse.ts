import { readMoment, type Comparison } from './moment';

/** One condition of a query: a field's value, or a free word or phrase when `field` is null. */
export interface Term {
  field: string | null;
  comparison: Comparison;
  /** Any of them holds; a comma in the query gives several. */
  values: string[];
  negated: boolean;
  /** Where the term stands in the query's text, its `-` included, end exclusive. */
  from: number;
  to: number;
}

/** Part of the text that does not read, and why, in words for the person who typed it. */
export interface Problem {
  from: number;
  to: number;
  message: string;
}

/** A parsed query: any part may hold, and a part holds when all its terms do; an empty query is one part without terms, which every session meets. */
export interface Query {
  parts: Term[][];
  problems: Problem[];
}

/** What the parser needs of a field: which values and comparisons read. */
export interface FieldSyntax {
  kind: 'word' | 'moment' | 'text';
  /** For a word field, the values it lists. */
  values?: readonly { value: string }[];
  /** For a word field, the values it takes beyond its list, such as a PR's number. */
  accepts?: (value: string) => boolean;
}

/** The fields a query can name, by name in lower case. */
export type Vocabulary = ReadonlyMap<string, FieldSyntax>;

interface Token {
  text: string;
  from: number;
  to: number;
}

const FIELD_NAME = /^[a-z][a-z.-]*$/i;
const COMPARISONS: readonly Comparison[] = ['<=', '>=', '<', '>'];

/** The text cut at white space outside quotes, an unclosed quote reported and running to the end. */
function tokensOf(text: string, problems: Problem[]): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < text.length) {
    if (/\s/.test(text.charAt(at))) {
      at++;
      continue;
    }
    const from = at;
    let quoted = false;
    while (at < text.length && (quoted || !/\s/.test(text.charAt(at)))) {
      if (text.charAt(at) === '"') quoted = !quoted;
      at++;
    }
    if (quoted) problems.push({ from, to: at, message: 'A quote is not closed.' });
    tokens.push({ text: text.slice(from, at), from, to: at });
  }
  return tokens;
}

/** Where a character first stands outside quotes, -1 for nowhere. */
function indexOutsideQuotes(text: string, char: string): number {
  let quoted = false;
  for (let at = 0; at < text.length; at++) {
    if (text.charAt(at) === '"') quoted = !quoted;
    else if (!quoted && text.charAt(at) === char) return at;
  }
  return -1;
}

/** The text cut at each comma outside quotes, each piece without its quotes. */
function valuesOf(text: string): string[] {
  const values: string[] = [];
  let rest = text;
  for (let comma = indexOutsideQuotes(rest, ','); comma !== -1; comma = indexOutsideQuotes(rest, ',')) {
    values.push(rest.slice(0, comma));
    rest = rest.slice(comma + 1);
  }
  values.push(rest);
  return values.map((value) => value.replaceAll('"', ''));
}

const problemAt = (token: Token, message: string): Problem => ({ from: token.from, to: token.to, message });

/** Why a value does not read for a field, or null when it does. */
function valueProblem(name: string, syntax: FieldSyntax, comparison: Comparison, values: readonly string[]): string | null {
  if (values.some((value) => value === '')) return `${name}: needs a value.`;
  if (comparison !== ':' && syntax.kind !== 'moment') return `${name}: takes no ${comparison}.`;
  if (comparison !== ':' && values.length > 1) return `A ${comparison} takes one value.`;
  for (const value of values) {
    if (syntax.kind === 'moment' && readMoment(value) === null) return `${value} is not a date or a day such as today-7d.`;
    if (syntax.kind === 'word' && !syntax.values?.some((listed) => listed.value === value.toLowerCase()) && !syntax.accepts?.(value)) return `${value} is not a value of ${name}:.`;
  }
  return null;
}

/** A token as a term, or the problem that keeps it from being one. */
function termOf(token: Token, vocabulary: Vocabulary): Term | Problem {
  if (token.text === '-') return problemAt(token, 'A - needs a term after it.');
  const negated = token.text.startsWith('-');
  const body = negated ? token.text.slice(1) : token.text;
  if (indexOutsideQuotes(body, '(') !== -1 || indexOutsideQuotes(body, ')') !== -1) return problemAt(token, 'Grouping with parentheses is not supported yet.');
  const place = { negated, from: token.from, to: token.to };
  const colon = indexOutsideQuotes(body, ':');
  const name = body.slice(0, Math.max(colon, 0));
  if (!FIELD_NAME.test(name)) {
    const word = body.replaceAll('"', '');
    return word === '' ? problemAt(token, 'An empty phrase finds nothing.') : { field: null, comparison: ':', values: [word], ...place };
  }
  const field = name.toLowerCase();
  const syntax = vocabulary.get(field);
  if (!syntax) return problemAt(token, `There is no field ${name}:.`);
  const rest = body.slice(colon + 1);
  const comparison = COMPARISONS.find((each) => rest.startsWith(each)) ?? ':';
  const values = valuesOf(comparison === ':' ? rest : rest.slice(comparison.length));
  const problem = valueProblem(name, syntax, comparison, values);
  return problem === null ? { field, comparison, values, ...place } : problemAt(token, problem);
}

/**
 * The query a text says, in GitHub's search syntax without parentheses: terms side by side must all hold, `AND` says the same, `OR` between terms for either, binding looser than AND, `-` before a term for not, a comma for any of a field's values, quotes around spaces.
 * A word that is no field's name before its colon, such as `12:30`, is a free word.
 */
export function parseQuery(text: string, vocabulary: Vocabulary): Query {
  const problems: Problem[] = [];
  const parts: Term[][] = [[]];
  let partStarted = false;
  let lastOr: Token | null = null;
  for (const token of tokensOf(text, problems)) {
    if (token.text === 'AND') continue;
    if (token.text === 'OR') {
      if (!partStarted) problems.push(problemAt(token, 'OR needs a term on each side.'));
      else parts.push([]);
      partStarted = false;
      lastOr = token;
      continue;
    }
    partStarted = true;
    const read = termOf(token, vocabulary);
    if ('message' in read) problems.push(read);
    else parts[parts.length - 1]?.push(read);
  }
  if (lastOr !== null && !partStarted) problems.push(problemAt(lastOr, 'OR needs a term on each side.'));
  return { parts: parts.filter((part, at) => part.length > 0 || at === 0), problems };
}
