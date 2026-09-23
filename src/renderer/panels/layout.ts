import { LAYOUT_VERSION, type Layout, type LayoutNode, type LayoutReport, type PanelEntry } from '../../shared/panels';
import { ICON_NAMES, isIconName, type IconName } from './icons';
import type { PanelTypeDecl } from './types/command';

/**
 * From one read of the layout file to the window's tree. Pure: no DOM, no paths, no processes, tested per rule.
 *
 * EVERY MISTAKE IS NAMED, in the place of the thing that is wrong, and nothing is guessed or dropped: the file was written by a person, and a layout that quietly shows less than they wrote would send them looking for a bug in the wrong place.
 * A node whose own fields are wrong becomes a DEGRADED group in its place, listing every problem; an entry's problems show in the entry's slot; a problem with the file as a whole shows as one degraded group beside the default layout, so the window stays usable while the file is fixed.
 * And one rule is stronger than the file: the app's own surfaces (`singleton` types) are placed exactly once whatever it says, so nothing a person writes produces a window without the terminal.
 */

/** A slug: lowercase letters, digits, hyphens and underscores, not starting with a hyphen or underscore. What panel state keys on. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** A node's minimum along its parent's axis, in px, when the file gives none. */
export const DEFAULT_MIN = 120;

/**
 * The window when there is no layout file, or an unparsable one and no last good layout: the two built-ins in the arrangement the app has always had, the sidebar a fixed 320px beside a terminal that takes the rest.
 * Resolved through the same function as any file, and shown in the README as the starting point to copy; nothing is written to disk.
 */
export const DEFAULT_LAYOUT: Layout = {
  version: LAYOUT_VERSION,
  root: {
    id: 'window',
    columns: [
      { id: 'sidebar', size: '320px', min: 220, panels: [{ id: 'sessions', type: 'sessions' }] },
      { id: 'claude', panels: [{ id: 'cli', type: 'claude' }] },
    ],
  },
};

/** A node's size as the file gives it: a share of the parent's axis, or pixels that hold when the window resizes. */
export type NodeSize = { share: number } | { px: number };

/** One entry after validation: what to draw in its place. */
export interface PanelSlot {
  /** What state, the DOM and the mounted-panel cache key on: the id when it is usable, else the entry's position (never a slug, so never someone's id). */
  key: string;
  type: string | null;
  title: string;
  /** Everything wrong with the entry, one sentence each. Empty means it runs. */
  problems: string[];
  /** Sentences about the entry that do not stop it running: an icon this build does not have, say. Shown in its group's note line. */
  notes: string[];
  /** The entry as written, for the type to read its parameters from. Null when the entry was not an object at all. */
  entry: PanelEntry | null;
  hidden: boolean;
  /** Its icon on a rail: the entry's own, else its type's, and `alert` for an entry that cannot run. */
  icon: IconName;
}

interface NodeCommon {
  /**
   * The node's id when it is usable. Otherwise its position (`#0.2`), and for a node the resolver added itself an `@` name: neither can be a slug, so neither can collide with one.
   */
  id: string;
  /** The size as the file gives it, or null for none. `fileWeights` turns a split's shares into flex weights; pixels are the renderer's to hold. */
  size: NodeSize | null;
  min: number;
  resizable: boolean;
  /** Sentences about the node that do not stop it showing: something not honoured yet, something the resolver did in the file's place. */
  notes: string[];
}

export interface ResolvedSplit extends NodeCommon {
  kind: 'split';
  axis: 'rows' | 'columns';
  children: ResolvedNode[];
}

export interface ResolvedGroup extends NodeCommon {
  kind: 'group';
  /** The node's id as written, or where it sits when it has none usable: what a degraded group's header says. */
  title: string;
  slots: PanelSlot[];
  /** The key of the slot shown until the user picks one: the file's `active`, else the first slot not hidden; null when every slot is hidden. */
  active: string | null;
  collapsible: boolean;
  /** One slot on show and its type carries its own chrome, so the group draws no header. */
  bare: boolean;
  /** What is wrong with the node itself. Non-empty means the group is DEGRADED: it shows these, and has no slots. */
  problems: string[];
}

export type ResolvedNode = ResolvedSplit | ResolvedGroup;

