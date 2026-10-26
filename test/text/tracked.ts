import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository's root, which every path here is relative to. */
export const root = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Every file git tracks whose path `kinds` matches, with its text, and every new one it would: a file not yet added is read too, so a rule fails on it before it is committed rather than first on CI.
 * Nothing git ignores is read, so nothing built or installed; the local-only files are kept out only while the person's global ignore lists them, as `CLAUDE.md` § Conventions has it.
 */
export function tracked(kinds: RegExp, repo = root): { file: string; text: string }[] {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: repo, encoding: 'utf8' })
    .split('\n')
    .filter((file) => kinds.test(file))
    .map((file) => ({ file, text: readFileSync(join(repo, file), 'utf8') }));
}

/** Each line of a file that `breaks` says breaks a rule, as `file:line: text`, which is what a failing check names. */
export function linesBreaking(file: string, text: string, breaks: (line: string) => boolean): string[] {
  return text.split('\n').flatMap((line, i) => (breaks(line) ? [`${file}:${i + 1}: ${line.trim()}`] : []));
}
