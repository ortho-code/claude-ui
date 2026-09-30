import { OPTION_NAME, type TypeReport } from '../../../shared/panels';
import { ICON_NAMES, isIconName, type IconName } from '../icons';
import { ID_PATTERN, SLUG_RULE } from '../layout';
import { CWD_OPTION, INTERVAL_OPTION, isFixedPath, valueProblem, type OptionDecl } from '../options';
import { fieldsOf, unknownFields } from '../fields';
import type { PanelType } from './command';
import { mountList } from './list';

/**
 * Panel types of a person's own, from the config folder's `types/`: a folder each, holding a `panel.json` manifest and the script it runs.
 *
 * THE FOLDER'S NAME IS THE TYPE'S NAME, so the two cannot disagree, and a type is shared by copying its folder.
 * THE KIND DECIDES THE REST: a manifest says what kind of panel it is, and the kind brings its own options and behaviour. This build has one, `list`: a script that prints a list the app draws (list.ts).
 * A manifest is checked the way the layout file is (layout.ts): every mistake named, and nothing dropped. A type whose manifest is wrong is still a type, so every entry of it says what is wrong where the panel would be, rather than reading as a type nobody has.
 * A field this build does not read is NOTED rather than refused, so a manifest written for a later build still runs here, and a typo is still seen.
 */

/** The manifest's `version`: the one shape this build reads. */
export const MANIFEST_VERSION = 1;

export const KINDS = ['list'] as const;
export type Kind = (typeof KINDS)[number];

/** The option kinds a manifest can declare in this build. */
export const MANIFEST_OPTION_KINDS = ['text'] as const;

/**
 * The fields of `panel.json` and of an option in it: the ONE place they are named (see fields.ts), which `docs/panel-types.md` is held to by a test.
 */
export const MANIFEST_FIELDS = ['version', 'kind', 'title', 'icon', 'run', 'interval', 'options'] as const;
export const OPTION_FIELDS = ['name', 'kind'] as const;

/** What every type of a kind takes without its manifest declaring it. */
export const KIND_OPTIONS: Record<Kind, OptionDecl[]> = { list: [CWD_OPTION, INTERVAL_OPTION] };

/** A manifest as this build reads it, once checked. */
export interface Manifest {
  kind: Kind;
  title: string | null;
  icon: IconName | null;
  /** The script, relative to the type's folder and inside it. */
  run: string;
  /** How often it runs again on its own, unless an entry says otherwise; null for only when shown and on Refresh. */
  interval: string | null;
  /** The options it declares, beyond its kind's own. */
  options: OptionDecl[];
}

