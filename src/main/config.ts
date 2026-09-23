import { ipcMain, shell, type BrowserWindow } from 'electron';
import { promises as fs, constants, mkdirSync, watch, type FSWatcher } from 'node:fs';
import * as path from 'node:path';
import { configRoot, layoutsDir, scriptsDir, defaultLayoutFile } from './paths';
import type { LayoutReport, ScriptCheck } from '../shared/panels';

/**
 * The config folder: read, checked and watched here, never written.
 *
 * A read is TOLERANT the way meta's is not, and for the opposite reason: meta drops what it does not understand because the app wrote it and a past version's field is noise, while this file was written by a person, so what the app does not understand has to be NAMED back to them.
 * So nothing here throws or drops: a missing file is a report saying so, a file that is not JSON is a report carrying the parser's own message and position, and a script that is not there or not executable is a report entry in the value's own name.
 */

/**
 * Where a `script` value points: relative to the config folder, so a script travels with it and needs no environment variable, or absolute.
 * The ONE resolver, used by the check at read time and by the run, so the two cannot disagree about which file was meant.
 */
export function resolveScript(script: string): string {
  return path.resolve(configRoot, script);
}

/** Whether the file a `script` names is there and can be run, worded in the value as the user wrote it. */
async function checkScript(script: string): Promise<ScriptCheck> {
  const resolved = resolveScript(script);
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) return { path: resolved, problem: `${script} is not a file` };
  } catch {
    return { path: resolved, problem: `${script} not found` };
  }
  try {
    await fs.access(resolved, constants.X_OK);
  } catch {
    return { path: resolved, problem: `${script} is not executable` };
  }
  return { path: resolved, problem: null };
}

/**
 * Every string-valued `script` anywhere in the parsed file.
 * A walk of the whole tree rather than of the expected shape, so an entry the validator will reach has its check no matter how the levels above it are malformed; a `script` somewhere the validator never looks costs one stat and nothing else.
 */
function collectScripts(json: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(json)) {
    for (const item of json) collectScripts(item, into);
  } else if (json && typeof json === 'object') {
    for (const [key, value] of Object.entries(json)) {
      if (key === 'script' && typeof value === 'string') into.add(value);
      else collectScripts(value, into);
    }
  }
  return into;
}

/** One read of the layout file, with its script checks. Exported for the tests. */
export async function readLayout(file = defaultLayoutFile): Promise<LayoutReport> {
  const base = { configRoot, file, scripts: {} as Record<string, ScriptCheck> };
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
  const scripts: Record<string, ScriptCheck> = {};
  for (const script of collectScripts(json)) scripts[script] = await checkScript(script);
  return { ...base, status: 'read', error: null, json, scripts };
}

/**
 * Create the folder, answer reads, and push a fresh report whenever anything in it changes.
 *
 * Three directories are watched rather than the folder recursively (recursive watch is unreliable on Linux/WSL, as watcher.ts found): the folder itself, `layouts/` for the file, and `scripts/` so a script appearing or gaining its executable bit (an attribute change, MEASURED to reach a directory watch) clears its error without a restart.
 * Any event on the folder itself re-opens the two below it, because a directory that was deleted and recreated leaves its old watcher pointing at nothing.
 */
export function registerConfig(getWindow: () => BrowserWindow | null): void {
  for (const dir of [configRoot, layoutsDir, scriptsDir]) mkdirSync(dir, { recursive: true });

  ipcMain.handle('config:getLayout', () => readLayout());
  // `openPath`, not `showItemInFolder`: that one opens the folder's PARENT with the folder selected, and a Linux file manager without FileManager1 support (WSLg's) selects nothing, which reads as the wrong folder.
  ipcMain.on('config:reveal', () => void shell.openPath(configRoot));

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
