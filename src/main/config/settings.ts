import { ipcMain, type BrowserWindow } from 'electron';
import * as path from 'node:path';
import { editAppFile, removeAppFile, startAppFile } from './app-files';
import { tempOf } from '../files/atomic';
import { onConfigChange } from './config';
import { readJsoncFileWithDuplicates } from './jsonc';
import { errorText, log } from '../logs/log';
import { getMoved, getSettings as getMetaSettings, markMoved } from '../sessions/meta';
import { settingsFile, settingsLocalFile } from '../paths';
import { defaultSettings } from '../../shared/config/defaults';
import { NO_NEEDS_YOU_TYPES, type NeedsYouRegistry } from '../../shared/status/needs-you';
import { fileEdits, saveRefusal, SETTING_KEYS, settingProblem, settingsInForce, settingsView, valuesOf, type SettingKey, type SettingsChange, type SettingsFileRead, type SettingsSaved, type SettingsView } from '../../shared/config/settings';
import type { Settings } from '../../shared/types';

/**
 * The app's preferences, from the config folder: `settings.json`, which you edit and Settings saves into, read by the rules in shared/config/settings.ts.
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

/** The needs-you categories and types the app ships, which `needsYou` is applied to and checked against; none until the app registers this module. */
let bundledNow: () => Promise<NeedsYouRegistry | null> = () => Promise.resolve(null);

/** The settings as they stand, numbered as of when the read started, before the file is read. */
export async function readSettings(): Promise<SettingsView> {
  await moved;
  const read = ++reads;
  const view = settingsView(await readSettingsFile(settingsFile), read, await bundledNow());
  noteSettings(view);
  return view;
}

/** The settings a session starts with. */
export async function settingsNow(): Promise<Settings> {
  return settingsInForce(await readSettings());
}

/** Write `change` into the file by the rules of `fileChanges`, as `fileEdits` edits its text, against `view`. */
async function writeChange(view: SettingsView, change: SettingsChange): Promise<void> {
  const edits = fileEdits(view, change);
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
  runningSessionsAtLaunch: 'What a launch does with the sessions that were running when the app closed: "cold" brings their tabs back without starting them, "start" starts them again; either way they are marked as needing you, unless "needsYou" below switches "app.was-running" off',
  prStatus: 'Whether the app asks GitHub, with gh, what it says of the PRs your sessions link, which colours their marks and lets the PR types mark a session as needing you when one changes, such as merged or changes requested; turned on, it starts from the PRs as they are then',
  leaveButton: 'What a tab\'s button does: "stop-close" stops a running session and then closes the tab, "stop-finish" stops it and then marks its session finished, "close" and "finish" do so in one press, and "none" leaves it to the tab\'s menu',
  setAside: 'The choices for setting a session aside, offered in the order they come with "whenever" last: "whenever", "in 30m", "in 2h", "in 3d", "in 1w", "tomorrow" or "next monday", a day with a time such as "09:00" or else the time below',
  setAsideTime: 'The time of day, as "HH:MM" in 24 hours, a choice without one comes back at',
  locale: 'The language the app formats times and dates in, such as "en-GB" or "nl-NL", or "" for the system\'s; a time field follows it from the next launch',
  strength: 'Which state a session\'s dot shows when several hold, the first that holds: every status once, "needs-you" for every needs-you category not named, and any category, such as "back-to-work", named on its own where it should rank',
  looks: 'How a status, "needs-you", a needs-you category or type is drawn, by its id, such as "finish-up": { "colour": "green" }: "colour" a name such as "peach" or "#rrggbb", "mark" "dot", "ring", "spinner" or an icon\'s name, "core" a colour inside a spinner, "pulse" true or false, and "looksLike" another id whose look it takes for the rest',
  needsYou: 'What you change of the needs-you categories and types the app ships, by id, such as "pr.merged": { "enabled": false }: a category its "label", "order" and "enabled", a type its "label", "category" and "enabled", and a PR\'s type its "roles", of "own", "reviewing" and "other"',
  approvals: 'How many approvals a PR needs before it counts as approved, by repository, such as "acme/app": 2; a repository not named counts as approved when GitHub says so',
};

/** A new `settings.json`: every setting at its default, under a line saying what it is. */
export function starterText(): string {
  const defaults = defaultSettings();
  // A list on one line with a space after each comma, as a person would write it.
  const written = (value: unknown): string => (Array.isArray(value) ? `[${value.map((item) => JSON.stringify(item)).join(', ')}]` : JSON.stringify(value));
  const lines = SETTING_KEYS.map((key, at) => `  // ${STARTER_NOTES[key]}\n  ${JSON.stringify(key)}: ${written(defaults[key])}${at < SETTING_KEYS.length - 1 ? ',' : ''}`);
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

/** Where the settings are pushed to; none until the app registers this module. */
let windowNow: () => BrowserWindow | null = () => null;

/** The needs-you categories and types in force the window was last given, as text, so they are told again only when a change changes them. */
let toldNeedsYou: string | null = null;

/** The needs-you categories and types in force in `view`, kept as the ones the window was given. */
function needsYouOf(view: SettingsView): NeedsYouRegistry {
  const registry = view.needsYouRegistry ?? NO_NEEDS_YOU_TYPES;
  toldNeedsYou = JSON.stringify(registry);
  return registry;
}

/** Read the settings and push them to the window after the file changed, and the needs-you categories and types in force too when `needsYou` changed them. */
function tellSettings(): void {
  void readSettings().then((view) => {
    const win = windowNow();
    if (!win || win.isDestroyed()) return;
    win.webContents.send('settings:changed', view);
    if (JSON.stringify(view.needsYouRegistry ?? NO_NEEDS_YOU_TYPES) !== toldNeedsYou) win.webContents.send('needsYou:changed', needsYouOf(view));
  });
}

/**
 * Answer the window's reads and saves, and its ask for the needs-you categories and types in force; make the moves; and push the settings whenever the file changes on disk other than by the app's own write.
 * `bundled` gives the needs-you categories and types the app ships, which `needsYou` changes.
 */
export function registerSettings(getWindow: () => BrowserWindow | null, bundled: () => Promise<NeedsYouRegistry>): void {
  windowNow = getWindow;
  bundledNow = bundled;
  ipcMain.handle('needsYou:types', async () => needsYouOf(await readSettings()));
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
    tellSettings();
  });
}
