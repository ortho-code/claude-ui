import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import MarkdownIt from 'markdown-it';
import ts from 'typescript';

/**
 * NOT A CHECK: a tool, for a change meant to touch nothing but comments, which proves it did: `npm run comments:prove [-- <ref>]`.
 * Every file changed since `<ref>` (HEAD unless named), as it stands in the working tree, is compared with that file at `<ref>`.
 * TypeScript and JavaScript are each printed back from the compiler's parse with every comment dropped, and must print the same; CSS has every comment taken out and its whitespace collapsed; markdown is rendered, its whitespace collapsed, since a line break inside a paragraph shows as a space.
 * So "the same" is the same up to layout: what this cannot tell from a comment's change is a change of whitespace in code, which the diff shows and a comment's change has no business making.
 * A file it has no way to read, a new file, a deleted one and a renamed one each fail the proof, since none of them is a comment's change.
 * Exits non-zero unless every changed file is the same.
 */

const markdown = new MarkdownIt();
const printer = ts.createPrinter({ removeComments: true });

/** A script's text as the compiler prints it back without its comments. */
const script =
  (kind: ts.ScriptKind) =>
  (text: string): string =>
    printer.printFile(ts.createSourceFile('file', text, ts.ScriptTarget.Latest, true, kind));

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
