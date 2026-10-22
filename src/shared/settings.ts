import { defaultSettings } from './defaults';
import { parseLaunchFlags } from './flags';
import type { ReadStatus } from './panels';
import type { Settings } from './types';

/**
 * THE SETTINGS IN THE CONFIG FOLDER: `settings.json`, which you edit and Settings saves into, over the built-in default (docs/architecture.md § The config folder).
 * Pure and shared: main reads the file and answers with this, and the window's checks answer with the same rules rather than a copy of them.
 */

export type SettingKey = keyof Settings;

/** Every setting there is, in the order Settings shows them. */
export const SETTING_KEYS: SettingKey[] = ['launchFlags', 'runningSessionsAtLaunch', 'prStatus'];

/** The choices for the sessions that were running when the app closed (`Settings.runningSessionsAtLaunch`), in the order Settings offers them. */
export const RUNNING_AT_LAUNCH = ['start', 'pause', 'leave'] as const;
export type RunningAtLaunch = (typeof RUNNING_AT_LAUNCH)[number];

/** One read of a settings file, as main hands it over. */
export interface SettingsFileRead {
  /** The file's name, for what is said about it. */
  name: string;
  status: ReadStatus;
  /** For a file that does not parse, what is wrong and where. */
  error: string | null;
  /** What it parsed to; for a file that does not parse now, what it parsed to the last time it did, or null. */
  json: unknown;
  /** The keys it names more than once, of which `json` holds the last; none when left out, and none for a file that does not parse, whose `json` is an earlier read's. */
  duplicates?: string[];
}

/** One setting, as Settings shows it. */
export interface SettingView<T> {
  /** The value in force: the file's, or the default where the file gives none that can be used. */
  value: T;
  /** Why the value the file gives it is not used, null when it gives none or one that is; kept apart from what is said around it, because it can quote the value, which the log must not. */
  problem: string | null;
}

/** What Settings' save comes back with: the settings as they then stand, and why the file was not written, when it was not. */
export interface SettingsSaved {
  view: SettingsView;
  refused: string | null;
}

/** Every setting as Settings shows it, by its key. */
export type SettingViews = { [K in SettingKey]: SettingView<Settings[K]> };

export type SettingsView = SettingViews & {
  /**
   * Which of main's reads of the file this is (`readSettings`), counted from launch, 0 for a view made otherwise.
   * A read started later has a higher number, whatever order views arrive in: a change main tells of can have been read before a save that is answered first.
   * Every change main tells of, and every save, is followed by a read started after it, main's telling or the save's answer; a hand edit that leaves the file exactly as the app last wrote it is taken for the app's own write and is not told.
   */
  read: number;
  /** What is wrong with the file as a whole: one that does not parse, does not hold an object, names a setting the app does not have, or names a setting more than once, which is not known while it does not parse. */
  notes: string[];
  /** The file as read, so the window can say when it does not parse, and a save can be refused for a key it names more than once. */
  file: Omit<SettingsFileRead, 'json' | 'duplicates'> & { duplicates: string[] };
};

/** A save from Settings: the value of each setting it asks for. */
export type SettingsChange = { [K in SettingKey]?: Settings[K] };

type Check<T> = (value: unknown) => { ok: true; value: T } | { ok: false; why: string };

/** What each setting may hold, checked the same in the file and in what Settings saves. */
const CHECKS: { [K in SettingKey]: Check<Settings[K]> } = {
  launchFlags: (value) => {
    if (typeof value !== 'string') return { ok: false, why: 'It has to be text: the flags as you would type them.' };
    const { error } = parseLaunchFlags(value);
    return error === null ? { ok: true, value } : { ok: false, why: error };
  },
  runningSessionsAtLaunch: (value) =>
    RUNNING_AT_LAUNCH.find((choice) => choice === value) !== undefined
      ? { ok: true, value: value as RunningAtLaunch }
      : { ok: false, why: `It has to be one of ${RUNNING_AT_LAUNCH.map((choice) => `"${choice}"`).join(', ')}.` },
  prStatus: (value) => (typeof value === 'boolean' ? { ok: true, value } : { ok: false, why: 'It has to be true or false.' }),
};

/** Whether `value` may be a setting's value, and if not, why: what main refuses to write. */
export function settingProblem(key: SettingKey, value: unknown): string | null {
  const checked = CHECKS[key](value);
  return checked.ok ? null : checked.why;
}

