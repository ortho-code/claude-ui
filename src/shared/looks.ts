/**
 * THE STRENGTH ORDER AND THE LOOKS: which state a session's dot shows when several hold, one list of the statuses and the needs-you categories, the first that holds winning; and how each status, category and type is drawn (docs/architecture.md § Status cues).
 * Pure and shared: main checks `settings.json`'s `strength` and `looks` by it, and the window ranks and draws by it.
 */

import { isIconName, type IconName } from './icons';
import type { NeedsYouRegistry } from './needsyou';

/** The statuses a hook reports, each an entry of the order. */
export const STATUSES = ['waiting', 'busy', 'background', 'idle', 'closed'] as const;
export type Status = (typeof STATUSES)[number];

/** The entry standing for every needs-you category the order does not name, in Now's order (their `order`). */
export const NEEDS_YOU = 'needs-you';

/** The category whose two types, claude asking and claude finishing a turn, are the statuses `waiting` and `idle` themselves, never stored reasons, so it has no place of its own in the order. */
export const YOUR_TURN = 'your-turn';

/** The status each of Your turn's types is, and so the look it is drawn in. */
export const YOUR_TURN_STATUS: Readonly<Record<string, Status>> = { 'claude.asks': 'waiting', 'claude.finished': 'idle' };

/** The order before anyone has chosen otherwise: claude's own status over a needs-you mark while it waits or works, the mark over a finished turn, as the dot has shown them since the mark came (decided 2026-11-06). */
export const DEFAULT_STRENGTH: readonly string[] = ['waiting', 'busy', 'background', NEEDS_YOU, 'idle', 'closed'];

const isStatus = (value: string): value is Status => (STATUSES as readonly string[]).includes(value);

/**
 * Why `value` cannot be the strength order, null when it can: a list of text, each status and `needs-you` once, any other entry a category, none twice, Your turn not one of them.
 * With a registry, a category it does not have is a mistake too; without one, as for a check of a save, any other text passes.
 */
export function strengthProblem(value: unknown, registry: NeedsYouRegistry | null): string | null {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) return 'It has to be a list of names, such as ["waiting", "busy", "background", "needs-you", "idle", "closed"].';
  const entries = value as string[];
  const twice = [...new Set(entries.filter((entry, at) => entries.indexOf(entry) !== at))];
  if (twice.length > 0) return `${quoted(twice)} ${twice.length === 1 ? 'is' : 'are'} named more than once.`;
  const missing = [...STATUSES, NEEDS_YOU].filter((needed) => !entries.includes(needed));
  if (missing.length > 0) return `It has to name ${quoted(missing)} too: every status and "${NEEDS_YOU}" once.`;
  if (entries.includes(YOUR_TURN)) return `"${YOUR_TURN}" has no place of its own: its types are "waiting" and "idle".`;
  if (registry !== null) {
    const known = new Set(registry.categories.map((category) => category.id));
    const unknown = entries.filter((entry) => !isStatus(entry) && entry !== NEEDS_YOU && !known.has(entry));
    if (unknown.length > 0) return `${quoted(unknown)} ${unknown.length === 1 ? 'is' : 'are'} neither a status, "${NEEDS_YOU}" nor a needs-you category.`;
  }
  return null;
}

const quoted = (names: readonly string[]): string => names.map((name) => `"${name}"`).join(', ');

/**
 * The order as it ranks: `needs-you` gives way to the categories the list does not name, in their order, Your turn left out, and stays after them, where a reason of a category not known yet ranks, such as before main has answered.
 * With the default list and the app's categories: waiting, busy, background, back-to-work, ready-to-merge, look-again, reminders, finish-up, needs-you, idle, closed.
 */
export function expandedStrength(list: readonly string[], registry: NeedsYouRegistry): string[] {
  const named = new Set(list);
  const unnamed = registry.categories.map((category) => category.id).filter((id) => id !== YOUR_TURN && !named.has(id));
  return list.flatMap((entry) => (entry === NEEDS_YOU ? [...unnamed, NEEDS_YOU] : [entry]));
}

/** The colours a look can name: Catppuccin Mocha's accents, the theme the app is drawn in, and its `muted` text (overlay 2). */
export const PALETTE = {
  rosewater: '#f5e0dc',
  flamingo: '#f2cdcd',
  pink: '#f5c2e7',
  mauve: '#cba6f7',
  red: '#f38ba8',
  maroon: '#eba0ac',
  peach: '#fab387',
  yellow: '#f9e2af',
  green: '#a6e3a1',
  teal: '#94e2d5',
  sky: '#89dceb',
  sapphire: '#74c7ec',
  blue: '#89b4fa',
  lavender: '#b4befe',
  muted: '#9399b2',
} as const;

