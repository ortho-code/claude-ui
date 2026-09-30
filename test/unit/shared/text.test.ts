import { describe, it, expect } from 'vitest';

import { withText } from '../../../src/shared/text';

// Main's own tests (test/unit/main/meta.test.ts) hold what meta.json ends up with for a note and a project's name; this holds what the window's checks rely on too: a new value, the given one untouched.
describe('withText', () => {
  it('trims a text, and a blank one removes the entry', () => {
    const texts = { a: 'one' };
    expect(withText(texts, 'b', '  two  ')).toEqual({ a: 'one', b: 'two' });
    expect(withText(texts, 'a', '   ')).toEqual({});
    expect(texts).toEqual({ a: 'one' });
  });
});
