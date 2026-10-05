import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Prose here is one sentence per line: a sentence carried onto the next line makes the raw text wrong where the rendered one looks right, and every later edit reflows lines that did not change.
 * A paragraph on one line is the same mistake the other way round: an edit to one of its sentences changes the line that holds them all.
 * This holds both for every comment in the code and every paragraph of the docs: no line ends in the middle of a sentence that goes on in the next one, and no line holds two.
 * It reads prose rather than parsing it, so what it does not call wrapped is spelled out below: a line that ends a sentence, a list item, a tag, a fence, a table, a heading, an indented sample, a section marker, a comment after code.
 * What it does not read for sentences is spelled out with `crowdedIn`.
 */

const root = fileURLToPath(new URL('../../', import.meta.url));

/**
 * A line ends a sentence on `.`, `?` or `!`, perhaps followed by a closing quote, bracket or emphasis (`….**`, `….)`).
 * A colon, a semicolon or a closing bracket alone does not: the sentence goes on after it, so a line ending in one before more prose is wrapped.
 */
const ENDS = /[.?!]["'`)*_]*$/;
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

/** Abbreviations whose full stop ends no sentence. */
const ABBREVIATIONS = /\b(e\.g|i\.e|vs|etc|cf|incl)\./g;
/** Where a sentence may end inside a line: `.`, `?` or `!`, perhaps followed by a closing quote, bracket or emphasis, then a space. */
const SENTENCE_END = /[.?!]["')*_`]*\s+/g;
/** What a sentence opens with: a capital, a digit, a quote, a bracket, emphasis or a code span. */
const OPENS = /[A-Z\d"'(*`[]/;

/**
 * Whether the text after `end` opens a new sentence.
 * A lowercase word does too (`macOS`, `xterm`, `text-box`), unless the end closed a quotation, which makes it one inside a sentence (`"… come back?" was`).
 */
function opensSentence(end: string, next: string): boolean {
  return OPENS.test(next) || (/[a-z]/.test(next) && !/["']/.test(end));
}

/** How many sentences end before a line's last one; code spans, link targets and abbreviations end none. */
function sentenceEnds(text: string): number {
  const masked = text
    .replace(/`[^`]*`/g, (span) => 'x'.repeat(span.length))
    .replace(/\]\([^)]*\)/g, (target) => 'x'.repeat(target.length))
    .replace(ABBREVIATIONS, (abbreviation) => `${abbreviation.slice(0, -1)}x`);
  return [...masked.matchAll(SENTENCE_END)].filter((end) => opensSentence(end[0], text.charAt(end.index + end[0].length))).length;
}

/** Not read for sentences: a table, a heading, markup, a tag, a fence, a lint directive, a shebang, a section marker (`--- X ---`), code (`{`, `}`). */
const NOT_SENTENCES = /^\s*(\||#|<|@|```|eslint-|!|\{|\}|-{2,}\s)/;
/** An indented sample in a comment; in markdown an indented line goes on a list item, so it is read. */
const SAMPLE = /^ {2,}\S/;

/** Each line of a file holding more than one sentence, as `file:line: text`; a list item is read like any other line. */
function crowdedIn(file: string, text: string): string[] {
  const samples = extname(file) !== '.md';
  return paragraphsOf(file, text).flatMap((paragraph) =>
    paragraph
      .filter(({ text: words }) => !NOT_SENTENCES.test(words) && !(samples && SAMPLE.test(words)) && sentenceEnds(words) > 0)
      .map(({ line, text: words }) => `${file}:${line}: ${words.trim()}`),
  );
}

/** Every file git tracks whose kind paragraphsOf reads, so nothing built, installed or ignored, with its text. */
function trackedProse(): { file: string; text: string }[] {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((file) => /\.(ts|mjs|css|md|yml|sh|toml)$/.test(file))
    .map((file) => ({ file, text: readFileSync(join(root, file), 'utf8') }));
}

describe('prose', () => {
  it('wraps no sentence across lines, in any comment or doc', () => {
    expect(trackedProse().flatMap(({ file, text }) => wrappedIn(file, text))).toEqual([]);
  });

  it('puts no two sentences on one line, in any comment or doc', () => {
    expect(trackedProse().flatMap(({ file, text }) => crowdedIn(file, text))).toEqual([]);
  });

  describe('what counts as two sentences on a line', () => {
    it('a sentence after another, whatever it opens with', () => {
      expect(crowdedIn('a.ts', '// One sentence. Another.\n')).toEqual(['a.ts:1: One sentence. Another.']);
      expect(crowdedIn('a.ts', '// It is frameless. macOS keeps its own.\n')).toEqual(['a.ts:1: It is frameless. macOS keeps its own.']);
      expect(crowdedIn('a.css', '/* A rule. `.x` says why. */\n')).toEqual(['a.css:1: A rule. `.x` says why.']);
      expect(crowdedIn('a.md', '- An item. Its reason.\n')).toEqual(['a.md:1: - An item. Its reason.']);
      expect(crowdedIn('a.md', '**A lead-in.** The paragraph.\n')).toEqual(['a.md:1: **A lead-in.** The paragraph.']);
    });

    it('not an abbreviation, a code span, a quotation, a table or a sample', () => {
      expect(crowdedIn('a.ts', '// One case, e.g. this one, i.e. a single sentence.\n')).toEqual([]);
      expect(crowdedIn('a.ts', '// Run `npm test. Then` once.\n')).toEqual([]);
      expect(crowdedIn('a.md', 'It asked "come back?" and was right.\n')).toEqual([]);
      expect(crowdedIn('a.md', '| a | One. Two. |\n')).toEqual([]);
      expect(crowdedIn('a.ts', '// Run it as\n//   npm run a. Then b\n')).toEqual([]);
    });
  });

  describe('what counts as wrapped', () => {
    it('a sentence carried on to the next line of a comment, whatever that line starts with', () => {
      expect(wrappedIn('a.ts', '// A sentence carried\n// on to the next line.\n')).toEqual(['a.ts:1: A sentence carried']);
      expect(wrappedIn('a.ts', '// Without it that clamp reads\n// [0, 0] and does nothing.\n')).toEqual(['a.ts:1: Without it that clamp reads']);
      expect(wrappedIn('a.ts', '/**\n * A docblock carried\n * on.\n */\nconst a = 1;\n')).toEqual(['a.ts:2: A docblock carried']);
      expect(wrappedIn('a.css', '/* A rule\n   explained. */\n')).toEqual(['a.css:1: A rule']);
      expect(wrappedIn('a.md', 'A paragraph carried\non to the next line.\n')).toEqual(['a.md:1: A paragraph carried']);
    });

    it('a sentence that goes on after a colon, a semicolon or a bracket at the end of a line', () => {
      expect(wrappedIn('a.ts', '// One rule, pure and tested:\n// without a cwd, the folder itself.\n')).toEqual(['a.ts:1: One rule, pure and tested:']);
      expect(wrappedIn('a.css', '/* It can shrink;\n   the marks never do. */\n')).toEqual(['a.css:1: It can shrink;']);
      expect(wrappedIn('a.md', 'Expand it (upward)\nto a list.\n')).toEqual(['a.md:1: Expand it (upward)']);
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
