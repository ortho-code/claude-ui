import type { PanelEntry, PathBase, PathKind } from '../../shared/panels';

/**
 * A panel type's own settings, the entry's `options`: declared by the type, checked by the type, read by nobody else.
 *
 * THE LAYOUT READS THE LAYOUT.
 * It checks an entry's `id`, `type`, `title`, `hidden` and `icon` and hands `options` over whole; what is wrong inside them is the type's to say, through its host, when it is mounted and before it runs.
 * So one checker serves every type, driven by the type's declaration — an option cannot be known to the check and not to the type, and a type can gain one without the layout learning its name.
 * The declaration is also what a form for the file would be built from, if the app ever gets an editor.
 */

export interface OptionDecl {
  name: string;
  /** `duration` is a whole number and a unit, `30s`, `5m` or `1h`. */
  kind: 'text' | 'path' | 'duration';
  /**
   * For a `path`: what a relative value resolves against — the config folder, or the panel's context directory — and what it must point at.
   * Declared beside the option so the check is not something the type has to remember.
   */
  against?: 'config' | 'context';
  must?: PathKind;
  /** For a `duration`: the shortest it may be, in ms. */
  atLeast?: number;
}

/**
 * The folder a `command` or `terminal` panel runs in, when it is not the context directory itself.
 * ONE declaration, used by both types.
 * Absolute or under `~` is FIXED: there, whatever is selected.
 * Relative is under the context directory, so it follows the project into a subfolder.
 */
export const CWD_OPTION: OptionDecl = { name: 'cwd', kind: 'path', against: 'context', must: 'directory' };

/**
 * How often a panel runs again on its own, for a type that re-runs at all: ONE declaration, taken by the types that want it and by no other, since a shell has nothing to re-run.
 * Ten seconds at the least, so a typo cannot turn a panel into a script started every second.
 */
export const INTERVAL_OPTION: OptionDecl = { name: 'interval', kind: 'duration', atLeast: 10_000 };

const DURATION = /^(\d+)(s|m|h)$/;
const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000 } as const;

/** A duration as the file writes it, in ms; null for anything that is not one. */
export function parseDuration(value: string): number | null {
  const match = DURATION.exec(value);
  if (!match) return null;
  const ms = Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS];
  return ms > 0 ? ms : null;
}

/** How often an entry's panel runs on its own, in ms: its own `interval`, else `fallback` (a type's default, as the file writes it); null for neither, or for one that is not a duration. */
export function intervalOf(options: Record<string, unknown>, fallback: string | null = null): number | null {
  const value = typeof options.interval === 'string' ? options.interval : fallback;
  return value === null ? null : parseDuration(value);
}

/** "10s", "5m": a length in ms in the unit the file would write it in. */
function durationLabel(ms: number): string {
  if (ms % UNIT_MS.h === 0) return `${ms / UNIT_MS.h}h`;
  if (ms % UNIT_MS.m === 0) return `${ms / UNIT_MS.m}m`;
  return `${ms / UNIT_MS.s}s`;
}

/** Whether a path value names one place whatever is selected: absolute, or under the home directory. */
export function isFixedPath(value: string): boolean {
  return value.startsWith('/') || value === '~' || value.startsWith('~/');
}

