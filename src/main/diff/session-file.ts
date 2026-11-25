import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseUnified } from '../../shared/diff/parse';
import type { SessionFileDiff, SessionStart } from '../../shared/diff/types';
import { markWords } from '../../shared/diff/words';
import { findTranscript } from '../sessions/sessions';
import { firstWrite, textBefore } from '../sessions/touched';
import { fileLines, noIndexDiff } from './read';

/**
 * A file's changes since a session first changed it: the text it had then against the file as it is now, so a change made since by other means shows too.
 * For a file git has nothing to compare with: one no repository holds, or one its repository ignores.
 * A file no longer on disk has nothing to compare with, and says so (`gone`), whatever the session did to it.
 */
export async function sessionFileDiff(session: string, file: string, context: number, ignoreWs: boolean): Promise<SessionFileDiff> {
  const transcript = await findTranscript(session);
  const write = transcript ? await firstWrite(transcript, file) : undefined;
  const nothing = (start: SessionStart, gone: boolean, lines: string[] | null): SessionFileDiff => ({ path: file, hunks: [], binary: false, mode: null, lines, start, gone, identical: false });
  if (!(await isFile(file))) return nothing(write?.start.kind ?? 'unwritten', true, null);
  const lines = await fileLines(file);
  if (!write) return nothing('unwritten', false, lines);
  const before = await textBefore(write.start);
  if (before === null) return nothing('unknown', false, lines);
  // Compared apart from the diff, which with `-w` has no hunks for a file changed only in whitespace either.
  const identical = (await fs.readFile(file, 'utf8')) === before;
  const flags = [`-U${context}`, ...(ignoreWs ? ['-w'] : [])];
  if (write.start.kind === 'created') return { ...diffOf(await noIndexDiff(os.tmpdir(), flags, '/dev/null', file), lines, file), start: 'created', gone: false, identical };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-ui-before-'));
  try {
    const then = path.join(dir, path.basename(file));
    await fs.writeFile(then, before);
    return { ...diffOf(await noIndexDiff(dir, flags, then, file), lines, file), start: 'recorded', gone: false, identical };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const isFile = (file: string): Promise<boolean> =>
  fs.stat(file).then(
    (stat) => stat.isFile(),
    () => false,
  );

function diffOf(raw: string, lines: string[] | null, file: string): Omit<SessionFileDiff, 'start' | 'gone' | 'identical'> {
  const parsed = parseUnified(raw);
  for (const hunk of parsed.hunks) markWords(hunk.rows);
  // The text from then is written to a fresh file, whose mode says nothing of the mode the file had then.
  return { path: file, hunks: parsed.hunks, binary: parsed.binary, mode: null, lines };
}