/** The shapes a look's `mark` can be besides an icon: a filled dot, a hollow ring, and busy's arc spinning over a faint track of its colour. */
export const SHAPES = ['dot', 'ring', 'spinner'] as const;
export type Mark = (typeof SHAPES)[number] | IconName;

/** How one status, `needs-you`, category or type is drawn, as `settings.json`'s `looks` gives it: each field it changes, the rest from what it looks like or what it belongs to (`resolvedLooks`). */
export interface Look {
  /** A colour of `PALETTE` by name, or `#rrggbb`. */
  colour?: string;
  mark?: Mark;
  /** A colour drawn inside a `spinner`, as background's green is; nothing with any other mark. */
  core?: string;
  /** The 1.2 s pulse; a spinner spins whatever it says. */
  pulse?: boolean;
  /** The id whose look this one takes for every field it leaves out; it never moves this one's place in the order. */
  looksLike?: string;
}

/** A look with every field settled, its colours as `#rrggbb`. */
export interface ResolvedLook {
  colour: string;
  mark: Mark;
  core: string | null;
  pulse: boolean;
}

/**
 * The looks before anyone has set one: what every category and type takes unless something says otherwise is `needs-you`'s.
 * Needs you is mauve, far enough from waiting's yellow to tell apart at a dot's size, which peach was not (decided 2026-10-28, from a mock of six).
 */
export const DEFAULT_LOOKS: Readonly<Record<Status | typeof NEEDS_YOU, ResolvedLook>> = {
  waiting: { colour: PALETTE.yellow, mark: 'dot', core: null, pulse: true },
  busy: { colour: PALETTE.blue, mark: 'spinner', core: null, pulse: false },
  background: { colour: PALETTE.blue, mark: 'spinner', core: PALETTE.green, pulse: false },
  idle: { colour: PALETTE.green, mark: 'dot', core: null, pulse: false },
  closed: { colour: PALETTE.muted, mark: 'ring', core: null, pulse: false },
  [NEEDS_YOU]: { colour: PALETTE.mauve, mark: 'dot', core: null, pulse: true },
};

