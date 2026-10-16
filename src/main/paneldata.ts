import { ipcMain, type BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { panelDataDir } from './paths';
import { writeFileAtomic } from './atomic';
import { errorText, fsFailure, log } from './log';
import { inTurn } from './queue';
import { ID_PATTERN, soundShells, withLink, type PanelData, type PanelLink, type PanelShells } from '../shared/panels';

/**
 * What the app keeps for each panel, a file per entry: the sessions its rows started, and the group last picked for one (`PanelData`).
 *
 * APART FROM `meta.json` ON PURPOSE: a panel's data is written for a panel somebody else may have written, and a broken file must cost that panel its links and nothing else.
 * THE APP WRITES IT, NEVER THE PANEL: the list's script never sees a session id, and the app reads the links back to draw a row's session.
 * Written whole through the one atomic write, one write at a time per file, and read tolerantly: a file that does not parse, or is of another version, is kept beside itself rather than overwritten, and an entry that is not sound is dropped and said so in the log.
 * A link to a session that is gone is forgotten at the file's next write, and at once when the app itself deletes the session.
 */

const VERSION = 1;

const empty = (): PanelData => ({ sessions: {}, lastGroup: {} });

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The file for an entry, or null for a key that is not an entry's id — a position the layout keyed a broken entry by — which has nowhere to keep anything. */
function fileOf(entryId: string): string | null {
  return ID_PATTERN.test(entryId) ? path.join(panelDataDir, `${entryId}.json`) : null;
}

function soundLink(value: unknown): value is PanelLink {
  return isObject(value) && typeof value.key === 'string' && typeof value.label === 'string' && (value.href === null || typeof value.href === 'string') && typeof value.startedAt === 'string';
}

/** A file the app will not overwrite, kept beside itself under a name that says why, so nothing is lost to a bad read. */
async function keepAside(file: string, text: string, why: string): Promise<void> {
  const kept = `${file}.${why}-${Date.now()}.json`;
  try {
    await fs.writeFile(kept, text);
    await fs.rm(file, { force: true });
    log('warn', 'panel-data', `${file} ${why === 'corrupt' ? 'does not parse' : 'is of a version this build does not read'}, kept as ${path.basename(kept)}; starting it empty`);
  } catch (error) {
    log('warn', 'panel-data', `${file} could not be read and could not be kept aside (${errorText(error)}); starting it empty`);
  }
}

/**
 * Everything the app keeps for a panel; empty for one that has nothing yet.
 * Exported for the tests.
 */
export async function readPanelData(entryId: string): Promise<PanelData> {
  const file = fileOf(entryId);
  if (!file) return empty();
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    const failure = fsFailure(error);
    if (failure) log('warn', 'panel-data', `${file} unreadable: ${failure}`);
    return empty();
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    await keepAside(file, text, 'corrupt');
    return empty();
  }
  if (!isObject(json) || json.version !== VERSION) {
    await keepAside(file, text, isObject(json) && json.version !== undefined ? 'unread' : 'corrupt');
    return empty();
  }
  const data = empty();
  let dropped = 0;
  for (const [id, link] of Object.entries(isObject(json.sessions) ? json.sessions : {})) {
    if (soundLink(link)) data.sessions[id] = { key: link.key, label: link.label, href: link.href, startedAt: link.startedAt };
    else dropped += 1;
  }
  for (const [root, group] of Object.entries(isObject(json.lastGroup) ? json.lastGroup : {})) {
    if (group === null || typeof group === 'string') data.lastGroup[root] = group;
    else dropped += 1;
  }
  if (json.shells !== undefined) {
    const read = soundShells(json.shells);
    data.shells = read.shells;
    dropped += read.dropped;
  }
  if (dropped > 0) log('warn', 'panel-data', `${file}: dropped ${dropped} ${dropped === 1 ? 'entry' : 'entries'} that ${dropped === 1 ? 'was' : 'were'} not sound`);
  return data;
}

/**
 * Which of these sessions still exist, by the app's own measure: a transcript on disk, or a tab holding a session that has not written one yet.
 * Set by main, which has both; until then, every session exists, so nothing is ever dropped on a guess.
 */
type Existing = (ids: string[]) => Promise<Set<string>>;
let existing: Existing = (ids) => Promise.resolve(new Set(ids));

/**
 * Drop the links to sessions that are gone for good, whatever removed them — the app's own delete, Claude Code's transcript retention (`cleanupPeriodDays`), or a hand.
 * Asked on every write rather than on a read, as agreed with the user (2026-09-30), and never by the link's age: a session started long ago may be resumed yesterday.
 * `keep` is a session being linked now, which has neither a transcript nor a tab yet.
 * A check that fails keeps everything, since a link dropped by mistake cannot be had back.
 */
async function prune(file: string, data: PanelData, keep: string[]): Promise<void> {
  const ids = Object.keys(data.sessions).filter((id) => !keep.includes(id));
  if (ids.length === 0) return;
  let alive: Set<string>;
  try {
    alive = await existing(ids);
  } catch (error) {
    log('warn', 'panel-data', `${file}: could not tell which sessions still exist (${errorText(error)}), so none were forgotten`);
    return;
  }
  const gone = ids.filter((id) => !alive.has(id));
  for (const id of gone) delete data.sessions[id];
  if (gone.length > 0) log('info', 'panel-data', `${file}: forgot ${gone.length} ${gone.length === 1 ? 'session that no longer exists' : 'sessions that no longer exist'}`);
}

