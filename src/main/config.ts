import { ipcMain, shell, type BrowserWindow } from 'electron';
import { promises as fs, constants, mkdirSync, watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { configRoot, layoutsDir, scriptsDir, defaultLayoutFile } from './paths';
import type { LayoutReport, PathBase, PathCheck, PathKind } from '../shared/panels';

/**
 * The config folder: read and watched here, never written.
 *
 * A read is TOLERANT the way meta's is not, and for the opposite reason: meta drops what it does not understand because the app wrote it and a past version's field is noise, while this file was written by a person, so what the app does not understand has to be NAMED back to them.
 * So nothing here throws or drops: a missing file is a report saying so, and a file that is not JSON is a report carrying the parser's own message and position.
 */

/**
 * Where a path option points: `~` and `~/…` under the home directory, so a shared layout file works on another machine; an absolute path as it is; anything else against `base`.
 * The ONE resolver, used by a panel's check and by the run and the shell start that follow it, so the check and the use cannot disagree about which file or folder was meant.
 */
export function resolvePath(value: string, base: PathBase): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return path.join(homedir(), value.slice(2));
  return path.resolve(base === 'config' ? configRoot : base.dir, value);
}

/** Whether a path option points at what it must, worded in the value as the user wrote it. Asked by the panel whose option it is. */
export async function checkPath(value: string, base: PathBase, must: PathKind): Promise<PathCheck> {
  const resolved = resolvePath(value, base);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch {
    return { path: resolved, problem: `${value} not found` };
  }
  if (must === 'directory') return { path: resolved, problem: stat.isDirectory() ? null : `${value} is not a folder` };
  if (!stat.isFile()) return { path: resolved, problem: `${value} is not a file` };
  try {
    await fs.access(resolved, constants.X_OK);
  } catch {
    return { path: resolved, problem: `${value} is not executable` };
  }
  return { path: resolved, problem: null };
}

/** One read of the layout file. Exported for the tests. */
export async function readLayout(file = defaultLayoutFile): Promise<LayoutReport> {
  const base = { configRoot, file };
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...base, status: 'missing', error: null, json: null };
    return { ...base, status: 'unparsable', error: (error as Error).message, json: null };
  }
  let json: unknown;
  try {
    // A byte-order mark is an editor's doing, not a mistake in the file; JSON.parse refuses it all the same.
    json = JSON.parse(text.replace(/^﻿/, ''));
  } catch (error) {
    return { ...base, status: 'unparsable', error: (error as Error).message, json: null };
  }
  return { ...base, status: 'read', error: null, json };
}

/**
 * Create the folder, answer reads, and push a fresh report whenever anything in it changes.
 *
 * Three directories are watched rather than the folder recursively (recursive watch is unreliable on Linux/WSL, as watcher.ts found): the folder itself, `layouts/` for the file, and `scripts/` so a script appearing or gaining its executable bit (an attribute change, MEASURED to reach a directory watch) clears its panel's error without a restart — the report that follows is what tells every panel to check again.
 * Any event on the folder itself re-opens the two below it, because a directory that was deleted and recreated leaves its old watcher pointing at nothing.
 */
export function registerConfig(getWindow: () => BrowserWindow | null): void {
  for (const dir of [configRoot, layoutsDir, scriptsDir]) mkdirSync(dir, { recursive: true });

  ipcMain.handle('config:getLayout', () => readLayout());
  ipcMain.handle('config:checkPath', (_event, value: string, base: PathBase, must: PathKind) => checkPath(value, base, must));
  // `openPath`, not `showItemInFolder`: that one opens the folder's PARENT with the folder selected, and a Linux file manager without FileManager1 support (WSLg's) selects nothing, which reads as the wrong folder.
  ipcMain.on('config:open', () => void shell.openPath(configRoot));

  const watchers = new Map<string, FSWatcher>();
  let timer: NodeJS.Timeout | null = null;
  const notify = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void readLayout().then((report) => {
        const win = getWindow();
        if (win && !win.isDestroyed()) win.webContents.send('config:changed', report);
      });
    }, 300);
  };
  const unwatch = (dir: string): void => {
    watchers.get(dir)?.close();
    watchers.delete(dir);
  };
  const watchDir = (dir: string, onEvent: () => void): void => {
    unwatch(dir);
    try {
      const watcher = watch(dir, onEvent);
      // A watched directory going away surfaces here on some platforms; drop the dead watcher so the next root event can re-open it.
      watcher.on('error', () => unwatch(dir));
      watchers.set(dir, watcher);
    } catch {
      // Not there right now; the next event on the folder above tries again.
    }
  };
  const watchBelow = (): void => {
    watchDir(layoutsDir, notify);
    watchDir(scriptsDir, notify);
  };
  watchDir(configRoot, () => {
    watchBelow();
    notify();
  });
  watchBelow();
}