/** What a type declares about its options. */
export interface OptionsDecl {
  name: string;
  options: OptionDecl[];
  /** Groups of option names of which EXACTLY ONE must be given. */
  exactlyOne: string[][];
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * An entry's options as written; `{}` when it has none.
 * The layout has already refused an `options` that is not an object.
 */
export function optionsOf(entry: PanelEntry | null): Record<string, unknown> {
  return isObject(entry?.options) ? entry.options : {};
}

/** "a and b are both given", "a, b and c are all given". */
function doubled(given: string[]): string {
  const list = given.length === 2 ? given.join(' and ') : `${given.slice(0, -1).join(', ')} and ${given.at(-1)}`;
  return `${list} are ${given.length === 2 ? 'both' : 'all'} given; give one.`;
}

/**
 * What the file says wrong about a type's options, before anything is looked up on disk: every problem, not only the first, so one look says all there is to fix.
 * Pure, and tested per rule, including every refusal.
 */
export function optionProblems(options: Record<string, unknown>, decl: OptionsDecl): string[] {
  const problems: string[] = [];
  const known = decl.options.map((option) => option.name);
  for (const name of Object.keys(options)) {
    if (known.includes(name)) continue;
    problems.push(
      known.length === 0
        ? `${name} is not an option: the ${decl.name} type takes none.`
        : `${name} is not an option of the ${decl.name} type (it has: ${known.join(', ')}).`,
    );
  }
  for (const group of decl.exactlyOne) {
    const given = group.filter((name) => options[name] !== undefined);
    if (given.length === 0) problems.push(`One of ${group.join(' or ')} is required.`);
    else if (given.length > 1) problems.push(doubled(given));
  }
  for (const option of decl.options) {
    const value = options[option.name];
    if (value === undefined) continue;
    const problem = valueProblem(option, value);
    if (problem) problems.push(problem);
  }
  return problems;
}

/**
 * What is wrong with one option's value as written, or null: the ONE check of a value, for an entry's options and for a default a type's manifest gives.
 * Nothing on disk is looked at here; a path's target is `checkOptions`' to ask about.
 */
export function valueProblem(option: OptionDecl, value: unknown): string | null {
  if (typeof value !== 'string') return `${option.name} is not a string.`;
  if (value.trim() === '') return `${option.name} is empty.`;
  // Only `~` alone and `~/…` are expanded; `~user` would quietly become a folder named `~user` under the base.
  if (option.kind === 'path' && value.startsWith('~') && value !== '~' && !value.startsWith('~/')) return `${option.name} ${value}: only ~ and ~/… are expanded.`;
  if (option.kind === 'duration') {
    const ms = parseDuration(value);
    if (ms === null) return `${option.name} "${value}" is not a duration like 30s, 5m or 1h.`;
    if (option.atLeast !== undefined && ms < option.atLeast) return `${option.name} ${value} is shorter than the ${durationLabel(option.atLeast)} it can be at the least.`;
  }
  return null;
}

/** One path option to ask main about. */
export interface PathAsk {
  name: string;
  value: string;
  base: PathBase;
  must: PathKind;
}

/**
 * The path options an entry gives, with what each resolves against and must be: what main is asked about.
 * Only for options whose shape passed.
 * `contextDir` is the panel's context directory, or null without one: a relative value against the context then has nothing to be checked against and is left out, since the panel says "Pick a project" for it instead.
 */
export function pathChecks(options: Record<string, unknown>, decl: OptionsDecl, contextDir: string | null): PathAsk[] {
  const asks: PathAsk[] = [];
  for (const option of decl.options) {
    const value = options[option.name];
    if (option.kind !== 'path' || typeof value !== 'string') continue;
    const must = option.must ?? 'executable';
    if (option.against !== 'context') asks.push({ name: option.name, value, base: 'config', must });
    // A fixed value ignores its base, so any will do; a relative one needs the context it is under.
    else if (isFixedPath(value)) asks.push({ name: option.name, value, base: { dir: '/' }, must });
    else if (contextDir !== null) asks.push({ name: option.name, value, base: { dir: contextDir }, must });
  }
  return asks;
}

/** What checking an entry's options found: every problem, and where each path option resolved to. */
export interface OptionsCheck {
  /** Empty means the panel can run. */
  problems: string[];
  /** The absolute path each checked path option resolved to, by option name: what the run uses, so it goes where the check looked. */
  paths: Record<string, string>;
}

/** Every problem with an entry's options: the shape, and when that is sound, each path as main finds it. */
export async function checkOptions(options: Record<string, unknown>, decl: OptionsDecl, contextDir: string | null): Promise<OptionsCheck> {
  const shape = optionProblems(options, decl);
  if (shape.length > 0) return { problems: shape, paths: {} };
  const asks = pathChecks(options, decl, contextDir);
  const checks = await Promise.all(asks.map(({ value, base, must }) => window.claudeUi.checkPath(value, base, must)));
  return {
    problems: checks.flatMap((check) => (check.problem ? [`${check.problem}.`] : [])),
    paths: Object.fromEntries(asks.map((ask, index) => [ask.name, checks[index]!.path])),
  };
}