/** Read a panel's data, change it, and write it back when `mutate` says it changed, forgetting on the way the sessions that are gone; `wrote` says whether it wrote. */
function update(entryId: string, mutate: (data: PanelData) => boolean, keep: string[] = []): Promise<{ data: PanelData; wrote: boolean }> {
  const file = fileOf(entryId);
  if (!file) return Promise.resolve({ data: empty(), wrote: false });
  return inTurn(file, async () => {
    const data = await readPanelData(entryId);
    if (!mutate(data)) return { data, wrote: false };
    await prune(file, data, keep);
    await fs.mkdir(panelDataDir, { recursive: true });
    await writeFileAtomic(file, `${JSON.stringify({ version: VERSION, ...data }, null, 2)}\n`);
    return { data, wrote: true };
  });
}

/** A panel's data as the window asks for it: in turn with the writes, so never older than one that landed before it. */
function readForWindow(entryId: string): Promise<PanelData> {
  const file = fileOf(entryId);
  return file ? inTurn(file, () => readPanelData(entryId)) : readPanelData(entryId);
}

/**
 * Remember that `sessionId` was started from an item of the panel, and which group it was filed in there.
 * Exported for the tests.
 */
export async function linkSession(entryId: string, sessionId: string, link: Omit<PanelLink, 'startedAt'>, filed: { repoRoot: string; groupId: string | null }): Promise<PanelData> {
  const { data } = await update(
    entryId,
    (current) => {
      ({ sessions: current.sessions, lastGroup: current.lastGroup } = withLink(current, sessionId, link, filed, new Date().toISOString()));
      return true;
    },
    [sessionId],
  );
  return data;
}

/**
 * Where each panel's shell was when the quit began, by entry and shell id, once it has: a write of the window's that arrives after that, sent before the window heard of the quit, keeps these folders rather than the ones it carries, which are only where each shell was made or last restarted.
 */
const foldersAtQuit = new Map<string, Map<string, string>>();

/**
 * Keep a terminal panel's shells as the window says them now, the sound part of what it sent, with the folders the quit found where it has found any.
 * The window holds them and says them whole on every change, so nothing is told back.
 * Exported for the tests.
 */
export async function keepShells(entryId: string, shells: unknown): Promise<void> {
  await update(entryId, (current) => {
    const kept = soundShells(shells).shells;
    const atQuit = foldersAtQuit.get(entryId);
    for (const shell of kept.list) shell.folder = atQuit?.get(shell.id) ?? shell.folder;
    current.shells = kept;
    return true;
  });
}

/** Where a terminal panel's shell was when the app quit: its panel's entry, its own id, and its folder. */
export interface ShellFolder {
  entryId: string;
  shellId: string;
  folder: string;
}

/**
 * Keep where each shell was as its next shell's folder, in its panel's file, for the shells that file still holds.
 * Never rejects: the quit waits on it, and a folder not kept costs a shell its last `cd`, nothing more.
 */
export async function keepShellFolders(found: ShellFolder[]): Promise<void> {
  for (const { entryId, shellId, folder } of found) {
    const folders = foldersAtQuit.get(entryId) ?? new Map<string, string>();
    folders.set(shellId, folder);
    foldersAtQuit.set(entryId, folders);
  }
  await Promise.all(
    [...foldersAtQuit].map(async ([entryId, folders]) => {
      try {
        await update(entryId, (current) => {
          let changed = false;
          for (const shell of current.shells?.list ?? []) {
            const folder = folders.get(shell.id);
            if (folder === undefined || folder === shell.folder) continue;
            shell.folder = folder;
            changed = true;
          }
          return changed;
        });
      } catch (error) {
        log('warn', 'panel-data', `could not keep where ${entryId}'s shells were: ${errorText(error)}`);
      }
    }),
  );
}

/** Tells the window a panel's data changed; set once the window is known. */
let tell: (entryId: string, data: PanelData) => void = () => {};

/**
 * Forget sessions the app has just deleted, in every panel's file that names them, and tell the window about each file that changed.
 * At once, rather than waiting for that file's next write, which is when any other session that has gone is forgotten (`prune`).
 */
export async function forgetSessions(ids: string[]): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(panelDataDir);
  } catch {
    return;
  }
  for (const name of names) {
    const entryId = name.endsWith('.json') ? name.slice(0, -'.json'.length) : '';
    if (!fileOf(entryId)) continue;
    const { data, wrote } = await update(entryId, (current) => {
      const linked = ids.filter((id) => Object.hasOwn(current.sessions, id));
      for (const id of linked) delete current.sessions[id];
      return linked.length > 0;
    });
    if (wrote) tell(entryId, data);
  }
}

export function registerPanelData(getWindow: () => BrowserWindow | null, sessionsThatExist: Existing): void {
  existing = sessionsThatExist;
  tell = (entryId, data) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('panelData:changed', entryId, data);
  };
  ipcMain.handle('panelData:get', (_event, entryId: string) => readForWindow(entryId));
  ipcMain.handle('panelData:link', async (_event, entryId: string, sessionId: string, link: Omit<PanelLink, 'startedAt'>, filed: { repoRoot: string; groupId: string | null }) => {
    const data = await linkSession(entryId, sessionId, link, filed);
    tell(entryId, data);
    return data;
  });
  ipcMain.handle('panelData:setShells', (_event, entryId: string, shells: PanelShells) => keepShells(entryId, shells));
}
