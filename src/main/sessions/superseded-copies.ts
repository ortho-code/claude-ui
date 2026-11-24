/**
 * A session's superseded copies: when a transcript is moved into a folder that already holds one of the same session, Claude Code renames the one there to `<id>.jsonl.superseded-<ms>`, logging that it set it aside, and keeps the moved one.
 * The copy keeps whatever was said only in it, and Claude Code's cleanup deletes it once its cleanup period has passed since it was superseded.
 */

import { promises as fs } from 'node:fs';
import type { SupersededCopy } from '../../shared/types';
import { foldRecord, newFold, readAppended, type HistoryFold, type TranscriptCursor } from './transcript';

/** A superseded copy's name: the transcript's, then the moment it was superseded in ms. */
const COPY_NAME = /^(.+)\.jsonl\.superseded-(\d+)$/;

/** The session id and stamp a file name holds when it is a superseded copy, or null. */
export function copyOf(name: string): { id: string; stamp: string } | null {
  const match = COPY_NAME.exec(name);
  return match ? { id: match[1]!, stamp: match[2]! } : null;
}

/** How far a transcript's requests have been read, so a transcript still being written is read on from there. */
interface Read {
  cursor: TranscriptCursor;
  fold: HistoryFold;
  /**
   * The inode of the file that was read, or null before the first read.
   * Claude Code moves another copy of a session over its transcript by a rename, which leaves a file under the same name that need not be shorter, so only its inode says it is another file.
   */
  inode: number | null;
  /** One read at a time per file, so two listings never fold the same bytes twice. */
  queue: Promise<unknown>;
}

const reads = new Map<string, Read>();

/** The ids of the requests in the transcript at `file`, by the history's own rule for a request. */
function requestIds(file: string): Promise<Set<string>> {
  let read = reads.get(file);
  if (!read) {
    read = { cursor: { offset: 0, carry: Buffer.alloc(0) }, fold: newFold(), inode: null, queue: Promise.resolve() };
    reads.set(file, read);
  }
  const at = read;
  const ids = at.queue.then(async () => {
    const inode = await fs.stat(file).then(
      (stat) => stat.ino,
      () => null,
    );
    if (inode !== at.inode) {
      at.cursor = { offset: 0, carry: Buffer.alloc(0) };
      at.fold = newFold();
      at.inode = inode;
    }
    await readAppended(file, at.cursor, (record) => foldRecord(at.fold, record), () => (at.fold = newFold()), 'sessions');
    return new Set(at.fold.exchanges.map((exchange) => exchange.id));
  });
  at.queue = ids.catch(() => undefined);
  return ids;
}

/**
 * Each superseded copy of the transcript at `current`, oldest first, with how many of its requests the current transcript lacks.
 * `stamps` are the copies' stamps, as `copyOf` reads them from the names beside it.
 */
export async function supersededCopies(current: string, stamps: string[]): Promise<SupersededCopy[]> {
  const now = await requestIds(current);
  return Promise.all(
    [...stamps]
      .sort((a, b) => Number(a) - Number(b))
      .map(async (stamp) => {
        const held = await requestIds(`${current}.superseded-${stamp}`);
        return { stamp, at: Number(stamp), missing: [...held].filter((id) => !now.has(id)).length };
      }),
  );
}

/** Forget what was read of a transcript that no longer has a copy beside it, and of its copies, given the transcripts that still have one. */
export function forgetCopiesBut(withCopies: ReadonlySet<string>): void {
  for (const file of reads.keys()) if (!withCopies.has(file.replace(/\.superseded-\d+$/, ''))) reads.delete(file);
}
