import type { PathBase, PathKind } from './panels';

/**
 * Main's two rules for a path option, pure so that the window's checks answer `checkPath` the way main does: where the value points, and what is wrong with what is there.
 * Main (src/main/config.ts) does the looking — the one part that needs the filesystem — and hands what it found to `pathProblem`.
 * POSIX only, as the app is: a path is `/`-separated and absolute from `/`.
 */

/** What is at a path, as far as a check needs to know: nothing, a folder, a file that may or may not run, or something else (a socket, a device). */
export type Found = 'missing' | 'directory' | 'file' | 'executable' | 'other';

/** `.` and `..` folded away and repeated slashes collapsed, as Node's `path.posix.normalize` does: a trailing slash kept, and `..` past the root dropped. */
function normalize(value: string): string {
  const absolute = value.startsWith('/');
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (part === '' || part === '.') continue;
    if (part !== '..') parts.push(part);
    else if (parts.length > 0 && parts.at(-1) !== '..') parts.pop();
    else if (!absolute) parts.push(part);
  }
  const joined = `${absolute ? '/' : ''}${parts.join('/')}`;
  if (joined === '' || joined === '/') return absolute ? '/' : '.';
  return value.endsWith('/') ? `${joined}/` : joined;
}

/**
 * Where a path option points: `~` and `~/…` under the home directory, so a shared layout file works on another machine; an absolute path as it is; anything else against `base`.
 * `~/…` is joined as `path.join` joins, and the rest resolved as `path.resolve` resolves (no trailing slash), which is what main did with Node's own before this was shared.
 * `home` and `configRoot` are main's `homedir()` and config folder, handed in.
 */
export function resolvePathIn(value: string, base: PathBase, home: string, configRoot: string): string {
  if (value === '~') return home;
  if (value.startsWith('~/')) return normalize([home, value.slice(2)].filter((part) => part !== '').join('/'));
  const resolved = normalize(value.startsWith('/') ? value : `${base === 'config' ? configRoot : base.dir}/${value}`);
  return resolved.length > 1 && resolved.endsWith('/') ? resolved.slice(0, -1) : resolved;
}

/** What is wrong with a path option, given what is there, worded in the value as the user wrote it; null when it is there and of the kind asked for. */
export function pathProblem(value: string, must: PathKind, found: Found): string | null {
  if (found === 'missing') return `${value} not found`;
  if (must === 'directory') return found === 'directory' ? null : `${value} is not a folder`;
  if (found !== 'file' && found !== 'executable') return `${value} is not a file`;
  return found === 'executable' ? null : `${value} is not executable`;
}