export type LayoutView =
  | { kind: 'tree'; root: ResolvedNode }
  /** The file could not be read as JSON: keep the last good layout up and name the file and the parser's position. */
  | { kind: 'unparsable'; file: string; message: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPositive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

const PX = /^(\d+(?:\.\d+)?)px$/;

/** A positive number is a share, `"<n>px"` is pixels; anything else is not a size. */
export function parseSize(value: unknown): NodeSize | null {
  if (isPositive(value)) return { share: value };
  const match = typeof value === 'string' ? PX.exec(value) : null;
  const px = match ? Number(match[1]) : 0;
  return px > 0 ? { px } : null;
}

export const shareOf = (node: { size: NodeSize | null }): number | null => (node.size && 'share' in node.size ? node.size.share : null);
export const pxOf = (node: { size: NodeSize | null }): number | null => (node.size && 'px' in node.size ? node.size.px : null);

const SLUG_RULE = 'lowercase letters, digits, hyphens and underscores, starting with a letter or digit';

/** The same sentence for a node's id and an entry's, since they share one namespace. Adds a usable id to `seen`; returns the problem or null. */
function checkId(raw: Record<string, unknown>, seen: Set<string>): string | null {
  if (raw.id === undefined) return 'id is missing.';
  if (typeof raw.id !== 'string') return 'id is not a string.';
  if (!ID_PATTERN.test(raw.id)) return `id "${raw.id}" is not a slug (${SLUG_RULE}).`;
  if (seen.has(raw.id)) return `id "${raw.id}" is already used earlier in the file.`;
  seen.add(raw.id);
  return null;
}

/** "a and b are both given", "a, b and c are all given". */
function doubled(given: string[]): string {
  const list = given.length === 2 ? given.join(' and ') : `${given.slice(0, -1).join(', ')} and ${given.at(-1)}`;
  return `${list} are ${given.length === 2 ? 'both' : 'all'} given; give one.`;
}

/**
 * Validate one entry against its type's declaration. Every problem is collected, not only the first, so one read of the panel says all there is to fix.
 * `seen` holds every id met so far in the file, nodes included, for the uniqueness rule; `fallbackKey` is what the slot is keyed by when its id is not usable.
 */
export function validateEntry(
  raw: unknown,
  index: number,
  types: Record<string, PanelTypeDecl>,
  report: LayoutReport,
  seen: Set<string>,
  fallbackKey = `#${index}`,
): PanelSlot {
  const problems: string[] = [];
  const notes: string[] = [];
  if (!isObject(raw)) {
    return { key: fallbackKey, type: null, title: `Entry ${index + 1}`, problems: ['The entry is not an object.'], notes, entry: null, hidden: false, icon: 'alert' };
  }
  // Handed on as the entry it claims to be; the checks below are what make that claim good before anything reads it as one.
  const entry = raw as unknown as PanelEntry;
  const idProblem = checkId(raw, seen);
  if (idProblem) problems.push(idProblem);
  const key = idProblem ? fallbackKey : (raw.id as string);

  let type: PanelTypeDecl | null = null;
  if (raw.type === undefined) problems.push('type is missing.');
  else if (typeof raw.type !== 'string') problems.push('type is not a string.');
  else if (!(raw.type in types)) {
    problems.push(`type "${raw.type}" is not a type this build knows (it knows: ${Object.keys(types).join(', ')}).`);
  } else type = types[raw.type];

  if (raw.title !== undefined && typeof raw.title !== 'string') problems.push('title is not a string.');
  if (raw.hidden !== undefined && typeof raw.hidden !== 'boolean') problems.push('hidden is not true or false.');

  if (type) {
    for (const group of type.exactlyOne) {
      const given = group.filter((name) => raw[name] !== undefined);
      if (given.length === 0) problems.push(`One of ${group.join(' or ')} is required.`);
      else if (given.length > 1) problems.push(doubled(given));
    }
    for (const param of type.params) {
      const value = raw[param.name];
      if (value === undefined) continue;
      if (typeof value !== 'string') problems.push(`${param.name} is not a string.`);
      else if (value.trim() === '') problems.push(`${param.name} is empty.`);
      else if (param.kind === 'path') {
        // Main checked the file when it read the layout; the check is keyed by the value as written.
        const check = report.scripts[value];
        if (!check) problems.push(`${param.name} ${value} was not checked.`);
        else if (check.problem) problems.push(`${check.problem}.`);
      }
    }
  }

  // A wrong icon is cosmetic, so it is named and the type's own is used, rather than the panel refused.
  let icon: IconName = type?.icon ?? 'alert';
  if (raw.icon !== undefined && !isIconName(raw.icon)) {
    const fallback = type ? `; the ${type.icon} icon is used` : '';
    notes.push(
      typeof raw.icon === 'string'
        ? `icon "${raw.icon}" on ${key} is not an icon this build has (it has: ${ICON_NAMES.join(', ')})${fallback}.`
        : `icon on ${key} is not a string${fallback}.`,
    );
  } else if (raw.icon !== undefined) icon = raw.icon as IconName;
  if (problems.length > 0) icon = 'alert';

  const title =
    typeof raw.title === 'string' && raw.title.trim() !== ''
      ? raw.title
      : type && problems.length === 0
        ? type.defaultTitle(entry)
        : typeof raw.id === 'string'
          ? raw.id
          : `Entry ${index + 1}`;
  return { key, type: type?.name ?? null, title, problems, notes, entry, hidden: raw.hidden === true, icon };
}

/**
 * A split's flexible children's shares as flex weights, from the file alone — the children sized in pixels are left out, since shares divide what they leave.
 * A child with a share keeps it; the children without one share what the shares leave of 1, equally — so `0.22` beside an unsized sibling is 22% and 78%, and shares on every child are plain proportions.
 * When the sized ones leave nothing, each unsized child is weighted as their average instead, so it still gets a usable share — a built-in the resolver adds lands here — and `exhausted` says so, for the split's note.
 */
export function fileWeights(sizes: (number | null)[]): { weights: number[]; exhausted: boolean } {
  const given = sizes.filter((size): size is number => size !== null);
  const unsized = sizes.length - given.length;
  const total = given.reduce((sum, size) => sum + size, 0);
  const exhausted = unsized > 0 && given.length > 0 && total >= 1;
  const share = unsized === 0 ? 0 : exhausted ? total / given.length : (1 - total) / unsized;
  return { weights: sizes.map((size) => size ?? share), exhausted };
}

/** Whether a node takes no room: a group with every slot hidden, or a split of nothing but such groups. A degraded group always shows. */
export function isEmpty(node: ResolvedNode): boolean {
  if (node.kind === 'group') return node.problems.length === 0 && node.slots.every((slot) => slot.hidden);
  return node.children.every(isEmpty);
}

export function fileName(path: string): string {
  return path.split('/').at(-1) ?? path;
}

const NODE_FIELDS = new Set(['id', 'size', 'min', 'resizable', 'collapsible', 'active', 'rows', 'columns', 'panels']);
const SHAPES = ['rows', 'columns', 'panels'] as const;
const LAYOUT_FIELDS = new Set(['version', 'root']);

/** One walk of the file: the ids met so far, and where each singleton type landed. */
class Resolver {
  private readonly seen = new Set<string>();
  /** Singleton type → the key of the slot that placed it. */
  readonly placed = new Map<string, string>();

  constructor(
    private readonly types: Record<string, PanelTypeDecl>,
    private readonly report: LayoutReport,
  ) {}

  /** `key` is the node's position, used when its id is not; `title` is what to call it when it has no id to go by. */
  node(raw: unknown, key: string, title: string): ResolvedNode {
    if (!isObject(raw)) return degraded(key, title, ['The node is not an object.'], {});
    const problems: string[] = [];
    const notes: string[] = [];
    const idProblem = checkId(raw, this.seen);
    if (idProblem) problems.push(idProblem);
    const id = idProblem ? key : (raw.id as string);
    const named = typeof raw.id === 'string' && raw.id !== '' ? raw.id : title;

    for (const field of Object.keys(raw)) if (!NODE_FIELDS.has(field)) problems.push(`${field} is not a field a node has.`);
    // The likeliest way to get here: a panel entry written where a node goes, without the group around it.
    if (raw.type !== undefined) problems.push('This looks like a panel entry; entries go in a group’s panels.');

    const given = SHAPES.filter((shape) => raw[shape] !== undefined);
    const shape = given.length === 1 ? given[0] : null;
    if (given.length === 0) problems.push('One of rows, columns or panels is required.');
    else if (given.length > 1) problems.push(doubled(given));
    const list = shape ? raw[shape] : undefined;
    if (shape && !Array.isArray(list)) problems.push(`${shape} is not an array.`);
    else if (Array.isArray(list) && list.length === 0) problems.push(`${shape} is empty.`);

    const size = parseSize(raw.size);
    const min = isPositive(raw.min) ? raw.min : DEFAULT_MIN;
    if (raw.size !== undefined && !size) problems.push('size is not a positive number or a pixel size like "320px".');
    if (raw.min !== undefined && !isPositive(raw.min)) problems.push('min is not a positive number of pixels.');
    if (size && 'px' in size && size.px < min) notes.push(`size ${size.px}px is below min ${min}, so the node starts at ${min}px.`);
    for (const flag of ['resizable', 'collapsible'] as const) {
      if (raw[flag] !== undefined && typeof raw[flag] !== 'boolean') problems.push(`${flag} is not true or false.`);
    }
    if (raw.active !== undefined) {
      if (shape !== null && shape !== 'panels') problems.push(`active is for a group of panels; this node has ${shape}.`);
      else if (typeof raw.active !== 'string') problems.push('active is not a string.');
      else if (Array.isArray(list)) {
        // Checked against the entries as written, before they are walked, so a group degraded by it never registers what it holds.
        const target = list.find((entry) => isObject(entry) && entry.id === raw.active);
        if (!target) problems.push(`active "${raw.active}" is not one of this group’s panels.`);
        else if ((target as Record<string, unknown>).hidden === true) problems.push(`active "${raw.active}" is hidden.`);
      }
    }
    if (shape !== 'panels' && raw.collapsible !== undefined) notes.push('collapsible is not honoured on rows or columns yet; only a group folds.');

    if (problems.length > 0 || !shape || !Array.isArray(list)) return degraded(id, named, problems, raw);

    const common = { id, size, min, resizable: raw.resizable !== false, notes };
    if (shape === 'panels') return this.group(common, named, list, typeof raw.active === 'string' ? raw.active : null, raw.collapsible === true);

    const word = shape === 'rows' ? 'row' : 'column';
    const children = list.map((child, index) => this.node(child, `${key}.${index}`, `${word} ${index + 1} of ${named}`));
    return { kind: 'split', axis: shape, children, ...common };
  }

  private group(common: NodeCommon, title: string, entries: unknown[], active: string | null, collapsible: boolean): ResolvedGroup {
    const slots = entries.map((raw, index) => validateEntry(raw, index, this.types, this.report, this.seen, `${common.id}/${index}`));
    for (const slot of slots) {
      const type = slot.type ? this.types[slot.type] : null;
      if (!type?.singleton || slot.problems.length > 0) continue;
      const first = this.placed.get(type.name);
      if (first !== undefined) {
        slot.problems.push(`type ${type.name} is already placed as "${first}".`);
        slot.icon = 'alert';
        continue;
      }
      this.placed.set(type.name, slot.key);
      if (slot.hidden) {
        slot.hidden = false;
        common.notes.push(`hidden is ignored on ${slot.key}: the ${type.name} panel cannot be hidden.`);
      }
    }
    const shown = slots.filter((slot) => !slot.hidden);
    const only = shown.length === 1 ? shown[0] : null;
    return {
      kind: 'group',
      ...common,
      title,
      slots,
      active: active ?? shown[0]?.key ?? null,
      collapsible,
      bare: only !== null && only.problems.length === 0 && this.types[only.type!]?.bare === true,
      problems: [],
    };
  }
}

/** A node that cannot be drawn as written, drawn as a group saying why. Its size, min and resizable are honoured where they are readable, so it sits where the node would have. */
function degraded(id: string, title: string, problems: string[], raw: Record<string, unknown>): ResolvedGroup {
  return {
    kind: 'group',
    id,
    title,
    size: parseSize(raw.size),
    min: isPositive(raw.min) ? raw.min : DEFAULT_MIN,
    resizable: raw.resizable !== false,
    notes: [],
    slots: [],
    active: null,
    collapsible: false,
    bare: false,
    problems,
  };
}

/**
 * Say so under every split whose shares leave nothing for its unsized children. Pixel children stand apart: shares divide what they leave.
 * A pass over the finished tree rather than a check as each split is built, because placing a built-in the file left out adds a child after the fact.
 */
function noteExhausted(node: ResolvedNode): void {
  if (node.kind !== 'split') return;
  node.children.forEach(noteExhausted);
  const flexible = node.children.filter((child) => pxOf(child) === null);
  const shares = flexible.map(shareOf);
  if (!fileWeights(shares).exhausted) return;
  const total = Math.round(shares.reduce<number>((sum, share) => sum + (share ?? 0), 0) * 100) / 100;
  const unsized = flexible.filter((child) => child.size === null).map((child) => child.id);
  node.notes.push(
    `The sizes in ${node.id} add up to ${total}, which leaves nothing for ${unsized.join(', ')}; ${unsized.length === 1 ? 'it is' : 'each is'} sized as their average.`,
  );
}

/** The group the default layout keeps a singleton type in, and whether it sits at the start of the root or the end. */
function defaultHome(type: string): { node: Extract<LayoutNode, { panels: PanelEntry[] }>; entry: PanelEntry; atStart: boolean } | null {
  const root = DEFAULT_LAYOUT.root;
  if (!('columns' in root)) return null;
  for (const [index, node] of root.columns.entries()) {
    if (!('panels' in node)) continue;
    const entry = node.panels.find((candidate) => candidate.type === type);
    if (entry) return { node, entry, atStart: index === 0 };
  }
  return null;
}

/**
 * Place a singleton the file did not: as a first or last column of the root, where the default layout keeps it, wrapping a root that is not already columns.
 * The group is the default layout's, under `@` names so it cannot collide with an id in the file, with a note saying why it is there.
 */
function addSingleton(root: ResolvedNode, type: PanelTypeDecl): ResolvedNode {
  const home = defaultHome(type.name);
  const entry = home?.entry ?? { id: type.name, type: type.name };
  const group: ResolvedGroup = {
    kind: 'group',
    id: `@${home?.node.id ?? type.name}`,
    title: type.defaultTitle(entry),
    size: parseSize(home?.node.size),
    min: home?.node.min ?? DEFAULT_MIN,
    resizable: home?.node.resizable !== false,
    notes: [`The layout does not place the ${type.name} panel, so it is added here.`],
    slots: [{ key: `@${entry.id}`, type: type.name, title: type.defaultTitle(entry), problems: [], notes: [], entry, hidden: false, icon: type.icon }],
    active: `@${entry.id}`,
    collapsible: home?.node.collapsible === true,
    bare: type.bare === true,
    problems: [],
  };
  const atStart = home?.atStart ?? false;
  const split: ResolvedSplit =
    root.kind === 'split' && root.axis === 'columns'
      ? root
      : { kind: 'split', id: '@window', axis: 'columns', children: [root], size: null, min: DEFAULT_MIN, resizable: true, notes: [] };
  if (atStart) split.children.unshift(group);
  else split.children.push(group);
  return split;
}

/**
 * Walk `json` as a layout file's root node, place any singleton it left out, and note what the sizes could not say.
 * `problems`, when given, is a file that could not be read as a layout at all: `json` is then the default layout, and one degraded group saying why sits beside it where a right-hand side would, so the window stays usable while the file is fixed.
 */
function resolveRoot(json: unknown, types: Record<string, PanelTypeDecl>, report: LayoutReport, notes: string[], problems: string[] = []): LayoutView {
  const resolver = new Resolver(types, report);
  let root = resolver.node(json, '#root', 'root');
  root.notes.push(...notes);
  for (const type of Object.values(types)) {
    if (type.singleton && !resolver.placed.has(type.name)) root = addSingleton(root, type);
  }
  if (problems.length > 0 && root.kind === 'split') root.children.push({ ...degraded('@layout', fileName(report.file), problems, {}), size: { share: 0.25 } });
  noteExhausted(root);
  return { kind: 'tree', root };
}

/** What the window shows for one read of the file. */
export function resolveLayout(report: LayoutReport, types: Record<string, PanelTypeDecl>): LayoutView {
  if (report.status === 'unparsable') return { kind: 'unparsable', file: report.file, message: report.error ?? 'could not be read' };
  const fallback = (problem: string) => resolveRoot(DEFAULT_LAYOUT.root, types, report, [], [problem]);
  if (report.status === 'missing') return resolveRoot(DEFAULT_LAYOUT.root, types, report, []);
  const json = report.json;
  if (!isObject(json)) return fallback('The file is not a JSON object.');
  if (json.version === undefined) return fallback(`version is missing (this build reads ${LAYOUT_VERSION}).`);
  if (json.version !== LAYOUT_VERSION) return fallback(`version ${JSON.stringify(json.version)} is not one this build reads (it reads ${LAYOUT_VERSION}).`);
  if (json.root === undefined) return fallback('root is missing.');
  const stray = Object.keys(json)
    .filter((field) => !LAYOUT_FIELDS.has(field))
    .map((field) => `${field} is not a field the layout file has.`);
  return resolveRoot(json.root, types, report, stray);
}