const LOOK_FIELDS: readonly string[] = ['colour', 'mark', 'core', 'pulse', 'looksLike'] satisfies (keyof Look)[];

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const isColour = (value: unknown): value is string => typeof value === 'string' && (Object.hasOwn(PALETTE, value) || /^#[0-9a-fA-F]{6}$/.test(value));

/** A colour a look names, as `#rrggbb`. */
const hexOf = (colour: string): string => (Object.hasOwn(PALETTE, colour) ? PALETTE[colour as keyof typeof PALETTE] : colour.toLowerCase());

/** Your turn's types: the statuses `waiting` and `idle` themselves, drawn in those statuses' looks, so none has a look of its own. */
const yourTurnTypes = (registry: NeedsYouRegistry): Set<string> => new Set(registry.types.filter((type) => type.category === YOUR_TURN).map((type) => type.id));

/** Every id a look can be set for: the statuses, `needs-you`, and the categories and types but Your turn's. */
export function lookIds(registry: NeedsYouRegistry): string[] {
  const yours = yourTurnTypes(registry);
  return [...STATUSES, NEEDS_YOU, ...registry.categories.map((category) => category.id).filter((id) => id !== YOUR_TURN), ...registry.types.map((type) => type.id).filter((id) => !yours.has(id))];
}

/**
 * Why `value` cannot be the looks, null when it can: an object by id, each entry an object of `Look`'s fields with values it allows, `looksLike` naming another id and no circle of them, and nothing for Your turn.
 * With a registry, an id it does not have is a mistake too, here or in `looksLike`; without one, as for a check of a save, any other id passes.
 */
export function looksProblem(value: unknown, registry: NeedsYouRegistry | null): string | null {
  if (!isObject(value)) return 'It has to be an object of looks by id, such as { "finish-up": { "colour": "green" } }.';
  const known = registry === null ? null : new Set(lookIds(registry));
  const yours = registry === null ? new Set<string>() : yourTurnTypes(registry);
  const unknownId = (id: string): string | null => {
    if (id === YOUR_TURN || yours.has(id)) return `has no look of its own: Your turn's types are drawn as "waiting" and "idle".`;
    if (known !== null && !known.has(id)) return `is neither a status, "${NEEDS_YOU}", a category nor a type.`;
    return null;
  };
  const problems: string[] = [];
  for (const [id, look] of Object.entries(value)) {
    const unknown = unknownId(id);
    const why = unknown === null ? entryProblem(id, look, unknownId) : `"${id}" ${unknown}`;
    if (why !== null) problems.push(why);
  }
  if (problems.length === 0) {
    const circle = circleOf(value as Record<string, Look>);
    if (circle !== null) problems.push(`${quoted(circle)} look like each other in a circle.`);
  }
  return problems.length === 0 ? null : problems.join(' ');
}

/** What is wrong with the look set for `id`, null when nothing is; `unknownId` says what is wrong with an id it names, as the rest of a sentence. */
function entryProblem(id: string, look: unknown, unknownId: (id: string) => string | null): string | null {
  if (!isObject(look)) return `"${id}" has to be an object of fields, such as { "colour": "green" }.`;
  const unknown = Object.keys(look).filter((field) => !LOOK_FIELDS.includes(field));
  if (unknown.length > 0) return `"${id}" has ${quoted(unknown)}, which a look does not have: it has ${quoted(LOOK_FIELDS)}.`;
  const { colour, mark, core, pulse, looksLike } = look;
  if (colour !== undefined && !isColour(colour)) return `"${id}": "colour" has to be one of ${quoted(Object.keys(PALETTE))}, or "#rrggbb".`;
  if (mark !== undefined && !((SHAPES as readonly unknown[]).includes(mark) || isIconName(mark))) return `"${id}": "mark" has to be ${quoted(SHAPES)} or an icon's name.`;
  if (core !== undefined && !isColour(core)) return `"${id}": "core" has to be a colour, as "colour" is.`;
  if (pulse !== undefined && typeof pulse !== 'boolean') return `"${id}": "pulse" has to be true or false.`;
  if (looksLike !== undefined) {
    if (typeof looksLike !== 'string') return `"${id}": "looksLike" has to be the id of a status, "${NEEDS_YOU}", a category or a type.`;
    if (looksLike === id) return `"${id}" cannot look like itself.`;
    const why = unknownId(looksLike);
    if (why !== null) return `"${id}" looks like "${looksLike}", which ${why}`;
  }
  return null;
}

/** The ids of the first circle `looksLike` makes among `looks`, in the order it goes round, or null for none. */
function circleOf(looks: Readonly<Record<string, Look>>): string[] | null {
  for (const start of Object.keys(looks)) {
    const path: string[] = [];
    let at: string | undefined = start;
    while (at !== undefined && !path.includes(at)) {
      path.push(at);
      at = looks[at]?.looksLike;
    }
    if (at !== undefined) return path.slice(path.indexOf(at));
  }
  return null;
}

/**
 * Every id's look as it is drawn (`lookIds`), field by field: the look set for it, and every field it leaves out from the one it looks like, as that one resolves, or where it looks like none, from its category's for a type, `needs-you`'s for a category, or its default for a status and `needs-you`.
 * `looks` is one `looksProblem` passes; an id it names that the registry does not have gets no look of its own, and one named in `looksLike` resolves as a category would, from `needs-you`'s.
 */
export function resolvedLooks(looks: Readonly<Record<string, Look>>, registry: NeedsYouRegistry): Map<string, ResolvedLook> {
  const categories = new Set(registry.categories.map((category) => category.id));
  const parentOf = (id: string): string | null => registry.types.find((type) => type.id === id)?.category ?? (categories.has(id) ? NEEDS_YOU : null);
  const resolved = new Map<string, ResolvedLook>();
  const resolve = (id: string, seen: ReadonlySet<string>): ResolvedLook => {
    const done = resolved.get(id);
    if (done) return done;
    const own = looks[id] ?? {};
    const parent = parentOf(id);
    // A circle is a mistake `looksProblem` refuses; were one to come, it ends where it would go round.
    const like = own.looksLike !== undefined && !seen.has(own.looksLike) ? own.looksLike : null;
    const base = like !== null ? resolve(like, new Set([...seen, id])) : parent !== null ? resolve(parent, new Set([...seen, id])) : Object.hasOwn(DEFAULT_LOOKS, id) ? DEFAULT_LOOKS[id as keyof typeof DEFAULT_LOOKS] : resolve(NEEDS_YOU, new Set([...seen, id]));
    const look: ResolvedLook = { colour: own.colour === undefined ? base.colour : hexOf(own.colour), mark: own.mark ?? base.mark, core: own.core === undefined ? base.core : hexOf(own.core), pulse: own.pulse ?? base.pulse };
    resolved.set(id, look);
    return look;
  };
  return new Map(lookIds(registry).map((id) => [id, resolve(id, new Set())]));
}
