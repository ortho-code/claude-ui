import { describe, it, expect } from 'vitest';

import { containsIgnoringCase } from '../../../../src/shared/query/contains';

describe('containsIgnoringCase', () => {
  it('finds a value without regard to capitals', () => {
    expect(containsIgnoringCase('Fix the Login page', 'login')).toBe(true);
    expect(containsIgnoringCase('Fix the Login page', 'logout')).toBe(false);
  });

  it('takes every character of the value as itself, never as a pattern', () => {
    expect(containsIgnoringCase('acme/app#12 (draft)', 'app#12 (d')).toBe(true);
    expect(containsIgnoringCase('acme/app', 'a.p')).toBe(false);
    expect(containsIgnoringCase('cost: $5 [est]', '$5 [est]')).toBe(true);
  });

  it('answers the same once more values have passed through it than it keeps patterns for', () => {
    for (let at = 0; at < 100; at++) containsIgnoringCase('text', `value ${at}`);
    expect(containsIgnoringCase('Value 3 here', 'value 3')).toBe(true);
  });
});
