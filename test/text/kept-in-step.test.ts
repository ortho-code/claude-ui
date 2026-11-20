import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { comments } from './comments';
import { linesBreaking, tracked } from './tracked';

/**
 * A comment saying "match X exactly", "same as Y" or "for the same reason as Z" is a bug report against the code: the two places it ties are held together by whoever remembers it (`CLAUDE.md` § Conventions).
 * So the code never says it, and the fix is one implementation both places use.
 * A quotation is left alone, since a comment may quote what such a comment used to say, as the history of a fix.
 * In a script only its comments are read, so words a person sees, such as a menu's label, may say it; a stylesheet, a workflow or a shell script is read whole.
 */
const TIES = /\bmatch(es)?\b[^.]{0,60}?\bexactly\b|\bsame as\b|\bfor the same reason as\b/i;

/** The line without what it quotes. */
const unquoted = (line: string): string => line.replace(/"[^"]*"|“[^”]*”/g, '');

const ties = (line: string): boolean => TIES.test(unquoted(line));

/** Each line of a file that ties two places together by saying so: of a script, each line of its comments. */
function tiesIn(file: string, text: string): string[] {
  if (!/\.(ts|mjs)$/.test(file)) return linesBreaking(file, text, ties);
  // Only a script holding one of the phrases somewhere is parsed: parsing every one runs the check close to its five-second limit, and a script without them has none in its comments either.
  if (!TIES.test(text)) return [];
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  return comments(source).flatMap(({ range }) => {
    const first = source.getLineAndCharacterOfPosition(range.pos).line;
    return text
      .slice(range.pos, range.end)
      .split('\n')
      .flatMap((line, at) => (ties(line) ? [`${file}:${first + at + 1}: ${line.trim()}`] : []));
  });
}

describe('kept in step', () => {
  it('no code says it is kept in step with another place', () => {
    // This file holds the phrases it looks for.
    const code = tracked(/\.(ts|mjs|css|yml|sh|toml)$/).filter(({ file }) => file !== 'test/text/kept-in-step.test.ts');
    expect(code.flatMap(({ file, text }) => tiesIn(file, text))).toEqual([]);
  });

  it('what counts as saying so, and what does not', () => {
    expect(tiesIn('a.css', '/* Match the session-row kebab exactly. */')).toEqual(['a.css:1: /* Match the session-row kebab exactly. */']);
    expect(tiesIn('a.ts', '// The same as the tab bar does.')).toHaveLength(1);
    expect(tiesIn('a.ts', '// Spaced for the same reason as the rows.')).toHaveLength(1);
    expect(tiesIn('a.css', '/* They had comments that said so ("Match the session-row kebab exactly"). */')).toEqual([]);
    expect(tiesIn('a.ts', '// By `projectRootExists`, which the headings use too.')).toEqual([]);
    expect(tiesIn('a.ts', "const label = 'Same as the panel';")).toEqual([]);
    expect(tiesIn('a.ts', "const label = 'Same as the panel'; // Kept the same as the toolbar's.")).toHaveLength(1);
    expect(tiesIn('a.ts', 'const a = 1;\n/**\n * Drawn the same as the rows.\n */\nconst b = 2;')).toEqual(['a.ts:3: * Drawn the same as the rows.']);
  });
});
