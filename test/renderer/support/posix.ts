import type { PathFunctions } from '../../../src/shared/pathcheck';

/**
 * Node's `path.posix.join` and `path.posix.resolve` for the stand-in, which runs in the page where Node's `path` is not, so that `checkPath` is answered by main's own rule (`resolvePathIn`).
 * A copy of Node, held to it by a unit test (test/unit/shared/pathcheck.test.ts) rather than trusted.
 * `resolve` has no working directory to fall back on, so a call without an absolute path throws; main's never is one, since a base is the config folder or an absolute folder.
 */

/** `.` and `..` folded away and repeated slashes collapsed, as `path.posix.normalize` does: a trailing slash kept, and `..` past the root dropped. */
function normalize(value: string): string {
  if (value === '') return '.';
  const absolute = value.startsWith('/');
  const parts: string[] = [];
  for (const part of value.split('/')) {
    if (part === '' || part === '.') continue;
    if (part !== '..') parts.push(part);
    else if (parts.length > 0 && parts.at(-1) !== '..') parts.pop();
    else if (!absolute) parts.push(part);
  }
  const trailing = value.endsWith('/') ? '/' : '';
  if (parts.length === 0) return absolute ? '/' : `.${trailing}`;
  return `${absolute ? '/' : ''}${parts.join('/')}${trailing}`;
}

export const posix: PathFunctions = {
  join: (...paths) => normalize(paths.filter((part) => part !== '').join('/')),
  resolve: (...paths) => {
    // From the right, up to the first absolute path, as Node walks it.
    let resolved = '';
    for (const part of [...paths].reverse()) {
      if (part !== '') resolved = `${part}/${resolved}`;
      if (resolved.startsWith('/')) break;
    }
    if (!resolved.startsWith('/')) throw new Error(`resolve(${JSON.stringify(paths)}) has no absolute path, and the stand-in no working directory to resolve against`);
    const normal = normalize(resolved);
    return normal.length > 1 && normal.endsWith('/') ? normal.slice(0, -1) : normal;
  },
};
