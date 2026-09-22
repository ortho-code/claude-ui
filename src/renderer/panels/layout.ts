import { LAYOUT_VERSION, type LayoutReport, type PanelEntry } from '../../shared/panels';
import type { PanelTypeDecl } from './types/command';

/**
 * From one read of the layout file to what the right side shows. Pure: no DOM, no paths, no processes, tested per rule.
 *
 * EVERY MISTAKE IS NAMED, in the place of the thing that is wrong, and nothing is guessed or dropped: the file was written by a person, and a layout that quietly shows less than they wrote would send them looking for a bug in the wrong place.
 * This build honours the first non-hidden entry of the first group on the right side; whatever else the file holds is named as not shown yet rather than ignored.
 */

/** A slug: lowercase letters, digits and hyphens, not starting with a hyphen. What panel state keys on. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** One entry after validation: what to draw in its place. */
export interface PanelSlot {
  /** What state and the DOM key on: the id when it is usable, else the entry's position. */
  key: string;
  type: string | null;
  title: string;
  /** Everything wrong with the entry, one sentence each. Empty means it runs. */
  problems: string[];
  /** The entry as written, for the type to read its parameters from. Null when the entry was not an object at all. */
  entry: PanelEntry | null;
  hidden: boolean;
}

export type LayoutView =
  /** Nothing to show, so the side hides: no file, no right side, or every entry hidden. */
  | { kind: 'empty' }
  /** The file could not be read as JSON: keep the last good layout up and name the file and the parser's position. */
  | { kind: 'unparsable'; file: string; message: string }
  /** The file's own shape is not one this build honours: one degraded panel in the side saying exactly what. */
  | { kind: 'degraded'; problems: string[] }
  /** The entry to show — degraded if it has problems — and a sentence for each thing in the file that is not shown yet. */
  | { kind: 'panel'; slot: PanelSlot; notShown: string[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validate one entry against its type's declaration. Every problem is collected, not only the first, so one read of the panel says all there is to fix.
 * `seen` holds the ids of earlier entries, for the uniqueness rule.
 */
export function validateEntry(
  raw: unknown,
  index: number,
  types: Record<string, PanelTypeDecl>,
  report: LayoutReport,
  seen: Set<string>,
): PanelSlot {
  const problems: string[] = [];
  if (!isObject(raw)) {
    return { key: `#${index}`, type: null, title: `Entry ${index + 1}`, problems: ['The entry is not an object.'], entry: null, hidden: false };
  }
  // Handed on as the entry it claims to be; the checks below are what make that claim good before anything reads it as one.
  const entry = raw as unknown as PanelEntry;
  let key = `#${index}`;
  if (raw.id === undefined) problems.push('id is missing.');
  else if (typeof raw.id !== 'string') problems.push('id is not a string.');
  else if (!ID_PATTERN.test(raw.id)) {
    problems.push(`id "${raw.id}" is not a slug (lowercase letters, digits and hyphens, starting with a letter or digit).`);
  } else if (seen.has(raw.id)) problems.push(`id "${raw.id}" is already used by an earlier entry.`);
  else {
    seen.add(raw.id);
    key = raw.id;
  }

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
      else if (given.length > 1) problems.push(`${given.join(' and ')} are both given; give one.`);
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

  const title =
    typeof raw.title === 'string' && raw.title.trim() !== ''
      ? raw.title
      : type && problems.length === 0
        ? type.defaultTitle(entry)
        : typeof raw.id === 'string'
          ? raw.id
          : `Entry ${index + 1}`;
  return { key, type: type?.name ?? null, title, problems, entry, hidden: raw.hidden === true };
}

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** What the right side shows for one read of the file. */
export function resolveLayout(report: LayoutReport, types: Record<string, PanelTypeDecl>): LayoutView {
  if (report.status === 'missing') return { kind: 'empty' };
  if (report.status === 'unparsable') return { kind: 'unparsable', file: report.file, message: report.error ?? 'could not be read' };
  const json = report.json;
  if (!isObject(json)) return { kind: 'degraded', problems: ['The file is not a JSON object.'] };
  if (json.version === undefined) return { kind: 'degraded', problems: [`version is missing (this build reads ${LAYOUT_VERSION}).`] };
  if (json.version !== LAYOUT_VERSION) {
    return { kind: 'degraded', problems: [`version ${JSON.stringify(json.version)} is not one this build reads (it reads ${LAYOUT_VERSION}).`] };
  }
  if (json.sides === undefined) return { kind: 'degraded', problems: ['sides is missing.'] };
  if (!isObject(json.sides)) return { kind: 'degraded', problems: ['sides is not an object.'] };

  const notShown: string[] = [];
  const otherSides = Object.keys(json.sides).filter((side) => side !== 'right');
  if (otherSides.length > 0) notShown.push(`Only the right side is shown yet; this file also has ${otherSides.join(' and ')}.`);

  const right = json.sides.right;
  if (right === undefined) return notShown.length > 0 ? { kind: 'degraded', problems: notShown } : { kind: 'empty' };
  if (!isObject(right)) return { kind: 'degraded', problems: ['sides.right is not an object.'] };
  if (!Array.isArray(right.groups)) return { kind: 'degraded', problems: ['sides.right.groups is not an array.'] };
  if (right.groups.length === 0) return notShown.length > 0 ? { kind: 'degraded', problems: notShown } : { kind: 'empty' };
  if (right.groups.length > 1) notShown.push(`Only the first group is shown yet; the right side has ${count(right.groups.length - 1, 'more group')}.`);

  const group: unknown = right.groups[0];
  if (!isObject(group)) return { kind: 'degraded', problems: ['The first group on the right is not an object.'] };
  if (!Array.isArray(group.panels)) return { kind: 'degraded', problems: ['The first group on the right has no panels array.'] };

  const seen = new Set<string>();
  const slots = group.panels.map((raw, index) => validateEntry(raw, index, types, report, seen));
  const shown = slots.find((slot) => !slot.hidden);
  if (!shown) return { kind: 'empty' };
  const rest = slots.filter((slot) => slot !== shown && !slot.hidden);
  if (rest.length > 0) notShown.push(`Only one panel is shown yet; this group also has ${rest.map((slot) => slot.key).join(', ')}.`);
  return { kind: 'panel', slot: shown, notShown };
}