/** One type folder, checked: the manifest when it is sound, and what to say about the folder either way. */
export interface FolderType {
  name: string;
  dir: string;
  manifest: Manifest | null;
  /** What stops the type's panels running, one sentence each, each naming the file. */
  problems: string[];
  /** What does not stop them. */
  notes: string[];
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Whether a relative path climbs out of the folder it is relative to, `a/../../b` included. */
export function escapes(value: string): boolean {
  let depth = 0;
  for (const part of value.split('/')) {
    if (part === '..') depth -= 1;
    else if (part !== '' && part !== '.') depth += 1;
    if (depth < 0) return true;
  }
  return false;
}

/** A manifest's declared options: what they are when every one is sound, and what is wrong with them. */
function checkOptionList(raw: unknown, kind: Kind | null): { options: OptionDecl[]; problems: string[]; notes: string[] } {
  const options: OptionDecl[] = [];
  const problems: string[] = [];
  const notes: string[] = [];
  if (raw === undefined) return { options, problems, notes };
  if (!Array.isArray(raw)) return { options, problems: ['options is not an array.'], notes };
  const own = kind ? KIND_OPTIONS[kind].map((option) => option.name) : [];
  raw.forEach((entry: unknown, index) => {
    if (!isObject(entry)) {
      problems.push(`options[${index}] is not an object.`);
      return;
    }
    const field = fieldsOf(entry, OPTION_FIELDS);
    const name = field('name');
    const optionKind = field('kind');
    if (typeof name !== 'string') {
      problems.push(`options[${index}] has no name.`);
      return;
    }
    if (!OPTION_NAME.test(name)) problems.push(`option "${name}" is not lowercase letters, digits and underscores, starting with a letter.`);
    else if (own.includes(name)) problems.push(`option ${name} is the ${kind} kind’s own; call it something else.`);
    else if (options.some((option) => option.name === name)) problems.push(`option ${name} is declared twice.`);
    if (optionKind === undefined) problems.push(`option ${name} has no kind (it can be: ${MANIFEST_OPTION_KINDS.join(', ')}).`);
    else if (!MANIFEST_OPTION_KINDS.includes(optionKind as (typeof MANIFEST_OPTION_KINDS)[number])) {
      problems.push(`option ${name}: kind ${JSON.stringify(optionKind)} is not one a manifest can declare in this build (it can: ${MANIFEST_OPTION_KINDS.join(', ')}).`);
    }
    for (const other of unknownFields(entry, OPTION_FIELDS)) notes.push(`option ${name}: ${other} is not a field this build reads; it is ignored.`);
    options.push({ name, kind: 'text' });
  });
  return { options, problems, notes };
}

/** One type folder's manifest, checked. Pure, and tested per rule. */
export function checkManifest(report: TypeReport): FolderType {
  const at = `types/${report.name}/panel.json`;
  const folder = { name: report.name, dir: report.dir, manifest: null, notes: [] };
  if (report.status === 'missing') return { ...folder, problems: [`types/${report.name} has no panel.json.`] };
  if (report.status === 'unparsable') return { ...folder, problems: [`${at} does not parse: ${report.error ?? 'it could not be read'}.`] };
  const json = report.json;
  if (!isObject(json)) return { ...folder, problems: [`${at} is not a JSON object.`] };

  const problems: string[] = [];
  const notes: string[] = [];
  const field = fieldsOf(json, MANIFEST_FIELDS);
  const version = field('version');
  if (version === undefined) problems.push(`version is missing (this build reads ${MANIFEST_VERSION}).`);
  else if (version !== MANIFEST_VERSION) problems.push(`version ${JSON.stringify(version)} is not one this build reads (it reads ${MANIFEST_VERSION}).`);

  const rawKind = field('kind');
  let kind: Kind | null = null;
  if (rawKind === undefined) problems.push(`kind is missing (this build has: ${KINDS.join(', ')}).`);
  else if (!KINDS.includes(rawKind as Kind)) problems.push(`kind ${JSON.stringify(rawKind)} is not a kind this build has (it has: ${KINDS.join(', ')}).`);
  else kind = rawKind as Kind;

  const rawTitle = field('title');
  let title: string | null = null;
  if (rawTitle !== undefined && typeof rawTitle !== 'string') problems.push('title is not a string.');
  else if (typeof rawTitle === 'string' && rawTitle.trim() === '') problems.push('title is empty.');
  else if (typeof rawTitle === 'string') title = rawTitle;

  // A wrong icon is cosmetic, as it is on an entry: named, and the kind's own used.
  const rawIcon = field('icon');
  let icon: IconName | null = null;
  if (isIconName(rawIcon)) icon = rawIcon;
  else if (rawIcon !== undefined) {
    notes.push(`icon ${JSON.stringify(rawIcon)} is not an icon this build has (it has: ${ICON_NAMES.join(', ')}); the list icon is used.`);
  }

  const rawRun = field('run');
  let run: string | null = null;
  if (rawRun === undefined) problems.push('run is missing: the script this type runs, relative to its folder.');
  else if (typeof rawRun !== 'string') problems.push('run is not a string.');
  else if (rawRun.trim() === '') problems.push('run is empty.');
  // Inside the folder, so a type is whole when its folder is copied and nobody's script is reached through somebody else's type.
  else if (isFixedPath(rawRun) || escapes(rawRun)) problems.push(`run ${rawRun} is not inside the type’s folder; give a path relative to it.`);
  else run = rawRun;

  const interval = field('interval') ?? null;
  const intervalProblem = interval === null ? null : valueProblem(INTERVAL_OPTION, interval);
  if (intervalProblem) problems.push(intervalProblem);

  const declared = checkOptionList(field('options'), kind);
  problems.push(...declared.problems);
  notes.push(...declared.notes);

  for (const other of unknownFields(json, MANIFEST_FIELDS)) notes.push(`${other} is not a field this build reads; it is ignored.`);

  const named = (lines: string[]): string[] => lines.map((line) => `${at}: ${line}`);
  return {
    ...folder,
    // A kind and a script are also what an empty problem list promises; asked again so the types say so too.
    manifest: problems.length === 0 && kind !== null && run !== null ? { kind, title, icon, run, interval: interval as string | null, options: declared.options } : null,
    problems: named(problems),
    notes: named(notes),
  };
}

/** What a type was built from, so a manifest edited while the app runs mounts that type's panels afresh. */
function revisionOf(report: TypeReport): string {
  return JSON.stringify([report.status, report.error, report.json]);
}

/** A checked folder as a type the layout can place: its kind's options and its own, and panels mounted by its kind. */
function folderType(folder: FolderType, revision: string): PanelType {
  const { manifest } = folder;
  const type: PanelType = {
    name: folder.name,
    icon: manifest?.icon ?? 'list',
    // Null lets the layout fall back to the entry's id.
    defaultTitle: () => manifest?.title ?? null,
    options: manifest ? [...KIND_OPTIONS[manifest.kind], ...manifest.options] : [],
    exactlyOne: [],
    revision,
    mount: (slot, host) => mountList(slot, host, type, folder),
  };
  return type;
}

/**
 * Every type there is for one read of the config folder: the built-ins, and each type folder as a type of the same name.
 * A folder that cannot be a type at all is not read, and said so in `notes`, which go under the whole layout since no single entry is where it went wrong.
 */
export function folderTypes(reports: TypeReport[], builtins: Record<string, PanelType>): { types: Record<string, PanelType>; notes: string[] } {
  const types: Record<string, PanelType> = { ...builtins };
  const notes: string[] = [];
  for (const report of reports) {
    if (!ID_PATTERN.test(report.name)) {
      notes.push(`types/${report.name} is not read: a type is named after its folder, and the name has to be ${SLUG_RULE}.`);
    } else if (Object.hasOwn(builtins, report.name)) {
      notes.push(`types/${report.name} is not read: ${report.name} is a type the app has built in.`);
    } else types[report.name] = folderType(checkManifest(report), revisionOf(report));
  }
  return { types, notes };
}
