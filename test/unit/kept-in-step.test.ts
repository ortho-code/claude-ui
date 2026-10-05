import { describe, expect, it } from 'vitest';
import { linesBreaking, tracked } from './tracked';

/**
 * A comment saying "match X exactly", "same as Y" or "for the same reason as Z" is a bug report against the code: the two places it ties are held together by whoever remembers it (`CLAUDE.md` § Conventions).
 * So the code never says it, and the fix is one implementation both places use.
 * A quotation is left alone, since a comment may quote what such a comment used to say, as the history of a fix.
 */
const TIES = /\bmatch(es)?\b[^.]{0,60}?\bexactly\b|\bsame as\b|\bfor the same reason as\b/i;

/** The line without what it quotes. */
const unquoted = (line: string): string => line.replace(/"[^"]*"|“[^”]*”/g, '');

/** Each line of a file that ties two places together by saying so. */
function tiesIn(file: string, text: string): string[] {
  return linesBreaking(file, text, (line) => TIES.test(unquoted(line)));
}

describe('kept in step', () => {
  it('no code says it is kept in step with another place', () => {
    // This file holds the phrases it looks for.
    const code = tracked(/\.(ts|mjs|css|yml|sh|toml)$/).filter(({ file }) => file !== 'test/unit/kept-in-step.test.ts');
    expect(code.flatMap(({ file, text }) => tiesIn(file, text))).toEqual([]);
  });

  it('what counts as saying so, and what does not', () => {
    expect(tiesIn('a.css', '/* Match the session-row kebab exactly. */')).toEqual(['a.css:1: /* Match the session-row kebab exactly. */']);
    expect(tiesIn('a.ts', '// The same as the tab bar does.')).toHaveLength(1);
    expect(tiesIn('a.ts', '// Spaced for the same reason as the rows.')).toHaveLength(1);
    expect(tiesIn('a.css', '/* They had comments that said so ("Match the session-row kebab exactly"). */')).toEqual([]);
    expect(tiesIn('a.ts', '// By `projectRootExists`, which the headings use too.')).toEqual([]);
  });
});
