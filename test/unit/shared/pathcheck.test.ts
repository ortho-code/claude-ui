import path from 'node:path';
import { describe, it, expect } from 'vitest';

import { pathProblem, resolvePathIn, type Found } from '../../../src/shared/pathcheck';

const HOME = '/home/someone';
const CONFIG = '/home/someone/.config/claude-ui/config';

// What main answered with Node's own `path` before the rule was shared: the shared rule must answer the same, or main changed.
const node = (value: string, base: 'config' | { dir: string }): string => {
  if (value === '~') return HOME;
  if (value.startsWith('~/')) return path.posix.join(HOME, value.slice(2));
  return path.posix.resolve(base === 'config' ? CONFIG : base.dir, value);
};

describe('resolvePathIn', () => {
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
  const bases: ('config' | { dir: string })[] = ['config', { dir: '/repo' }, { dir: '/repo/sub/' }, { dir: '/' }];

  it('answers exactly what Node answered, for every value against every base', () => {
    for (const base of bases) for (const value of values) expect(resolvePathIn(value, base, HOME, CONFIG), `${JSON.stringify(value)} against ${JSON.stringify(base)}`).toBe(node(value, base));
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
