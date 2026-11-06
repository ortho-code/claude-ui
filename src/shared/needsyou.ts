/**
 * THE NEEDS-YOU CATEGORIES AND TYPES: every reason a session needs you is of a type, and every type belongs to a category, a section of Now.
 * The app's own come as files it ships (`bundled/needs-you/`), one object each, written as a person's own would be, so each can be changed or switched off by its id like anything else the app ships.
 * Pure, so main's reading and the tests check them by the same rules.
 */

import { overriddenById, type FieldCheck } from './overrides';
import type { NeedsYou, PrChange, PrNeedsYouType } from './types';

/**
 * The PR types, each with the words for its change: the order several found in one answer are named in, strongest first, as "PR #7 checks failed, approved" says them.
 * The words are also how `meta.json` kept a PR's change before reasons had types.
 */
export const PR_TYPES: Readonly<Record<PrNeedsYouType, PrChange>> = {
  'pr.checks-failed': 'checks failed',
  'pr.conflict': 'merge conflict',
  'pr.changes-requested': 'changes requested',
  'pr.merged': 'merged',
  'pr.closed': 'closed',
  'pr.reopened': 'reopened',
  'pr.approved': 'approved',
};

/** Whether a type is a PR's change. */
export function isPrType(type: string): type is PrNeedsYouType {
  return Object.hasOwn(PR_TYPES, type);
}

/** Whether a reason is a PR's change, with the PR it names. */
export function isPrReason(reason: NeedsYou): reason is Extract<NeedsYou, { pr: string }> {
  return isPrType(reason.type);
}

/** A category: a section of Now, with its name and its place, lower first. */
export interface NeedsYouCategory {
  id: string;
  label: string;
  order: number;
  enabled: boolean;
}

/** A type: one reason a session can need you, with its name and the category it belongs to. */
export interface NeedsYouType {
  id: string;
  label: string;
  category: string;
  enabled: boolean;
}

/** Every category in order and every type, as checked. */
export interface NeedsYouRegistry {
  categories: NeedsYouCategory[];
  types: NeedsYouType[];
}

/** No categories and no types: what the window has before main has read them. */
export const NO_NEEDS_YOU_TYPES: NeedsYouRegistry = { categories: [], types: [] };

/** The category a type belongs to, by id; null for a type the registry does not have. */
export function categoryOf(registry: NeedsYouRegistry, type: string): string | null {
  return registry.types.find((t) => t.id === type)?.category ?? null;
}

/** One file's object, by the file's name, for the mistakes to name it. */
export interface NeedsYouFile {
  name: string;
  json: unknown;
}

/** The fields each kind may carry; any other is a mistake, so a misspelt field is named rather than ignored. */
const FIELDS: Record<'category' | 'type', readonly string[]> = {
  category: ['kind', 'id', 'label', 'order', 'enabled'],
  type: ['kind', 'id', 'label', 'category', 'enabled'],
};

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** What is wrong with one file's object, or what it reads as. */
function readOne(json: unknown): { problem: string } | { category: NeedsYouCategory } | { type: NeedsYouType } {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return { problem: 'holds no object' };
  const fields = json as Record<string, unknown>;
  const { kind, id, label, enabled } = fields;
  if (kind !== 'category' && kind !== 'type') return { problem: `"kind" is ${JSON.stringify(kind)}, not "category" or "type"` };
  const unknown = Object.keys(fields).filter((key) => !FIELDS[kind].includes(key));
  if (unknown.length > 0) return { problem: `a ${kind} has no ${unknown.map((key) => `"${key}"`).join(', ')}` };
  if (!isText(id)) return { problem: '"id" is missing or empty' };
  if (!isText(label)) return { problem: '"label" is missing or empty' };
  if (enabled !== undefined && typeof enabled !== 'boolean') return { problem: '"enabled" is not true or false' };
  if (kind === 'category') {
    const { order } = fields;
    if (typeof order !== 'number' || !Number.isFinite(order)) return { problem: '"order" is not a number' };
    return { category: { id, label, order, enabled: enabled ?? true } };
  }
  const { category } = fields;
  if (!isText(category)) return { problem: '"category" is missing or empty' };
  return { type: { id, label, category, enabled: enabled ?? true } };
}

