import type { DiffHunk, DiffRow } from './types';

/** One file of `git diff --numstat -z`: its counts, null for a binary file, and for a rename its old path. */
export interface Numstat {
  path: string;
  from: string | null;
  added: number | null;
  deleted: number | null;
}

/**
 * `git diff --numstat -z`: `added TAB deleted TAB path NUL`, or for a rename or copy an empty path then `old NUL new NUL`; a binary file counts `-` for both.
 * `-z` keeps a path as it is, where the plain form quotes one with unusual characters and folds a rename into `dir/{old => new}`.
 */
export function parseNumstat(text: string): Numstat[] {
  const fields = text.split('\0');
  const out: Numstat[] = [];
  let at = 0;
  while (at < fields.length) {
    const head = fields[at++] ?? '';
    if (!head) continue;
    const [added, deleted, path] = head.split('\t');
    const count = (value: string | undefined): number | null => (value === undefined || value === '-' ? null : Number(value));
    if (path) {
      out.push({ path, from: null, added: count(added), deleted: count(deleted) });
      continue;
    }
    const from = fields[at++] ?? '';
    const to = fields[at++] ?? '';
    out.push({ path: to, from, added: count(added), deleted: count(deleted) });
  }
  return out;
}

/**
 * `git diff --name-status -z`, as each new path's status letter and, for a rename or copy, its old path.
 * Records are `STATUS NUL path NUL`, and `R<score> NUL old NUL new NUL` for a rename or copy.
 */
export function parseNameStatus(text: string): Map<string, { status: string; from: string | null }> {
  const fields = text.split('\0').filter((field) => field !== '');
  const out = new Map<string, { status: string; from: string | null }>();
  let at = 0;
  while (at < fields.length) {
    const status = fields[at++] ?? '';
    const first = fields[at++];
    if (first === undefined) break;
    if (status.startsWith('R') || status.startsWith('C')) {
      const to = fields[at++];
      if (to === undefined) break;
      out.set(to, { status: status.charAt(0), from: first });
    } else {
      out.set(first, { status: status.charAt(0), from: null });
    }
  }
  return out;
}

/** The text between a hunk header's two `@@` alone: what follows the second is git's heading, text taken from a line of the file, which can hold code that reads as a range (`-> Result<()>`, `count += 1`). */
function hunkStarts(line: string): { oldStart: number; newStart: number; heading: string } {
  const rest = line.slice(2);
  const close = rest.indexOf('@@');
  const ranges = close < 0 ? rest : rest.slice(0, close);
  const heading = close < 0 ? '' : rest.slice(close + 2).trim();
  let oldStart = 0;
  let newStart = 0;
  for (const token of ranges.trim().split(/\s+/)) {
    const start = Number(token.slice(1).split(',')[0]);
    if (token.startsWith('-')) oldStart = start;
    else if (token.startsWith('+')) newStart = start;
  }
  return { oldStart, newStart, heading };
}

/**
 * One file's `git diff` in the unified format, as hunks of rows with each side's line number.
 * A hunk's `gapBefore` counts the unchanged lines between it and the one before, or the file's start.
 * Everything before the first hunk describes the file rather than its content (`diff --git`, `index`, `---`, `+++`), so a `---` or `+++` met later is a removed or added line.
 */
export function parseUnified(raw: string): { hunks: DiffHunk[]; binary: boolean } {
  const hunks: DiffHunk[] = [];
  let binary = false;
  let oldLine = 0;
  let newLine = 0;
  let oldEnd = 1;
  for (const line of raw.split('\n')) {
    const hunk = hunks.at(-1);
    if (!hunk) {
      if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) binary = true;
      else if (line.startsWith('@@')) ({ oldLine, newLine, oldEnd } = startHunk(hunks, line, oldEnd));
      continue;
    }
    if (line.startsWith('@@')) {
      ({ oldLine, newLine, oldEnd } = startHunk(hunks, line, oldEnd));
      continue;
    }
    if (line === '\\ No newline at end of file') {
      const last = hunk.rows.at(-1);
      if (last) last.noEol = true;
      continue;
    }
    const row = rowOf(line, oldLine, newLine);
    if (!row) continue;
    hunk.rows.push(row);
    if (row.old !== null) oldLine++;
    if (row.new !== null) newLine++;
    oldEnd = oldLine;
  }
  return { hunks, binary };
}

function startHunk(hunks: DiffHunk[], line: string, oldEnd: number): { oldLine: number; newLine: number; oldEnd: number } {
  const { oldStart, newStart, heading } = hunkStarts(line);
  // A side with no lines names the line before it, 0 at the file's start; the gap counts from the line after the last hunk ended.
  const firstOld = Math.max(oldStart, 1);
  hunks.push({ oldStart: firstOld, newStart: Math.max(newStart, 1), heading, gapBefore: Math.max(0, firstOld - oldEnd), rows: [] });
  return { oldLine: firstOld, newLine: Math.max(newStart, 1), oldEnd };
}

/** A line of a hunk as a row, or null for none: the empty string `split` leaves after the diff's last newline has no mark, where an empty unchanged line keeps its space. */
function rowOf(line: string, oldLine: number, newLine: number): DiffRow | null {
  const mark = line.charAt(0);
  const text = line.slice(1);
  if (mark === '+') return { kind: 'add', old: null, new: newLine, text };
  if (mark === '-') return { kind: 'del', old: oldLine, new: null, text };
  if (mark === ' ') return { kind: 'context', old: oldLine, new: newLine, text };
  return null;
}
