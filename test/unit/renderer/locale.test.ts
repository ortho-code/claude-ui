import { describe, it, expect } from 'vitest';

import { firstWeekday, languageOf } from '../../../src/renderer/locale';

describe('the language the app formats in', () => {
  it("is the setting's, or the window's own while the setting names none", () => {
    expect(languageOf('en-GB', 'en-US')).toBe('en-GB');
    expect(languageOf('', 'en-US')).toBe('en-US');
  });

  it('starts the weeks on its own first day, Sunday counted as 0', () => {
    expect(firstWeekday('en-GB')).toBe(1);
    expect(firstWeekday('nl-NL')).toBe(1);
    expect(firstWeekday('en-US')).toBe(0);
    // A tag can name its first day itself.
    expect(firstWeekday('en-US-u-fw-mon')).toBe(1);
  });
});
