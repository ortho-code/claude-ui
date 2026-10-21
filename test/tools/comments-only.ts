import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import MarkdownIt from 'markdown-it';
import ts from 'typescript';

/**
 * NOT A CHECK: a tool, for a change meant to touch nothing but comments, which proves it did: `npm run comments:prove [-- <ref>]`.
 * Every file changed since `<ref>` (HEAD unless named), as it stands in the working tree, is compared with that file at `<ref>`.
 * TypeScript and JavaScript are each printed back from the compiler's parse with every comment dropped, and must print the same and have the same tokens; CSS has every comment taken out and its whitespace collapsed; markdown is rendered, its whitespace collapsed, since a line break inside a paragraph shows as a space.
 * So "the same" is the same up to layout: what this cannot tell from a comment's change is a change of whitespace in code, which the diff shows and a comment's change has no business making.
 * A script's directive comments are code to the tool that reads them, so a script must also keep each of those as it was, where it was among the code, with what it covers (DIRECTIVE).
 * Passing is still no reason to skip the linter, whose rules read other comments too: one that fills an empty block, or says a case falls through.
 * A file it has no way to read, a new file, a deleted one and a renamed one each fail the proof, since none of them is a comment's change.
 * Exits non-zero unless every changed file is the same.
 */

const markdown = new MarkdownIt();
const printer = ts.createPrinter({ removeComments: true });

/**
 * A line of a comment holding a directive that a tool here takes from it: ESLint's (`eslint-disable…`, `eslint-enable`, a `/* eslint … *\/` or `/* global … *\/` setting), TypeScript's (`@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`, `@ts-check`, `/// <reference … />`), esbuild's annotations anywhere in a comment (`@__PURE__`, `#__PURE__`, `@__NO_SIDE_EFFECTS__`, `@__KEY__`) and the legal comments it keeps in the bundle (`/*!`, `//!`, `@license`, `@preserve`), and Vitest's environment (`@vitest-environment`, `@jest-environment`).
 * Such a comment is kept whole, with how many of the code's tokens come before it and how many line breaks part it from the token on either side, so one that moves past code, onto another line, or into another comment, is not the same; the tokens are compared too, so they are the same on both sides.
 * One about its own line (ABOUT_OWN) also keeps that line, since a line break in another comment on it moves what it covers.
 * One about a line below it (ABOUT_NEXT) also keeps everything up to that line, since TypeScript passes over blank and `//` lines to find the line a `@ts-expect-error` is about; a line slipped in, or one turned into a block comment, moves what it covers.
 * A prose comment that happens to match only fails a proof that a run of the checks then settles.
 */
const DIRECTIVE = /(?:\/\/|\/\*)[\s*/]*(?:eslint|globals?\s|@ts-|<reference)|^[\s*]*(?:eslint|globals?\s|@ts-)|[@#]__(?:PURE|NO_SIDE_EFFECTS|KEY)__|(?:\/\/|\/\*)!|@(?:license|preserve)\b|@(?:vitest|jest)-environment/;
/** A DIRECTIVE about the line it is on. */
const ABOUT_OWN = 'eslint-disable-line';
/** A DIRECTIVE about the line below it. */
const ABOUT_NEXT = /@ts-(?:expect-error|ignore)|eslint-disable-next-line/;

/**
 * Every token of a script's code, in order, the end of the file last: the parse's leaves, without the JSDoc the parse hangs on them, which is comment.
 * A token is kept whatever hangs on it, since the end of a file whose last comment is a `/** *\/` one carries that comment as its child.
 */
function tokens(file: ts.SourceFile): ts.Node[] {
  const found: ts.Node[] = [];
  const walk = (node: ts.Node): void => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    if (node.kind < ts.SyntaxKind.FirstNode) found.push(node);
    else node.getChildren(file).forEach(walk);
  };
  walk(file);
  return found;
}

