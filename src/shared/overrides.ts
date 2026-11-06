/**
 * OVERRIDE BY ID: a file of yours names something the app ships by its id and changes it field by field, or switches it off with `"enabled": false`.
 * One rule for every kind the app ships this way, the needs-you categories and types first, views and a plugin's parts later, so each is changed the same way (decided 2026-11-04, design decision 28).
 * A field the file names replaces the shipped one's; every other field stays the shipped one's, so a later version's change to a field you left alone still reaches you.
 * Pure, so main and the tests apply it by the same rule.
 */

/** Something the app ships that a file of yours can change: its id, and its kind, which says which fields it has. */
export interface Overridable {
  id: string;
  kind: string;
}

/** One file of yours, by its name, for the mistakes to name it. */
export interface OverrideFile {
  name: string;
  json: unknown;
}

/** What is wrong with a field's value, said after the field's name ("is not a number"), or null for a value that can be used. */
export type FieldCheck = (value: unknown) => string | null;

/**
 * The shipped items with each file's changes applied, and what is wrong with the files.
 * A file is used whole or not at all (decided 2026-11-05 for the settings, the same here): one that holds no object, names no id the app ships, changes `kind`, names a field its kind does not have or gives one a value that cannot be used is left out and named; two files naming one id are both left out and named, since which should win is not for the app to guess.
 * `fields` says, per kind, the fields a file may change and how each is checked; `id` and `kind` never change.
 */
export function overriddenById<T extends Overridable>(shipped: readonly T[], files: readonly OverrideFile[], fields: Readonly<Record<string, Readonly<Record<string, FieldCheck>>>>): { items: T[]; problems: string[] } {
  const problems: string[] = [];
  const byId = new Map(shipped.map((item) => [item.id, item]));
  const read: { name: string; id: string; changes: Record<string, unknown> }[] = [];
  for (const { name, json } of files) {
    const problem = problemOf(json, byId, fields);
    if (problem !== null) {
      problems.push(`${name}: ${problem}`);
      continue;
    }
    const fieldsOf = json as Record<string, unknown>;
    read.push({ name, id: fieldsOf.id as string, changes: Object.fromEntries(Object.entries(fieldsOf).filter(([field]) => field !== 'id' && field !== 'kind')) });
  }
  const names = new Map<string, string[]>();
  for (const { name, id } of read) names.set(id, [...(names.get(id) ?? []), name]);
  for (const [id, sharing] of names) if (sharing.length > 1) problems.push(`${sharing.join(', ')}: all change "${id}", so none is used`);
  const changed = new Map(read.filter(({ id }) => names.get(id)!.length === 1).map(({ id, changes }) => [id, changes]));
  return { items: shipped.map((item) => (changed.has(item.id) ? { ...item, ...changed.get(item.id) } : item)), problems };
}

/** What is wrong with one file's object, or null for one that can be used. */
function problemOf(json: unknown, byId: ReadonlyMap<string, Overridable>, fields: Readonly<Record<string, Readonly<Record<string, FieldCheck>>>>): string | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return 'holds no object';
  const { id, kind, ...changes } = json as Record<string, unknown>;
  if (typeof id !== 'string' || id.trim() === '') return '"id" is missing or empty';
  const item = byId.get(id);
  if (item === undefined) return `nothing the app ships has the id "${id}"`;
  if (kind !== undefined && kind !== item.kind) return `"${id}" is a ${item.kind}, so "kind" cannot be ${JSON.stringify(kind)}`;
  const allowed = fields[item.kind] ?? {};
  for (const [field, value] of Object.entries(changes)) {
    const check = allowed[field];
    if (check === undefined) return `a ${item.kind} has no "${field}" to change`;
    const why = check(value);
    if (why !== null) return `"${field}" ${why}`;
  }
  return null;
}
