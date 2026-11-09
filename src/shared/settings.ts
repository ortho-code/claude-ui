import { defaultSettings } from './defaults';
import { parseLaunchFlags } from './flags';
import { looksProblem, strengthProblem, type Look } from './looks';
import { withChanges, type NeedsYouChange, type NeedsYouRegistry } from './needsyou';
import { approvalsProblem } from './prs';
import { presetsProblem } from './setaside';
import { timeOfDay } from './time';
import type { ReadStatus } from './panels';
import type { Settings } from './types';

/**
 * THE SETTINGS IN THE CONFIG FOLDER: `settings.json`, which you edit and Settings saves into, over the built-in default (docs/architecture/config.md § The config folder).
 * Pure and shared: main reads the file and answers with this, and the window's checks answer with the same rules rather than a copy of them.
 */

export type SettingKey = keyof Settings;

/** Every setting there is, in the order Settings shows them. */
export const SETTING_KEYS: SettingKey[] = ['launchFlags', 'runningSessionsAtLaunch', 'prStatus', 'leaveButton', 'setAside', 'setAsideTime', 'locale', 'strength', 'looks', 'needsYou', 'approvals'];

/**
 * The choices for the sessions that were running when the app closed (`Settings.runningSessionsAtLaunch`), in the order Settings offers them: start them again, or bring their tabs back cold.
 * Whether they are marked as needing you is the type `app.was-running`'s, switched off in `needsYou` (decided 2026-11-06).
 */
export const RUNNING_AT_LAUNCH = ['start', 'cold'] as const;
export type RunningAtLaunch = (typeof RUNNING_AT_LAUNCH)[number];

/**
 * The choices for a tab's button (`Settings.leaveButton`), in the order Settings offers them.
 * `"stop-archive"` and `"archive"`, their words before the act was called Finished, are not read: no release had them (decided 2026-11-05).
 */
export const LEAVE_BUTTON = ['stop-close', 'stop-finish', 'close', 'finish', 'none'] as const;
export type LeaveButton = (typeof LEAVE_BUTTON)[number];

/** The check of a setting that is one of a fixed list of words. */
const oneOf =
  <T extends string>(choices: readonly T[]): Check<T> =>
  (value) =>
    choices.find((choice) => choice === value) !== undefined ? { ok: true, value: value as T } : { ok: false, why: `It has to be one of ${choices.map((choice) => `"${choice}"`).join(', ')}.` };

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
  /** The needs-you categories and types in force: the ones the app ships, with `needsYou` applied where it can be used; null for a view made without them. */
  needsYouRegistry: NeedsYouRegistry | null;
  /** By id, the fields `needsYou` in force gives a value other than what the app ships, an id it names to no effect, such as `{ "enabled": true }` on a type that is on, left out; every field it names, for a view made without what the app ships. */
  needsYouChanges: Record<string, string[]>;
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
  // `mark`, `pause` (what `mark` was called while those sessions came back paused) and `leave` were the choices while the setting also said whether they were marked, and read as `cold`, which brings the tabs back as all three did; whether they are marked is now the type's (decided 2026-11-06), and none was released.
  runningSessionsAtLaunch: (value) => oneOf(RUNNING_AT_LAUNCH)(value === 'mark' || value === 'pause' || value === 'leave' ? 'cold' : value),
  prStatus: (value) => (typeof value === 'boolean' ? { ok: true, value } : { ok: false, why: 'It has to be true or false.' }),
  leaveButton: oneOf(LEAVE_BUTTON),
  setAside: (value) => {
    const why = presetsProblem(value);
    return why === null ? { ok: true, value: [...(value as string[])] } : { ok: false, why };
  },
  setAsideTime: (value) => (typeof value === 'string' && timeOfDay(value) !== null ? { ok: true, value } : { ok: false, why: 'It has to be a time of day as "HH:MM", in 24 hours, such as "09:00".' }),
  locale: (value) => {
    const tag = typeof value === 'string' ? languageTag(value) : null;
    return tag !== null ? { ok: true, value: tag } : { ok: false, why: 'It has to be a language tag such as "en-GB" or "nl-NL", or "" for the system\'s language.' };
  },
  // Its categories, and the looks' ids, are checked against the needs-you categories and types in force where they are given (`settingsView`), since which there are is the needs-you files' and `needsYou`'s to say.
  strength: (value) => {
    const why = strengthProblem(value, null);
    return why === null ? { ok: true, value: [...(value as string[])] } : { ok: false, why };
  },
  looks: (value) => {
    const why = looksProblem(value, null);
    return why === null ? { ok: true, value: structuredClone(value as Record<string, Look>) } : { ok: false, why };
  },
  // Only its shape here: what each entry may change is checked against the categories and types the app ships, where they are given (`settingsView`).
  needsYou: (value) =>
    isObject(value) && Object.values(value).every(isObject)
      ? { ok: true, value: structuredClone(value) as Record<string, NeedsYouChange> }
      : { ok: false, why: 'It has to be an object of ids, each an object of the fields it changes, such as { "pr.merged": { "enabled": false } }.' },
  approvals: (value) => {
    const why = approvalsProblem(value);
    return why === null ? { ok: true, value: { ...(value as Record<string, number>) } } : { ok: false, why };
  },
};