/** Each DIRECTIVE comment of a script, in order, where it sits among the tokens and with the lines it covers. */
function directives(file: ts.SourceFile, code: ts.Node[]): string[] {
  const text = file.getFullText();
  const lines = text.split('\n').map((line) => line.trim());
  const breaks = (from: number, to: number): number => text.slice(from, to).split('\n').length - 1;
  return code.flatMap((token, before) => {
    // Every comment between this token and the one before it: those on that one's line are its trailing comments, the rest this one's leading.
    const ranges = new Map<number, ts.CommentRange>();
    for (const range of [...(ts.getTrailingCommentRanges(text, token.pos) ?? []), ...(ts.getLeadingCommentRanges(text, token.pos) ?? [])]) ranges.set(range.pos, range);
    return [...ranges.values()]
      .sort((a, b) => a.pos - b.pos)
      .flatMap((range) => {
        const comment = text.slice(range.pos, range.end).split('\n').map((line) => line.trim());
        if (!comment.some((line) => DIRECTIVE.test(line))) return [];
        const kept = [`after ${before} tokens, ${breaks(token.pos, range.pos)} line breaks after the last and ${breaks(range.end, token.getStart(file))} before the next`, ...comment];
        const last = file.getLineAndCharacterOfPosition(range.end).line;
        if (comment.some((line) => line.includes(ABOUT_OWN))) kept.push(...lines.slice(file.getLineAndCharacterOfPosition(range.pos).line, last + 1));
        if (comment.some((line) => ABOUT_NEXT.test(line))) {
          const below = last + 1;
          let covered = below;
          while (covered < lines.length && (lines[covered] === '' || lines[covered].startsWith('//'))) covered++;
          kept.push(...lines.slice(below, covered + 1));
        }
        return [kept.join('\n')];
      });
  });
}

/**
 * A script's text as the compiler prints it back without its comments, then its tokens, then its directives.
 * The tokens, because the printer writes back a semicolon that automatic semicolon insertion left out, so a line without one printed the same.
 */
const script =
  (kind: ts.ScriptKind) =>
  (text: string): string => {
    const file = ts.createSourceFile('file', text, ts.ScriptTarget.Latest, true, kind);
    const code = tokens(file);
    return [printer.printFile(file), ...code.map((token) => token.getText(file)), ...directives(file, code)].join('\n');
  };

/** Each kind of file this reads, and what of it a comment's change must leave the same. */
const FORMS = new Map<string, (text: string) => string>([
  ['.ts', script(ts.ScriptKind.TS)],
  ['.mts', script(ts.ScriptKind.TS)],
  ['.js', script(ts.ScriptKind.JS)],
  ['.mjs', script(ts.ScriptKind.JS)],
  ['.css', (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim()],
  ['.md', (text) => markdown.render(text).replace(/\s+/g, ' ')],
]);

const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8' });
const lines = (text: string): string[] => text.split('\n').filter((line) => line !== '');

const ref = process.argv[2] ?? 'HEAD';
// What git tracks and changed since the ref, staged or not, and what it does not track yet.
const changed = lines(git('diff', '--name-status', ref)).map((line) => line.split('\t'));
const untracked = lines(git('ls-files', '--others', '--exclude-standard')).map((file) => ['?', file]);

let failed = 0;
const say = (verdict: string, file: string, why = ''): void => {
  if (verdict !== 'same') failed++;
  console.log(`${verdict.padEnd(8)} ${file}${why ? `  (${why})` : ''}`);
};

for (const [status, file, renamedTo] of [...changed, ...untracked]) {
  if (status.startsWith('R')) say('renamed', `${file} -> ${renamedTo}`, 'not a comment’s change');
  else if (status === 'A' || status === '?') say('new', file, 'not a comment’s change');
  else if (status === 'D') say('deleted', file, 'not a comment’s change');
  else {
    const form = FORMS.get(extname(file));
    if (!form) say('not read', file, 'no proof for this kind of file');
    else say(form(git('show', `${ref}:${file}`)) === form(readFileSync(file, 'utf8')) ? 'same' : 'DIFFERS', file);
  }
}

if (changed.length + untracked.length === 0) console.log(`Nothing has changed since ${ref}.`);
process.exit(failed ? 1 : 0);
