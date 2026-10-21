import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository's root, which every path here is relative to. */
export const root = fileURLToPath(new URL('../../', import.meta.url));

/** Every file git tracks whose path `kinds` matches, with its text: nothing built, installed or ignored, so a local plan or a scratch file is never read. */
export function tracked(kinds: RegExp): { file: string; text: string }[] {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((file) => kinds.test(file))
    .map((file) => ({ file, text: readFileSync(join(root, file), 'utf8') }));
}

/** Each line of a file that `breaks` says breaks a rule, as `file:line: text`, which is what a failing check names. */
export function linesBreaking(file: string, text: string, breaks: (line: string) => boolean): string[] {
  return text.split('\n').flatMap((line, i) => (breaks(line) ? [`${file}:${i + 1}: ${line.trim()}`] : []));
}
