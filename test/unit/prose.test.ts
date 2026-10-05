import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Prose here is never hard-wrapped: a sentence carried onto the next line makes the raw text wrong where the rendered one looks right, and every later edit reflows lines that did not change.
 * This holds that for every comment in the code and every paragraph of the docs: no line ends in the middle of a sentence that goes on in the next one.
 * It reads prose rather than parsing it, so what it does not call wrapped is spelled out below: a line that ends a sentence, a list item, a tag, a fence, a table, a heading, an indented sample, a section marker, a comment after code.
 */

const root = fileURLToPath(new URL('../../', import.meta.url));

/** A line ends a sentence on `.`, `?`, `!`, `:`, `;` or `)`, perhaps followed by a closing quote, bracket or emphasis (`….**`). */
const ENDS = /[.?!:;)]["'`)*_]*$/;
/** Not prose to begin with: a list item, a tag, a fence or table, markup, a section marker (`--- X ---`), a shebang, a lint directive, an indented sample. */
const NOT_PROSE = /^\s*([-*+]\s|\d+\.\s|@|```|\||#|<|\{|\}|\[|-{2,}|!|eslint-)|^ {2,}\S/;
/** What never carries on a sentence from the line before: a blank line, a list item, a tag, a fence or an indented sample. */
const BREAKS = /^\s*([-*+]\s|\d+\.\s|@|```|$)|^ {2,}\S/;

/** One line of a paragraph: its number in the file, from 1, and its words without the comment's marks. */
interface Line {
  line: number;
  text: string;
}

/** The lines of one paragraph that end in the middle of a sentence the next line goes on with; a line after an unfinished sentence carries it on whatever it starts with (`[0, 0] and does nothing`), unless it is one of BREAKS. */
function wrapped(paragraph: Line[]): Line[] {
  const prose: boolean[] = [];
  paragraph.forEach(({ text }, i) => {
    const carried = i > 0 && prose[i - 1] && !ENDS.test(paragraph[i - 1].text.trimEnd()) && !BREAKS.test(text);
    prose.push((text.trim() !== '' && !NOT_PROSE.test(text)) || carried);
  });
  return paragraph.filter(({ text }, i) => i < paragraph.length - 1 && prose[i] && prose[i + 1] && !ENDS.test(text.trimEnd()));
}

/** Every comment in TypeScript or JavaScript, from the compiler's parse: a run of `//` lines alone on consecutive lines is one, a block comment another, and a comment after code its own. */
function scriptComments(text: string): Line[][] {
  const source = ts.createSourceFile('file.ts', text, ts.ScriptTarget.Latest, true);
  const ranges = new Map<number, ts.CommentRange>();
  const visit = (node: ts.Node): void => {
    for (const range of [...(ts.getLeadingCommentRanges(text, node.pos) ?? []), ...(ts.getTrailingCommentRanges(text, node.end) ?? [])]) ranges.set(range.pos, range);
    ts.forEachChild(node, visit);
  };
  visit(source);
  for (const range of ts.getLeadingCommentRanges(text, source.endOfFileToken.pos) ?? []) ranges.set(range.pos, range);
  const lineOf = (pos: number): number => source.getLineAndCharacterOfPosition(pos).line + 1;
  const groups: Line[][] = [];
  let run: Line[] | null = null;
  for (const range of [...ranges.values()].sort((a, b) => a.pos - b.pos)) {
    const body = text.slice(range.pos, range.end);
    const line = lineOf(range.pos);
    if (range.kind === ts.SyntaxKind.SingleLineCommentTrivia) {
      const entry = { line, text: body.replace(/^\/\/\s?/, '') };
      const alone = text.slice(text.lastIndexOf('\n', range.pos - 1) + 1, range.pos).trim() === '';
      if (!alone) {
        groups.push([entry]);
        run = null;
      } else if (run?.at(-1)?.line === line - 1) run.push(entry);
      else groups.push((run = [entry]));
    } else {
      run = null;
      groups.push(body.split('\n').map((part, i) => ({ line: line + i, text: part.replace(/^\s*\/\*\*?\s?|\s*\*\/$|^\s*\*\s?/g, '') })));
    }
  }
  return groups;
}

/** Every CSS block comment, its lines without the comment's marks. */
function styleComments(text: string): Line[][] {
  return [...text.matchAll(/\/\*([\s\S]*?)\*\//g)].map((match) => {
    const line = text.slice(0, match.index).split('\n').length;
    return match[1].split('\n').map((part, i) => ({ line: line + i, text: part.replace(/^\s*\*?\s?/, '') }));
  });
}

/** Every run of `#` comment lines, as YAML, shell and TOML write them. */
function hashComments(text: string): Line[][] {
  const groups: Line[][] = [];
  let run: Line[] | null = null;
  text.split('\n').forEach((raw, i) => {
    const match = /^\s*#\s?(.*)$/.exec(raw);
    if (!match) {
      run = null;
      return;
    }
    if (!run) groups.push((run = []));
    run.push({ line: i + 1, text: match[1] });
  });
  return groups;
}

/** Every paragraph of markdown prose, outside fences, tables and headings; a list item keeps its marker, so it is never the tail of the line before. */
function markdownParagraphs(text: string): Line[][] {
  const groups: Line[][] = [];
  let fence = false;
  let run: Line[] | null = null;
  text.split('\n').forEach((raw, i) => {
    if (/^\s*```/.test(raw)) fence = !fence;
    if (fence || !raw.trim() || /^\s*(#|\||<|```)/.test(raw)) {
      run = null;
      return;
    }
    if (!run) groups.push((run = []));
    run.push({ line: i + 1, text: raw });
  });
  return groups;
}

