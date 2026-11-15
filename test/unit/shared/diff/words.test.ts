import { describe, expect, it } from 'vitest';
import type { DiffRow } from '../../../../src/shared/diff/types';
import { markWords, wordRanges } from '../../../../src/shared/diff/words';

const del = (text: string): DiffRow => ({ kind: 'del', old: 1, new: null, text });
const add = (text: string): DiffRow => ({ kind: 'add', old: null, new: 1, text });
const ctx = (text: string): DiffRow => ({ kind: 'context', old: 1, new: 1, text });

describe('wordRanges', () => {
  it('marks only the word that changed, punctuation before it being a token of its own', () => {
    expect(wordRanges('$total = $price * $qty;', '$total = $price * $count;')).toEqual([[[19, 22]], [[19, 24]]]);
  });

  it('gives two separate edits two spans, leaving the text between them unmarked', () => {
    const [a, b] = wordRanges('one two three four five', 'ONE two three four FIVE');
    expect(a).toEqual([
      [0, 3],
      [19, 23],
    ]);
    expect(b).toEqual([
      [0, 3],
      [19, 23],
    ]);
  });

  it('marks a pure insertion on one side only', () => {
    expect(wordRanges('call(a)', 'call(a, b)')).toEqual([[], [[6, 9]]]);
  });

  it('marks nothing for two equal lines', () => {
    expect(wordRanges('same', 'same')).toEqual([[], []]);
  });
});

describe('markWords', () => {
  it('pairs a run of removed rows with a run of added rows of the same length, row by row', () => {
    const rows = [ctx('keep'), del('a = 1'), del('b = 2'), add('a = 9'), add('b = 2;')];
    markWords(rows);
    expect(rows.map((r) => r.words)).toEqual([undefined, [[4, 5]], [], [[4, 5]], [[5, 6]]]);
  });

  it('marks nothing in runs of different lengths, whose rows need not be edits of each other', () => {
    const rows = [del('$total = $price * $qty;'), add('$subtotal = $price * $qty;'), add('$tax = $subtotal * 0.21;'), add('$total = $subtotal + $tax;')];
    markWords(rows);
    expect(rows.every((r) => r.words === undefined)).toBe(true);
  });
});
