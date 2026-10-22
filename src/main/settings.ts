import { ipcMain, type BrowserWindow } from 'electron';
import * as path from 'node:path';
import { editAppFile, removeAppFile, startAppFile } from './appfiles';
import { tempOf } from './atomic';
import { onConfigChange } from './config';
import { readJsoncFileWithDuplicates } from './jsonc';
import { errorText, log } from './log';
import { getMoved, getSettings as getMetaSettings, markMoved } from './meta';
import { settingsFile, settingsLocalFile } from './paths';
import { defaultSettings } from '../shared/defaults';
import { fileChanges, saveRefusal, SETTING_KEYS, settingProblem, settingsInForce, settingsView, valuesOf, type SettingKey, type SettingsChange, type SettingsFileRead, type SettingsSaved, type SettingsView } from '../shared/settings';
import type { Settings } from '../shared/types';

/**
 * The app's preferences, from the config folder: `settings.json`, which you edit and Settings saves into, read by the rules in shared/settings.ts.
 * Read afresh whenever asked, a session's start included, so an edit counts from the next session on.
 * A file that does not parse keeps what it last read in force, as the layout file does, so a half-saved edit costs nothing.
 */

/** What each file parsed to the last time it did, this run. */
const lastGood = new Map<string, unknown>();

async function readSettingsFile(file: string): Promise<SettingsFileRead> {
  const name = path.basename(file);
  const read = await readJsoncFileWithDuplicates(file);
  if (read.status === 'unparsable') return { name, ...read, json: lastGood.get(file) ?? null };
  // Gone is a choice, not a mistake: none of its settings count any more.
  if (read.status === 'missing') lastGood.delete(file);
  else lastGood.set(file, read.json);
  return { name, ...read };
}

/** What the last line said, so only a change is logged. */
let lastLine = '';

/**
 * What is wrong with the file, as a log line, written when it changes.
 * A setting's value is never written, since a flag's can hold text nobody meant to hand over; Settings says what is wrong with it.
 */
function noteSettings(view: SettingsView): void {
  const parts = [...view.notes, ...SETTING_KEYS.filter((key) => view[key].problem !== null).map((key) => `${key} in ${view.file.name} is not used, Settings says why`)];
  const line = parts.join('; ');
  if (line === lastLine) return;
  const had = lastLine !== '';
  lastLine = line;
  if (line !== '') log('warn', 'settings', line);
  else if (had) log('info', 'settings', 'the settings file read without a mistake');
}

/** The moves into `settings.json` from where settings were kept before, started when the app registers this module; every read waits for them. */
let moved: Promise<void> = Promise.resolve();

/** How many reads of the file have started this run, which numbers each (`SettingsView.read`). */
let reads = 0;

/** The settings as they stand, numbered as of when the read started, before the file is read. */
export async function readSettings(): Promise<SettingsView> {
  await moved;
  const read = ++reads;
  const view = settingsView(await readSettingsFile(settingsFile), read);
  noteSettings(view);
  return view;
}

/** The settings a session starts with. */
export async function settingsNow(): Promise<Settings> {
  return settingsInForce(await readSettings());
}

/** Write `change` into the file by the rules of `fileChanges`, against `view`. */
async function writeChange(view: SettingsView, change: SettingsChange): Promise<void> {
  const edits = fileChanges(view, change).map(({ key, value }) => ({ path: [key], value }));
  if (edits.length > 0) await editAppFile(settingsFile, edits);
}

/**
 * Settings' save: `change` into the file, refused with a reason rather than thrown, since the window shows the reason in the dialog.
 * A value is checked here as well as in the dialog, because main is what hands it to a session.
 */
export async function saveSettings(change: SettingsChange): Promise<SettingsSaved> {
  for (const key of SETTING_KEYS) {
    const value = change[key];
    const problem = value === undefined ? null : settingProblem(key, value);
    if (problem !== null) return { view: await readSettings(), refused: problem };
  }
  try {
    const view = await readSettings();
    const refused = saveRefusal(view, change);
    if (refused !== null) return { view, refused };
    await writeChange(view, change);
    return { view: await readSettings(), refused: null };
  } catch (error) {
    return { view: await readSettings(), refused: errorText(error) };
  }
}

/** Whether a read of a file holds `key` at all, used or not. */
function holds(file: SettingsFileRead, key: string): boolean {
  return typeof file.json === 'object' && file.json !== null && key in file.json;
}

/** What each setting is, as the line above it in a new `settings.json` says it. */
const STARTER_NOTES: Record<SettingKey, string> = {
  launchFlags: 'Flags added to every session the app starts, as you would type them',
  runningSessionsAtLaunch: 'What a launch does with the sessions that were running when the app closed: "start", "pause" or "leave"',
  prStatus: "Whether the app asks GitHub, with gh, what it says of the PRs your sessions link, which colours their marks",
};

