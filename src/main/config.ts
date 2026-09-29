import { ipcMain, type BrowserWindow } from 'electron';
import { promises as fs, constants, mkdirSync, watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { configRoot, layoutsDir, scriptsDir, typesDir, defaultLayoutFile } from './paths';
import type { LayoutReport, PathBase, PathCheck, PathKind, ReadStatus, TypeReport } from '../shared/panels';
import { fsFailure, log } from './log';

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

/** One read of a hand-written JSON file, the layout or a type's manifest: never throws, and a file that is not JSON carries the parser's own message and position. */
async function readJson(file: string): Promise<{ status: ReadStatus; error: string | null; json: unknown }> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing', error: null, json: null };
    return { status: 'unparsable', error: (error as Error).message, json: null };
  }
  try {
    // A byte-order mark is an editor's doing, not a mistake in the file; JSON.parse refuses it all the same.
    return { status: 'read', error: null, json: JSON.parse(text.replace(/^\uFEFF/, '')) };
  } catch (error) {
    return { status: 'unparsable', error: (error as Error).message, json: null };
  }
}

/** The manifest a type's folder holds. */
export const MANIFEST_FILE = 'panel.json';

/**
 * The folders under `types/`, by name: a folder, or a link to one, since a type shared as a git checkout may well be linked in.
 * A dot-folder is skipped, so `types/` can itself be a checkout without its `.git` reading as a type.
 */
async function typeFolders(root: string): Promise<{ name: string; dir: string }[]> {
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch {
    return [];
  }
  const found = await Promise.all(
    names
      .filter((name) => !name.startsWith('.'))
      .map(async (name) => {
        const dir = path.join(root, name);
        const isDir = await fs.stat(dir).then(
          (stat) => stat.isDirectory(),
          () => false,
        );
        return isDir ? { name, dir } : null;
      }),
  );
  return found.filter((folder) => folder !== null).sort((a, b) => a.name.localeCompare(b.name));
}

/** Every type folder's manifest, read as it is. Exported for the tests. */
export async function readTypes(root = typesDir): Promise<TypeReport[]> {
  const folders = await typeFolders(root);
  return Promise.all(folders.map(async ({ name, dir }) => ({ name, dir, ...(await readJson(path.join(dir, MANIFEST_FILE))) })));
}

/** One read of the layout file, and of the type folders it may use. Exported for the tests. */
export async function readLayout(file = defaultLayoutFile, types = typesDir): Promise<LayoutReport> {
  const [layout, typeReports] = await Promise.all([readJson(file), readTypes(types)]);
  return { configRoot, file, ...layout, types: typeReports };
}

/**
 * What the layout file's last read said, as a log line.
 * Only a change is written: the file is read at start-up and on every save, and "read" a hundred times over says nothing. What the file's CONTENTS got wrong is the renderer's to say (panels/layout.ts); this is only whether there was a file to judge.
 */
let lastLayoutLine: string | null = null;
/** The type folders as the last line said them; '' for none, so an install without any says nothing about them. */
let lastTypesLine = '';
export function noteLayout(report: LayoutReport): void {
  const line =
    report.status === 'read'
      ? `${report.file}: read`
      : report.status === 'missing'
        ? `${report.file}: not there, the default layout is shown`
        : `${report.file}: does not parse, the last good layout stays up: ${report.error}`;
  if (line !== lastLayoutLine) {
    lastLayoutLine = line;
    log(report.status === 'unparsable' ? 'warn' : 'info', 'layout', line);
  }
  // Which folders there are and whether each manifest could be read; what one says wrong is the renderer's, shown where the type is used.
  const types = report.types
    .map((type) => (type.status === 'read' ? type.name : `${type.name} (${type.status === 'missing' ? `no ${MANIFEST_FILE}` : `${MANIFEST_FILE} does not parse: ${type.error}`})`))
    .join(', ');
  const typesLine = types === '' && lastTypesLine === '' ? '' : `types: ${types || 'none'}`;
  if (typesLine === lastTypesLine) return;
  lastTypesLine = typesLine;
  log(report.types.some((type) => type.status === 'unparsable') ? 'warn' : 'info', 'layout', typesLine);
}

/** A read of the layout file that also notes what it found. */
async function readAndNoteLayout(): Promise<LayoutReport> {
  const report = await readLayout();
  noteLayout(report);
  return report;
}

/**
 * Create the folder, answer reads, and push a fresh report whenever anything in it changes.
 *
 * Directories are watched one by one rather than the folder recursively (recursive watch is unreliable on Linux/WSL, as watcher.ts found): the folder itself, `layouts/` for the file, `scripts/` so a script appearing or gaining its executable bit (an attribute change, MEASURED to reach a directory watch) clears its panel's error without a restart, and `types/` with each type's own folder, for its manifest and the script it runs — the report that follows is what tells every panel to check again.
 * Any event on the folder itself re-opens the ones below it, and any event on `types/` re-opens the type folders, because a directory that was deleted and recreated leaves its old watcher pointing at nothing and a folder added there has none yet.
 */
export function registerConfig(getWindow: () => BrowserWindow | null): void {
  for (const dir of [configRoot, layoutsDir, scriptsDir, typesDir]) mkdirSync(dir, { recursive: true });

  ipcMain.handle('config:getLayout', () => readAndNoteLayout());
  ipcMain.handle('config:checkPath', (_event, value: string, base: PathBase, must: PathKind) => checkPath(value, base, must));

  const watchers = new Map<string, FSWatcher>();
  let timer: NodeJS.Timeout | null = null;
  const notify = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void readAndNoteLayout().then((report) => {
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
      watcher.on('error', (error) => {
        const failure = fsFailure(error);
        if (failure) log('warn', 'watch', `stopped watching ${dir}: ${failure}`);
        unwatch(dir);
      });
      watchers.set(dir, watcher);
    } catch (error) {
      // Not there right now is routine, and the next event on the folder above tries again; anything else means changes there go unseen until a restart.
      const failure = fsFailure(error);
      if (failure) log('warn', 'watch', `cannot watch ${dir}: ${failure}`);
    }
  };
  // The type folders there are now, each watched; one that has gone loses its watcher.
  const watchTypeFolders = (): void => {
    void typeFolders(typesDir).then((folders) => {
      const present = new Set(folders.map(({ dir }) => dir));
      for (const dir of [...watchers.keys()]) if (dir.startsWith(`${typesDir}${path.sep}`) && !present.has(dir)) unwatch(dir);
      for (const dir of present) watchDir(dir, notify);
    });
  };
  const watchBelow = (): void => {
    watchDir(layoutsDir, notify);
    watchDir(scriptsDir, notify);
    watchDir(typesDir, () => {
      watchTypeFolders();
      notify();
    });
    watchTypeFolders();
  };
  watchDir(configRoot, () => {
    watchBelow();
    notify();
  });
  watchBelow();
}