const isObject = (json: unknown): json is Record<string, unknown> => typeof json === 'object' && json !== null && !Array.isArray(json);

/** A file's usable values, with what is wrong with it said into `notes` and, per setting, into `problems`. */
export function valuesOf(file: SettingsFileRead, notes: string[] = [], problems = new Map<SettingKey, string>()): Partial<Settings> {
  if (file.status === 'missing') return {};
  if (file.status === 'unparsable') notes.push(`${file.name} does not parse: ${file.error ?? 'it could not be read'}. ${file.json === null ? 'None of its settings are used until it does.' : 'The settings it last read stay in force.'}`);
  if (file.status === 'unparsable' && file.json === null) return {};
  if (!isObject(file.json)) {
    notes.push(`${file.name} has to hold one object, { … }, so none of it is used.`);
    return {};
  }
  // A key that is no setting has a note of its own below, whichever of its namings is read.
  for (const key of (file.duplicates ?? []).filter((named) => (SETTING_KEYS as string[]).includes(named))) {
    notes.push(`${file.name} names "${key}" more than once: the last is the one read, and Settings refuses a save that would change it until only one is left.`);
  }
  const values: Partial<Settings> = {};
  // Typed per key: with settings of more than one type, an assignment through a key that could be any of them does not compile.
  const keep = <K extends SettingKey>(setting: K, value: Settings[K]): void => {
    values[setting] = value;
  };
  for (const [key, value] of Object.entries(file.json)) {
    if (!(SETTING_KEYS as string[]).includes(key)) {
      notes.push(`${file.name}: "${key}" is not a setting the app has.`);
      continue;
    }
    const setting = key as SettingKey;
    const checked = CHECKS[setting](value);
    if (checked.ok) keep(setting, checked.value);
    else problems.set(setting, checked.why);
  }
  return values;
}

/** The settings in force from `file`, each its value there or the default, and what is wrong with the file, as main's read number `read` found it. */
export function settingsView(file: SettingsFileRead, read = 0): SettingsView {
  const notes: string[] = [];
  const problems = new Map<SettingKey, string>();
  const values = valuesOf(file, notes, problems);
  const defaults = defaultSettings();
  const viewOf = <K extends SettingKey>(key: K): SettingView<Settings[K]> => ({ value: values[key] ?? defaults[key], problem: problems.get(key) ?? null });
  return {
    launchFlags: viewOf('launchFlags'),
    runningSessionsAtLaunch: viewOf('runningSessionsAtLaunch'),
    prStatus: viewOf('prStatus'),
    read,
    notes,
    file: { name: file.name, status: file.status, error: file.error, duplicates: file.duplicates ?? [] },
  };
}

/** The settings in force, as a session is started with them. */
export function settingsInForce(view: SettingsView): Settings {
  return { launchFlags: view.launchFlags.value, runningSessionsAtLaunch: view.runningSessionsAtLaunch.value, prStatus: view.prStatus.value };
}

/**
 * What to write into the file for `change`: each setting whose value differs from the one in force, or whose value in the file is not used, so a save puts a used one in its place.
 * Otherwise a value equal to the one in force writes nothing: the file already says it, or the default does where the file says nothing, so a key is never added only to repeat the default.
 */
export function fileChanges(view: SettingsView, change: SettingsChange): { key: SettingKey; value: Settings[SettingKey] }[] {
  return SETTING_KEYS.flatMap((key) => {
    const value = change[key];
    return value !== undefined && (value !== view[key].value || view[key].problem !== null) ? [{ key, value }] : [];
  });
}

/**
 * Why a save of `change` cannot be written, null when it can: it would write a setting the file names more than once.
 * An edit reaches the first of them while the last is the one read, so the save would change nothing in force; refusing says so rather than seeming to work.
 */
export function saveRefusal(view: SettingsView, change: SettingsChange): string | null {
  const twice = fileChanges(view, change)
    .map(({ key }) => key)
    .filter((key) => view.file.duplicates.includes(key));
  return twice.length === 0 ? null : `${view.file.name} names ${twice.map((key) => `"${key}"`).join(' and ')} more than once, so nothing was saved: leave one of each, then save again.`;
}
