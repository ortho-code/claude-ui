import type { DiffRow } from './types';

/** Past this many differing tokens on either side, a pair gets one span over its whole differing middle rather than a table that size, as a minified line would need. */
const MAX_TOKENS = 400;

type Token = [start: number, text: string];

/** A line as words, runs of whitespace, and single punctuation characters, so `->` and `.` never glue onto a word. */
function tokenize(line: string): Token[] {
  return [...line.matchAll(/[\p{L}\p{N}_]+|\s+|./gu)].map((match) => [match.index, match[0]]);
}

/** One span from a run of tokens' first character to its last, or none for no tokens. */
function whole(tokens: Token[]): [number, number][] {
  const first = tokens[0];
  const last = tokens.at(-1);
  return first && last ? [[first[0], last[0] + last[1].length]] : [];
}

/** Add a token to a side's spans, joining it onto a span it touches, so adjacent changed tokens read as one change. */
function push(spans: [number, number][], [start, text]: Token): void {
  const last = spans.at(-1);
  if (last?.[1] === start) last[1] = start + text.length;
  else spans.push([start, start + text.length]);
}

/** The longest common subsequence of two token runs, as a table read from the end: `table[i][j]` is its length over `a[i..]` and `b[j..]`. */
function lcsTable(a: Token[], b: Token[]): Uint16Array[] {
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i]![1] === b[j]![1] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  return table;
}

/**
 * The character ranges where two lines differ, one list per line, by tokens: the common start and end are trimmed first, then the middle is compared token by token, so a line with two separate edits gets two spans rather than one over the untouched text between them.
 */
export function wordRanges(a: string, b: string): [[number, number][], [number, number][]] {
  const ta = tokenize(a);
  const tb = tokenize(b);
  let pre = 0;
  while (pre < ta.length && pre < tb.length && ta[pre]![1] === tb[pre]![1]) pre++;
  let suf = 0;
  while (suf < ta.length - pre && suf < tb.length - pre && ta[ta.length - 1 - suf]![1] === tb[tb.length - 1 - suf]![1]) suf++;
  const am = ta.slice(pre, ta.length - suf);
  const bm = tb.slice(pre, tb.length - suf);
  if (!am.length || !bm.length || am.length > MAX_TOKENS || bm.length > MAX_TOKENS) return [whole(am), whole(bm)];
  const table = lcsTable(am, bm);
  const aOut: [number, number][] = [];
  const bOut: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < am.length && j < bm.length) {
    if (am[i]![1] === bm[j]![1]) {
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) push(aOut, am[i++]!);
    else push(bOut, bm[j++]!);
  }
  while (i < am.length) push(aOut, am[i++]!);
  while (j < bm.length) push(bOut, bm[j++]!);
  return [aOut, bOut];
}

/**
 * Mark the words that differ in a hunk's rows, in place: a run of removed rows followed by a run of added ones pairs row by row, the first with the first, only when the two runs are the same length.
 * Runs of different lengths get no marks, since their rows need not be edits of each other and marks there are noise (decided 2026-11-14).
 */
export function markWords(rows: DiffRow[]): void {
  let at = 0;
  while (at < rows.length) {
    if (rows[at]!.kind !== 'del') {
      at++;
      continue;
    }
    const dels = at;
    while (at < rows.length && rows[at]!.kind === 'del') at++;
    const adds = at;
    while (at < rows.length && rows[at]!.kind === 'add') at++;
    if (adds - dels !== at - adds) continue;
    for (let k = 0; k < adds - dels; k++) {
      const removed = rows[dels + k]!;
      const added = rows[adds + k]!;
      [removed.words, added.words] = wordRanges(removed.text, added.text);
    }
  }
}
