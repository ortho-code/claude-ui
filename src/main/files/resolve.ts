import { ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** The most paths one ask resolves, about what a terminal's widest line can hold. */
const MAX_CANDIDATES = 64;

/**
 * Each of `candidates` as the absolute path of a file on disk, or null where there is no file: a relative one read from `dir`, one starting `~/` from the home folder.
 * A folder is no file, so a piece of output naming one is no link.
 */
export async function resolvePaths(dir: string, candidates: string[]): Promise<(string | null)[]> {
  return Promise.all(
    candidates.slice(0, MAX_CANDIDATES).map(async (candidate) => {
      const full = candidate.startsWith('~/') ? path.join(os.homedir(), candidate.slice(2)) : path.resolve(dir, candidate);
      return fs.stat(full).then(
        (stat) => (stat.isFile() ? full : null),
        () => null,
      );
    }),
  );
}

export function registerFilesIpc(): void {
  ipcMain.handle('files:resolve', (_event, dir: string, candidates: string[]) => resolvePaths(dir, candidates));
}