/** `value` as the one language tag it spells, in its usual case (`"en-gb"` reads as `"en-GB"`), `""` for the system's language, or null for anything else, such as the `C` a machine's `LANG` may hold. */
export function languageTag(value: string): string | null {
  if (value === '') return '';
  try {
    return Intl.getCanonicalLocales(value)[0] ?? null;
  } catch {
    return null;
  }
}

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

/**
 * The settings in force from `file`, each its value there or the default, and what is wrong with the file, as main's read number `read` found it.
 * With the needs-you categories and types the app ships, `bundled`, `needsYou` is checked against them and applied, used whole or not at all, and a category the strength order names, or an id the looks name, that the result does not have is a mistake too.
 */
export function settingsView(file: SettingsFileRead, read = 0, bundled: NeedsYouRegistry | null = null): SettingsView {
  const notes: string[] = [];
  const problems = new Map<SettingKey, string>();
  const values = valuesOf(file, notes, problems);
  const changed = bundled === null || values.needsYou === undefined ? null : withChanges(bundled, values.needsYou);
  if (changed !== null && changed.problems.length > 0) {
    delete values.needsYou;
    problems.set('needsYou', changed.problems.join('; '));
  }
  const registry = changed === null || changed.problems.length > 0 ? bundled : changed.registry;
  const unknownCategory = values.strength === undefined ? null : strengthProblem(values.strength, registry);
  if (unknownCategory !== null) {
    delete values.strength;
    problems.set('strength', unknownCategory);
  }
  const unknownId = values.looks === undefined ? null : looksProblem(values.looks, registry);
  if (unknownId !== null) {
    delete values.looks;
    problems.set('looks', unknownId);
  }
  const defaults = defaultSettings();
  const viewOf = <K extends SettingKey>(key: K): SettingView<Settings[K]> => ({ value: values[key] ?? defaults[key], problem: problems.get(key) ?? null });
  // What the app ships of an id, field by field; none without what it ships, so every field named counts as a change.
  const shipped = (id: string): Map<string, unknown> | undefined => {
    const found = bundled?.categories.find((category) => category.id === id) ?? bundled?.types.find((type) => type.id === id);
    return found === undefined ? undefined : new Map(Object.entries(found));
  };
  const needsYouChanges = Object.fromEntries(
    Object.entries(values.needsYou ?? {}).flatMap(([id, change]) => {
      const before = shipped(id);
      const fields = Object.entries(change)
        .filter(([field, value]) => before === undefined || !sameValue(value, before.get(field)))
        .map(([field]) => field);
      return fields.length === 0 ? [] : [[id, fields]];
    }),
  );
  return {
    launchFlags: viewOf('launchFlags'),
    runningSessionsAtLaunch: viewOf('runningSessionsAtLaunch'),
    prStatus: viewOf('prStatus'),
    leaveButton: viewOf('leaveButton'),
    setAside: viewOf('setAside'),
    setAsideTime: viewOf('setAsideTime'),
    locale: viewOf('locale'),
    strength: viewOf('strength'),
    looks: viewOf('looks'),
    needsYou: viewOf('needsYou'),
    approvals: viewOf('approvals'),
    read,
    notes,
    file: { name: file.name, status: file.status, error: file.error, duplicates: file.duplicates ?? [] },
    needsYouRegistry: registry,
    needsYouChanges,
  };
}