/** A new `settings.json`: every setting at its default, under a line saying what it is. */
export function starterText(): string {
  const defaults = defaultSettings();
  const lines = SETTING_KEYS.map((key, at) => `  // ${STARTER_NOTES[key]}\n  ${JSON.stringify(key)}: ${JSON.stringify(defaults[key])}${at < SETTING_KEYS.length - 1 ? ',' : ''}`);
  return `{\n${lines.join('\n')}\n}\n`;
}

/**
 * A `settings.json` for a launch that finds none, so that launch leaves one to edit by hand: every setting at its default, which it then pins, as a value written by hand would.
 * Before the moves, which write their values over it.
 */
async function startFile(): Promise<void> {
  if (await startAppFile(settingsFile, starterText())) log('info', 'settings', `${path.basename(settingsFile)} written with every setting at its default, since there was none`);
}

/**
 * The launch flags, from where they were kept before the config folder, into `settings.json`: once, and only when they are not the default and the file's are, whether the starter wrote them or a person did; flags the file gives that cannot be used are left alone.
 * Meta's copy is left where it is, so an older build still finds it; `moved` records that it was made, so the file losing them later does not bring the old flags back.
 * A move that fails is tried again at the next launch.
 */
async function moveFromMeta(): Promise<void> {
  if ((await getMoved()).includes('launchFlags')) return;
  const { launchFlags } = await getMetaSettings();
  if (launchFlags !== defaultSettings().launchFlags) {
    const view = settingsView(await readSettingsFile(settingsFile));
    if (view.launchFlags.value === defaultSettings().launchFlags && view.launchFlags.problem === null) await writeChange(view, { launchFlags });
  }
  await markMoved('launchFlags');
  log('info', 'settings', launchFlags === defaultSettings().launchFlags ? 'no launch flags to move from meta.json' : `the launch flags moved from meta.json to ${path.basename(settingsFile)}`);
}

/**
 * What Settings saved into `settings.local.json` before it saved into `settings.json`, moved there: once, each value it holds that can be used written over the file's, since the app's file won, and then the app's file taken away, its text kept in the backups folder.
 * A `settings.json` that cannot be written, one that does not parse or holds no object, or one that names a setting the move would write more than once, which an edit could not change (`saveRefusal`), leaves the move for a launch where it can be made; until it is, what `settings.local.json` holds is not in force, which the log says.
 */
async function moveFromLocal(): Promise<void> {
  if ((await getMoved()).includes('settingsLocal')) return;
  const local = await readSettingsFile(settingsLocalFile);
  if (local.status === 'unparsable') {
    log('warn', 'settings', `${local.name} does not parse, so what it holds was not moved into ${path.basename(settingsFile)} and is not in force; the move is tried again at the next launch`);
    return;
  }
  const values = valuesOf(local);
  const change: SettingsChange = Object.fromEntries(SETTING_KEYS.filter((key) => holds(local, key) && values[key] !== undefined).map((key) => [key, values[key]]));
  const file = await readSettingsFile(settingsFile);
  if (file.status === 'unparsable') {
    log('warn', 'settings', `${file.name} does not parse, so what ${local.name} holds was not moved into it and is not in force; the move is tried again at the next launch`);
    return;
  }
  const view = settingsView(file);
  if (saveRefusal(view, change) !== null) {
    log('warn', 'settings', `${file.name} names a setting the move would write more than once, so what ${local.name} holds was not moved into it and is not in force; the move is tried again at the next launch`);
    return;
  }
  await writeChange(view, change);
  await removeAppFile(settingsLocalFile);
  await markMoved('settingsLocal');
  log('info', 'settings', local.status === 'missing' ? `no ${local.name} to move into ${file.name}` : `${local.name} moved into ${file.name} and taken away, its text kept in the backups folder`);
}

/** Answer the window's reads and saves, make the moves, and push the settings whenever the file changes on disk other than by the app's own write. */
export function registerSettings(getWindow: () => BrowserWindow | null): void {
  moved = startFile()
    .catch((error: unknown) => log('warn', 'settings', `${path.basename(settingsFile)} was not written with every setting at its default: ${errorText(error)}`))
    .then(moveFromMeta)
    .catch((error: unknown) => log('warn', 'settings', `the launch flags were not moved from meta.json, and will be tried again at the next launch: ${errorText(error)}`))
    .then(moveFromLocal)
    .catch((error: unknown) => log('warn', 'settings', `${path.basename(settingsLocalFile)} was not moved into ${path.basename(settingsFile)}, and will be tried again at the next launch: ${errorText(error)}`));
  ipcMain.handle('settings:get', () => readSettings());
  ipcMain.handle('settings:set', (_event, change: SettingsChange) => saveSettings(change));
  onConfigChange((paths) => {
    if (paths !== null && !paths.has(settingsFile) && !paths.has(tempOf(settingsFile))) return;
    void readSettings().then((view) => {
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.send('settings:changed', view);
    });
  });
}
