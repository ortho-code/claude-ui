import path from 'node:path';
import { describe, it, expect } from 'vitest';

import { pathProblem, resolvePathIn, type Found } from '../../../src/shared/pathcheck';
import { posix } from '../../renderer/support/posix';

const HOME = '/home/someone';
const CONFIG = '/home/someone/.config/claude-ui/config';
type Base = 'config' | { dir: string };

describe('resolvePathIn', () => {
  const resolve = (value: string, base: Base): string => resolvePathIn(value, base, HOME, CONFIG, path.posix);

  it('puts ~ and ~/… under the home folder, an absolute path as it is, and anything else against the base', () => {
    expect(resolve('~', 'config')).toBe(HOME);
    expect(resolve('~/bin/status', { dir: '/repo' })).toBe(`${HOME}/bin/status`);
    expect(resolve('~name/x', { dir: '/repo' })).toBe('/repo/~name/x');
    expect(resolve('/opt/x', 'config')).toBe('/opt/x');
    expect(resolve('scripts/x.sh', 'config')).toBe(`${CONFIG}/scripts/x.sh`);
    expect(resolve('../up', { dir: '/repo/sub' })).toBe('/repo/up');
  });
});

// The stand-in hands the rule its own copy of Node's path functions, since it runs in the page: one that answers otherwise than Node would answer `checkPath` as main does not.
describe("the stand-in's copy of Node's path functions", () => {
  const values = [
    'scripts/x.sh',
    './scripts/x.sh',
    'scripts//x.sh',
    'scripts/x.sh/',
    'scripts/../x.sh',
    '../../up',
    '../../../../../../past-the-root',
    '.',
    '..',
    '',
    '/opt/x',
    '/opt/./x/../y/',
    '//opt//x',
    '/',
    '~',
    '~/',
    '~/bin/status',
    '~/bin/status/',
    '~/../elsewhere',
    '~//double',
    '~name/is/not/home',
    'a dir/with spaces',
  ];
  const bases: Base[] = ['config', { dir: '/repo' }, { dir: '/repo/sub/' }, { dir: '/' }];

  it('takes the rule to the same place as Node does, for every value against every base', () => {
    for (const base of bases) for (const value of values) expect(resolvePathIn(value, base, HOME, CONFIG, posix), `${JSON.stringify(value)} against ${JSON.stringify(base)}`).toBe(resolvePathIn(value, base, HOME, CONFIG, path.posix));
  });

  it('joins and resolves generated paths as Node does', () => {
    // Seeded, so a failure is the same failure on every run.
    let seed = 1;
    const pick = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const SEGMENTS = ['', '.', '..', 'a', 'b c', '~', '~x', '...', '.hidden', 'a.', '..a'];
    const generated = (): string => {
      const relative = Array.from({ length: pick(6) }, () => SEGMENTS[pick(SEGMENTS.length)]).join('/');
      return pick(2) === 0 ? relative : `/${relative}`;
    };
    for (let i = 0; i < 5000; i++) {
      const parts = Array.from({ length: 1 + pick(3) }, generated);
      expect(posix.join(...parts), `join of ${JSON.stringify(parts)}`).toBe(path.posix.join(...parts));
      // The copy's resolve has no working directory, so it is asked only what has an absolute path, as main's rule always asks.
      const from = [`/${generated()}`, ...parts];
      expect(posix.resolve(...from), `resolve of ${JSON.stringify(from)}`).toBe(path.posix.resolve(...from));
    }
  });
});

describe('pathProblem', () => {
  const table: [Found, string | null, string | null][] = [
    // found, must be executable, must be a folder
    ['missing', 'x not found', 'x not found'],
    ['directory', 'x is not a file', null],
    ['file', 'x is not executable', 'x is not a folder'],
    ['executable', null, 'x is not a folder'],
    ['other', 'x is not a file', 'x is not a folder'],
  ];

  it('words what is wrong in the value as written, for each thing that can be there', () => {
    for (const [found, executable, directory] of table) {
      expect(pathProblem('x', 'executable', found), `${found} as executable`).toBe(executable);
      expect(pathProblem('x', 'directory', found), `${found} as folder`).toBe(directory);
    }
  });
});
