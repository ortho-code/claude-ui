import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { writeFileAtomic } from './atomic';

/**
 * Writing a file the app keeps, with the two copies that let a bad write be undone: one per version change, and the previous good one.
 * The one way the app backs up a file of its own, so every such file is recoverable the same way.
 */

/** Where a file's copies go, and what decides them. */
export interface Backups {
  /** The path the copies are named from: `<at>.bak` for the previous good copy, `<at>.<version>.bak` for the one a version left. */
  at: string;
  /** Whether contents are worth keeping as the previous good copy, so a corrupt file never replaces a good backup. */
  isGood: (text: string) => boolean;
  /** The version that last wrote the file, empty when that is not known. */
  outgoing: string;
  /** The version writing it now. */
  current: string;
  /** Told once the version copy is taken, before anything overwrites the file; best-effort like the copy itself. */
  onVersionChange?: () => Promise<void>;
}

/** The previous good copy of a file backed up at `at`, which is what a read falls back to. */
export function goodCopy(at: string): string {
  return `${at}.bak`;
}

/**
 * Replace a file's contents, keeping its copies first.
 *
 * The first time a different version writes, the file as the outgoing version left it is copied to `<at>.<outgoing>.bak`.
 * The previous good copy protects against a corrupt write; this protects against a version change, which is a different risk and needs its own copy — a rolling backup is overwritten by the very next write, so by the time anyone notices a new build mishandled something, the pre-upgrade state is long gone.
 * No outgoing version means a file written before versions were kept, or a brand-new one, with nothing a rollback could want back.
 *
 * Then the current contents become the previous good copy, if `isGood` says they are: a file that is not there yet or is already corrupt leaves the copy before it untouched.
 *
 * Taking a copy is best-effort throughout, since failing to take one must never stop the write; the write itself rejects as `writeFileAtomic` does, and the caller serialises writes to one file, as it requires.
 */
export async function writeWithBackups(file: string, data: string, backups: Backups): Promise<void> {
  const { at, isGood, outgoing, current, onVersionChange } = backups;
  await fs.mkdir(path.dirname(at), { recursive: true }).catch(() => undefined);
  if (outgoing !== '' && outgoing !== current) {
    try {
      await fs.copyFile(file, `${at}.${outgoing}.bak`);
    } catch {
      // No file to copy yet, or an unwritable directory: the write still happens.
    }
    await onVersionChange?.().catch(() => undefined);
  }
  try {
    const previous = await fs.readFile(file, 'utf8');
    if (isGood(previous)) await fs.writeFile(goodCopy(at), previous);
  } catch {
    // No file yet (the first write), or the copy could not be written: leave any copy before it as it is.
  }
  await writeFileAtomic(file, data);
}