/**
 * The categories and types the files hold, checked: a file with a mistake is left out whole and named, as are an id two files share (both left out) and a type naming a category no file holds.
 * Categories come in their order, two at the same place by id; types in the order of their ids.
 */
export function needsYouRegistry(files: readonly NeedsYouFile[]): { registry: NeedsYouRegistry; problems: string[] } {
  const problems: string[] = [];
  const read: { name: string; item: { category: NeedsYouCategory } | { type: NeedsYouType } }[] = [];
  for (const { name, json } of files) {
    const one = readOne(json);
    if ('problem' in one) problems.push(`${name}: ${one.problem}`);
    else read.push({ name, item: one });
  }
  const idOf = (item: { category: NeedsYouCategory } | { type: NeedsYouType }): string => ('category' in item ? item.category.id : item.type.id);
  const byId = new Map<string, string[]>();
  for (const { name, item } of read) byId.set(idOf(item), [...(byId.get(idOf(item)) ?? []), name]);
  for (const [id, names] of byId) if (names.length > 1) problems.push(`${names.join(', ')}: all have the id "${id}", so none is used`);
  const unique = read.filter(({ item }) => byId.get(idOf(item))!.length === 1);
  const categories = unique.flatMap(({ item }) => ('category' in item ? [item.category] : [])).sort((a, b) => a.order - b.order || compare(a.id, b.id));
  const known = new Set(categories.map((category) => category.id));
  const types: NeedsYouType[] = [];
  for (const { name, item } of unique) {
    if (!('type' in item)) continue;
    if (known.has(item.type.category)) types.push(item.type);
    else problems.push(`${name}: no category has the id "${item.type.category}"`);
  }
  types.sort((a, b) => compare(a.id, b.id));
  return { registry: { categories, types }, problems };
}

/** The categories and types as they stand once your files are applied, and what is wrong with your files, each named by file. */
export interface NeedsYouRead {
  registry: NeedsYouRegistry;
  problems: string[];
}

/**
 * The bundled categories and types with your files under `needs-you/` in the config folder applied, by id, field by field (`overriddenById`).
 * A category may change its `label`, `order` and `enabled`; a type its `label`, `category`, naming a category there is, and `enabled`.
 * Categories come in their order again afterwards, so a changed `order` moves one.
 */
export function withOverrides(registry: NeedsYouRegistry, files: readonly NeedsYouFile[]): NeedsYouRead {
  const categoryIds = new Set(registry.categories.map((category) => category.id));
  const label: FieldCheck = (value) => (isText(value) ? null : 'is not text');
  const enabled: FieldCheck = (value) => (typeof value === 'boolean' ? null : 'is not true or false');
  const { items, problems } = overriddenById(
    [...registry.categories.map((category) => ({ ...category, kind: 'category' as const })), ...registry.types.map((type) => ({ ...type, kind: 'type' as const }))],
    files,
    {
      category: { label, enabled, order: (value) => (typeof value === 'number' && Number.isFinite(value) ? null : 'is not a number') },
      type: { label, enabled, category: (value) => (typeof value === 'string' && categoryIds.has(value) ? null : `is ${JSON.stringify(value)}, which no category has as its id`) },
    },
  );
  const categories = items.flatMap((item) => (item.kind === 'category' ? [{ id: item.id, label: item.label, order: item.order, enabled: item.enabled }] : [])).sort((a, b) => a.order - b.order || compare(a.id, b.id));
  const types = items.flatMap((item) => (item.kind === 'type' ? [{ id: item.id, label: item.label, category: item.category, enabled: item.enabled }] : []));
  return { registry: { categories, types }, problems };
}

/**
 * Whether a type marks a session: on itself, and its category on.
 * A type the registry does not have is on, so nothing is switched off on a guess, such as before main has answered.
 */
export function typeIsOn(registry: NeedsYouRegistry, type: string): boolean {
  const found = registry.types.find((t) => t.id === type);
  if (found === undefined) return true;
  return found.enabled && registry.categories.find((category) => category.id === found.category)?.enabled !== false;
}
