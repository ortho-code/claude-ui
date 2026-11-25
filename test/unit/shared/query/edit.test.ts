import { describe, it, expect } from 'vitest';

import { hasTerm, withoutTerm, withoutTerms, withTerms } from '../../../../src/shared/query/edit';
import { coreFields } from '../../../../src/shared/query/fields';
import { bundledNeedsYou } from '../../../renderer/support/needs-you';

const vocabulary = coreFields(bundledNeedsYou()).fields;

describe('hasTerm', () => {
  it('holds for a term in every part, without regard to capitals or the order of its values', () => {
    expect(hasTerm('fix is:pinned', 'is:pinned', vocabulary)).toBe(true);
    expect(hasTerm('a IS:Pinned OR b is:pinned', 'is:pinned', vocabulary)).toBe(true);
    expect(hasTerm('pr.state:closed,merged', 'pr.state:merged,closed', vocabulary)).toBe(true);
  });

  it('does not hold for a term in only some parts, its negation, an empty query or one that does not read', () => {
    expect(hasTerm('a is:pinned OR b', 'is:pinned', vocabulary)).toBe(false);
    expect(hasTerm('-is:pinned', 'is:pinned', vocabulary)).toBe(false);
    expect(hasTerm('', 'is:pinned', vocabulary)).toBe(false);
    expect(hasTerm('is:pinned is:pin', 'is:pinned', vocabulary)).toBe(false);
  });
});

describe('withTerms', () => {
  it('writes a term into an empty query, and after the terms of a query of one part, as typed', () => {
    expect(withTerms('', ['is:pinned'], vocabulary)).toBe('is:pinned');
    expect(withTerms('Fix  "the login"', ['is:pinned'], vocabulary)).toBe('Fix "the login" is:pinned');
  });

  it('ANDs a term with all of an OR by adding it to every part, never twice to one', () => {
    expect(withTerms('a OR b is:pinned', ['is:pinned'], vocabulary)).toBe('a is:pinned OR b is:pinned');
  });

  it('puts the terms at the end of a query that does not read', () => {
    expect(withTerms('is:pin', ['has:pr'], vocabulary)).toBe('is:pin has:pr');
  });
});

describe('withoutTerm and withoutTerms', () => {
  it('takes a term out of every part', () => {
    expect(withoutTerm('a is:pinned OR b is:pinned', 'is:pinned', vocabulary)).toBe('a OR b');
  });

  it('empties the query when a part is left with no terms, since that part meets every session', () => {
    expect(withoutTerm('is:pinned OR b is:pinned', 'is:pinned', vocabulary)).toBe('');
  });

  it('takes out the terms picked, here the dates, keeping the rest as typed', () => {
    expect(withoutTerms('fix active:>=today-7d -active:today', (term) => term.field === 'active' && !term.negated, vocabulary)).toBe('fix -active:today');
  });

  it('leaves a query that does not read as it is', () => {
    expect(withoutTerm('is:pinned is:pin', 'is:pinned', vocabulary)).toBe('is:pinned is:pin');
  });
});