/** The paragraphs of a file whose prose this holds, by its kind; none for any other file. */
function paragraphsOf(file: string, text: string): Line[][] {
  const ext = extname(file);
  if (ext === '.ts' || ext === '.mjs') return scriptComments(text);
  if (ext === '.css') return styleComments(text);
  if (ext === '.md') return markdownParagraphs(text);
  if (ext === '.yml' || ext === '.sh' || ext === '.toml') return hashComments(text);
  return [];
}

/** Each wrapped line of a file, as `file:line: text`. */
function wrappedIn(file: string, text: string): string[] {
  return paragraphsOf(file, text).flatMap((paragraph) => wrapped(paragraph).map(({ line, text: words }) => `${file}:${line}: ${words.trim()}`));
}

describe('prose', () => {
  it('wraps no sentence across lines, in any comment or doc', () => {
    // Every file git tracks whose kind paragraphsOf reads, so nothing built, installed or ignored.
    const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter((file) => /\.(ts|mjs|css|md|yml|sh|toml)$/.test(file));
    expect(files.flatMap((file) => wrappedIn(file, readFileSync(join(root, file), 'utf8')))).toEqual([]);
  });

  describe('what counts as wrapped', () => {
    it('a sentence carried on to the next line of a comment, whatever that line starts with', () => {
      expect(wrappedIn('a.ts', '// A sentence carried\n// on to the next line.\n')).toEqual(['a.ts:1: A sentence carried']);
      expect(wrappedIn('a.ts', '// Without it that clamp reads\n// [0, 0] and does nothing.\n')).toEqual(['a.ts:1: Without it that clamp reads']);
      expect(wrappedIn('a.ts', '/**\n * A docblock carried\n * on.\n */\nconst a = 1;\n')).toEqual(['a.ts:2: A docblock carried']);
      expect(wrappedIn('a.css', '/* A rule\n   explained. */\n')).toEqual(['a.css:1: A rule']);
      expect(wrappedIn('a.md', 'A paragraph carried\non to the next line.\n')).toEqual(['a.md:1: A paragraph carried']);
    });

    it('not one sentence per line, nor a sentence ending in emphasis', () => {
      expect(wrappedIn('a.ts', '// One sentence.\n// Another: with a colon.\n// And a third (in brackets)\n')).toEqual([]);
      expect(wrappedIn('a.md', '**A lead-in sentence.**\nThe paragraph under it.\n')).toEqual([]);
    });

    it('not a list, a tag, a sample, a fence or a section marker', () => {
      expect(wrappedIn('a.md', '- one item,\n- another item,\n- and a last one\n')).toEqual([]);
      expect(wrappedIn('a.ts', '/**\n * What it does\n * @param x the thing\n */\nconst a = 1;\n')).toEqual([]);
      expect(wrappedIn('a.ts', '// Run it as\n//   npm run this -- that\n//   npm run the other\n')).toEqual([]);
      expect(wrappedIn('a.md', '```\nsome code\nthat goes on\n```\n')).toEqual([]);
      expect(wrappedIn('a.ts', '// --- A section ---\n// Its first sentence.\n')).toEqual([]);
    });

    it('not two comments that each sit after code', () => {
      expect(wrappedIn('a.ts', 'const a = 1; // a note on this line\nconst b = 2; // and one on this\n')).toEqual([]);
    });
  });
});
