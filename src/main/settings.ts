import { ipcMain, type BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { editAppFile } from './appfiles';
import { tempOf } from './atomic';
import { onConfigChange } from './config';
import { readJsonc } from './jsonc';
import { errorText, log } from './log';
import { getMoved, getSettings as getMetaSettings, markMoved } from './meta';
import { settingsFile, settingsLocalFile } from './paths';
import { defaultSettings } from '../shared/defaults';
import { appFileChanges, SETTING_KEYS, settingProblem, settingsInForce, settingsView, type SettingsChange, type SettingsFileRead, type SettingsSaved, type SettingsView } from '../shared/settings';
import type { Settings } from '../shared/types';

/**
 * The app's preferences, from the config folder: your `settings.json` and the app's `settings.local.json`, combined by the rules in shared/settings.ts.
 * Read afresh whenever asked, a session's start included, so an edit of either file counts from the next session on.
 * A file that does not parse keeps what it last read in force, as the layout file does, so a half-saved edit costs nothing.
 */

/** What each file parsed to the last time it did, this run. */
const lastGood = new Map<string, unknown>();

async function readSettingsFile(file: string): Promise<SettingsFileRead> {
  const name = path.basename(file);
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return { name, status: 'unparsable', error: errorText(error), json: lastGood.get(file) ?? null };
    // Gone is a choice, not a mistake: none of its settings count any more.
    lastGood.delete(file);
    return { name, status: 'missing', error: null, json: null };
  }
  const read = readJsonc(text);
  if (!read.ok) return { name, status: 'unparsable', error: read.error, json: lastGood.get(file) ?? null };
  lastGood.set(file, read.json);
  return { name, status: 'read', error: null, json: read.json };
}

/** What the last line said, so only a change is logged. */
let lastLine = '';

/**
 * What is wrong with either file, as a log line, written when it changes.
 * A setting's value is never written, since a flag's can hold text nobody meant to hand over; Settings says what is wrong with it.
 */
function noteSettings(view: SettingsView): void {
  const parts = [...view.notes, ...SETTING_KEYS.flatMap((key) => view[key].problems.map(({ file }) => `${key} in ${file} is not used, Settings says why`))];
  const line = parts.join('; ');
  if (line === lastLine) return;
  const had = lastLine !== '';
  lastLine = line;
  if (line !== '') log('warn', 'settings', line);
  else if (had) log('info', 'settings', 'both settings files read without a mistake');
}

/** The move of the launch flags from meta.json, started when the app registers this module; every read waits for it. */
let moved: Promise<void> = Promise.resolve();

/** The settings as they stand. */
export async function readSettings(): Promise<SettingsView> {
  await moved;
  const view = settingsView(await readSettingsFile(settingsFile), await readSettingsFile(settingsLocalFile));
  noteSettings(view);
  return view;
}

/** The settings a session starts with. */
export async function settingsNow(): Promise<Settings> {
  return settingsInForce(await readSettings());
}

/** Write `change` into the app's file by the rules of `appFileChanges`, against `view`. */
async function writeChange(view: SettingsView, change: SettingsChange): Promise<void> {
  const edits = appFileChanges(view, change).map(({ key, value }) => ({ path: [key], value }));
  if (edits.length > 0) await editAppFile(settingsLocalFile, edits);
}

/**
 * Settings' save: `change` into the app's file, refused with a reason rather than thrown, since the window shows the reason in the dialog.
 * A value is checked here as well as in the dialog, because main is what hands it to a session.
 */
export async function saveSettings(change: SettingsChange): Promise<SettingsSaved> {
  for (const key of SETTING_KEYS) {
    const value = change[key];
    const problem = value === undefined || value === null ? null : settingProblem(key, value);
    if (problem !== null) return { view: await readSettings(), refused: problem };
  }
  try {
    await writeChange(await readSettings(), change);
    return { view: await readSettings(), refused: null };
  } catch (error) {
    return { view: await readSettings(), refused: errorText(error) };
  }
}

/**
 * The launch flags, from where they were kept before the config folder, into the app's file: once, and only when they are not the default.
 * Meta's copy is left where it is, so an older build still finds it; `moved` records that it was made, so deleting the app's file later does not bring the old flags back.
 * A move that fails is tried again at the next launch.
 */
async function moveFromMeta(): Promise<void> {
  if ((await getMoved()).includes('launchFlags')) return;
  const { launchFlags } = await getMetaSettings();
  if (launchFlags !== defaultSettings().launchFlags) {
    const view = settingsView(await readSettingsFile(settingsFile), await readSettingsFile(settingsLocalFile));
    if (view.launchFlags.source !== 'app') await writeChange(view, { launchFlags });
  }
  await markMoved('launchFlags');
  log('info', 'settings', launchFlags === defaultSettings().launchFlags ? 'no launch flags to move from meta.json' : `the launch flags moved from meta.json to ${path.basename(settingsLocalFile)}`);
}

/** Answer the window's reads and saves, make the move from meta, and push the settings whenever either file changes on disk other than by the app's own write. */
export function registerSettings(getWindow: () => BrowserWindow | null): void {
  moved = moveFromMeta().catch((error: unknown) => log('warn', 'settings', `the launch flags were not moved from meta.json, and will be tried again at the next launch: ${errorText(error)}`));
  ipcMain.handle('settings:get', () => readSettings());
  ipcMain.handle('settings:set', (_event, change: SettingsChange) => saveSettings(change));
  const named = (paths: ReadonlySet<string>): boolean => [settingsFile, settingsLocalFile].some((file) => paths.has(file) || paths.has(tempOf(file)));
  onConfigChange((paths) => {
    if (paths !== null && !named(paths)) return;
    void readSettings().then((view) => {
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.send('settings:changed', view);
    });
  });
}
