import { describe, expect, it } from 'vitest';
import { linesBreaking, tracked } from './tracked';

/** An ESLint directive that switches rules off, as a comment opens with it: `eslint-disable`, `-line` or `-next-line`. */
const DISABLE = /^\s*(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?\b/;

/** The reason ESLint lets a directive carry, after ` -- `. */
const REASON = /\s--\s+\S/;

describe('suppressions', () => {
  it('give the reason a rule is switched off, after the directive', () => {
    const missing = tracked(/\.(?:ts|mjs)$/).flatMap(({ file, text }) => linesBreaking(file, text, (line) => DISABLE.test(line) && !REASON.test(line)));
    expect(missing).toEqual([]);
  });
});
