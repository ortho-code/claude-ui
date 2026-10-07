import { defaultSettings } from './defaults';
import { parseLaunchFlags } from './flags';
import type { ReadStatus } from './panels';
import type { Settings } from './types';

/**
 * THE SETTINGS IN THE CONFIG FOLDER: your `settings.json`, then the app's `settings.local.json` over it, over the built-in default (docs/architecture.md § The config folder).
 * Pure and shared: main reads the two files and answers with this, and the window's checks answer with the same rules rather than a copy of them.
 */

export type SettingKey = keyof Settings;

/** Every setting there is, in the order Settings shows them. */
export const SETTING_KEYS: SettingKey[] = ['launchFlags'];

/** Where a setting in force came from. */
export type SettingSource = 'default' | 'yours' | 'app';

/** One read of one of the two files, as main hands it over. */
export interface SettingsFileRead {
  /** The file's name, for what is said about it. */
  name: string;
  status: ReadStatus;
  /** For a file that does not parse, what is wrong and where. */
  error: string | null;
  /** What it parsed to; for a file that does not parse now, what it parsed to the last time it did, or null. */
  json: unknown;
}

/** One setting, as Settings shows it. */
export interface SettingView<T> {
  /** The value in force. */
  value: T;
  source: SettingSource;
  /** What would be in force without the app's value: yours, or the default where your file says nothing; what "Use settings.json" goes back to. */
  without: T;
  /** Which of the two `without` is. */
  withoutSource: 'yours' | 'default';
  /**
   * What is wrong with a value a file gives it, which is then not used: the file's name, and why.
   * Kept apart rather than as one sentence, because `why` can quote the value, which the log must not.
   */
  problems: { file: string; why: string }[];
}

/** What Settings' save comes back with: the settings as they then stand, and why the app's file was not written, when it was not. */
export interface SettingsSaved {
  view: SettingsView;
  refused: string | null;
}

export type SettingsView = { [K in SettingKey]: SettingView<Settings[K]> } & {
  /** What is wrong with a file as a whole: one that does not parse, does not hold an object, or names a setting the app does not have. */
  notes: string[];
  /** The two files as read, so the window can say when one does not parse. */
  files: { yours: Omit<SettingsFileRead, 'json'>; app: Omit<SettingsFileRead, 'json'> };
};

/** A change asked of the app's file: a value for a setting, or null to leave it to your file. */
export type SettingsChange = { [K in SettingKey]?: Settings[K] | null };

type Check<T> = (value: unknown) => { ok: true; value: T } | { ok: false; why: string };

/** What each setting may hold, checked the same in either file and in what Settings saves. */
const CHECKS: { [K in SettingKey]: Check<Settings[K]> } = {
  launchFlags: (value) => {
    if (typeof value !== 'string') return { ok: false, why: 'It has to be text: the flags as you would type them.' };
    const { error } = parseLaunchFlags(value);
    return error === null ? { ok: true, value } : { ok: false, why: error };
  },
};

/** Whether `value` may be a setting's value, and if not, why: what main refuses to write. */
export function settingProblem(key: SettingKey, value: unknown): string | null {
  const checked = CHECKS[key](value);
  return checked.ok ? null : checked.why;
}

const isObject = (json: unknown): json is Record<string, unknown> => typeof json === 'object' && json !== null && !Array.isArray(json);

/** A file's usable values, with what is wrong with it said into `notes` and, per setting, into `problems`. */
function valuesOf(file: SettingsFileRead, notes: string[], problems: Map<SettingKey, SettingView<unknown>['problems']>): Partial<Settings> {
  if (file.status === 'missing') return {};
  if (file.status === 'unparsable') notes.push(`${file.name} does not parse: ${file.error ?? 'it could not be read'}. ${file.json === null ? 'None of its settings are used until it does.' : 'The settings it last read stay in force.'}`);
  if (file.status === 'unparsable' && file.json === null) return {};
  if (!isObject(file.json)) {
    notes.push(`${file.name} has to hold one object, { … }, so none of it is used.`);
    return {};
  }
  const values: Partial<Settings> = {};
  for (const [key, value] of Object.entries(file.json)) {
    if (!(SETTING_KEYS as string[]).includes(key)) {
      notes.push(`${file.name}: "${key}" is not a setting the app has.`);
      continue;
    }
    const setting = key as SettingKey;
    const checked = CHECKS[setting](value);
    if (checked.ok) values[setting] = checked.value;
    else problems.set(setting, [...(problems.get(setting) ?? []), { file: file.name, why: checked.why }]);
  }
  return values;
}

/** The settings in force, and for each where it came from and what it would be without the app's value. */
export function settingsView(yours: SettingsFileRead, app: SettingsFileRead): SettingsView {
  const notes: string[] = [];
  const problems = new Map<SettingKey, SettingView<unknown>['problems']>();
  const mine = valuesOf(yours, notes, problems);
  const apps = valuesOf(app, notes, problems);
  const defaults = defaultSettings();
  const viewOf = <K extends SettingKey>(key: K): SettingView<Settings[K]> => {
    const without = mine[key] ?? defaults[key];
    const own = apps[key];
    const withoutSource = mine[key] !== undefined ? 'yours' : 'default';
    return { value: own ?? without, source: own !== undefined ? 'app' : withoutSource, without, withoutSource, problems: problems.get(key) ?? [] };
  };
  const strip = ({ name, status, error }: SettingsFileRead): Omit<SettingsFileRead, 'json'> => ({ name, status, error });
  return { launchFlags: viewOf('launchFlags'), notes, files: { yours: strip(yours), app: strip(app) } };
}

/** The settings in force, as a session is started with them. */
export function settingsInForce(view: SettingsView): Settings {
  return { launchFlags: view.launchFlags.value };
}

/**
 * What to write to the app's file for `change`, a setting each: its value, or undefined to remove the app's.
 * The app's file holds only what differs from what would be in force without it, so a value equal to that removes the app's instead of keeping a copy, which would hide a later edit of your file behind a value that only looked like a choice; null asks for that removal outright.
 */
export function appFileChanges(view: SettingsView, change: SettingsChange): { key: SettingKey; value: Settings[SettingKey] | undefined }[] {
  return SETTING_KEYS.filter((key) => key in change).map((key) => {
    const value = change[key];
    return { key, value: value === null || value === undefined || value === view[key].without ? undefined : value };
  });
}