/** The settings in force, as a session is started with them. */
export function settingsInForce(view: SettingsView): Settings {
  return { launchFlags: view.launchFlags.value, runningSessionsAtLaunch: view.runningSessionsAtLaunch.value, prStatus: view.prStatus.value, leaveButton: view.leaveButton.value, setAside: view.setAside.value, setAsideTime: view.setAsideTime.value, locale: view.locale.value, strength: view.strength.value, looks: view.looks.value, needsYou: view.needsYou.value, approvals: view.approvals.value };
}

/**
 * What to write into the file for `change`: each setting whose value differs from the one in force, or whose value in the file is not used, so a save puts a used one in its place.
 * Otherwise a value equal to the one in force writes nothing: the file already says it, or the default does where the file says nothing, so a key is never added only to repeat the default.
 */
export function fileChanges(view: SettingsView, change: SettingsChange): { key: SettingKey; value: Settings[SettingKey] }[] {
  return SETTING_KEYS.flatMap((key) => {
    const value = change[key];
    return value !== undefined && (!sameValue(value, view[key].value) || view[key].problem !== null) ? [{ key, value }] : [];
  });
}

/**
 * The edits of the file's text that write `fileChanges`: a setting whose value is an object, such as `needsYou`, entry by entry where the file's value is used, so the entries it leaves alone keep the comments around them; any other setting, or one whose value in the file is not used, whole.
 * An entry taken out is a key removed, which takes the comment before it along; every other edit keeps the text around it.
 */
export function fileEdits(view: SettingsView, change: SettingsChange): { path: string[]; value: unknown }[] {
  return fileChanges(view, change).flatMap(({ key, value }): { path: string[]; value: unknown }[] => {
    const before = view[key].value;
    if (view[key].problem !== null || !isObject(value) || !isObject(before)) return [{ path: [key], value }];
    const ids = new Set([...Object.keys(before), ...Object.keys(value)]);
    return [...ids].filter((id) => !sameValue(value[id], before[id])).map((id) => ({ path: [key, id], value: value[id] }));
  });
}

/** Whether two values of a setting are the same: a list item by item and an object key by key, in any order, since the one a save sends is never the one in force. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((item, at) => sameValue(item, b[at]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
  }
  return a === b;
}

/**
 * A setting whose value in force differs from the app's default, or whose value in the file is not used.
 * `needsYou` is one per id it changes, `id` naming it, so each can be reset alone; `value` is what is in force for that one.
 */
export interface ChangedSetting {
  key: SettingKey;
  id: string | null;
  value: unknown;
  fallback: unknown;
  problem: string | null;
}

/** Every setting that differs from the app's default in `view`, or whose value in the file is not used, in the order Settings shows them. */
export function changedSettings(view: SettingsView): ChangedSetting[] {
  const defaults = defaultSettings();
  return SETTING_KEYS.flatMap((key): ChangedSetting[] => {
    const { value, problem } = view[key];
    if (problem !== null) return [{ key, id: null, value, fallback: defaults[key], problem }];
    if (key === 'needsYou') return Object.keys(view.needsYouChanges).map((id) => ({ key, id, value: view.needsYou.value[id], fallback: null, problem: null }));
    return sameValue(value, defaults[key]) ? [] : [{ key, id: null, value, fallback: defaults[key], problem: null }];
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
