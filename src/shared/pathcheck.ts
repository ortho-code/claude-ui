import type { PathBase, PathKind } from './panels';

/**
 * Main's two rules for a path option, pure so that the window's checks answer `checkPath` the way main does: where the value points, and what is wrong with what is there.
 * Main (src/main/config.ts) does the looking — the one part that needs the filesystem — and hands what it found to `pathProblem`.
 */

/** What is at a path, as far as a check needs to know: nothing, a folder, a file that may or may not run, or something else (a socket, a device). */
export type Found = 'missing' | 'directory' | 'file' | 'executable' | 'other';

/**
 * The two path functions the rule needs, as Node's `path` has them.
 * Main hands in Node's own, so which file or folder an option means is decided by Node; the window checks' stand-in runs where Node's is not, and hands in a copy held to Node by a unit test (test/renderer/support/posix.ts).
 */
export interface PathFunctions {
  join(...paths: string[]): string;
  resolve(...paths: string[]): string;
}

/**
 * Where a path option points: `~` and `~/…` under the home directory, so a shared layout file works on another machine; an absolute path as it is; anything else against `base`.
 * `home`, `configRoot` and `path` are main's `homedir()`, config folder and Node's `path`, handed in.
 */
export function resolvePathIn(value: string, base: PathBase, home: string, configRoot: string, path: PathFunctions): string {
  if (value === '~') return home;
  if (value.startsWith('~/')) return path.join(home, value.slice(2));
  return path.resolve(base === 'config' ? configRoot : base.dir, value);
}

/** What is wrong with a path option, given what is there, worded in the value as the user wrote it; null when it is there and of the kind asked for. */
export function pathProblem(value: string, must: PathKind, found: Found): string | null {
  if (found === 'missing') return `${value} not found`;
  if (must === 'directory') return found === 'directory' ? null : `${value} is not a folder`;
  if (found !== 'file' && found !== 'executable') return `${value} is not a file`;
  return found === 'executable' ? null : `${value} is not executable`;
}
