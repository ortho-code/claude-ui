import { describe, it, expect } from 'vitest';
import { INTERVAL_OPTION, isFixedPath, optionProblems, optionsOf, parseDuration, pathChecks, type OptionsDecl } from '../../../../src/renderer/panels/options';
import { commandType } from '../../../../src/renderer/panels/types/command';

const none: OptionsDecl = { name: 'terminal', options: [], exactlyOne: [] };

describe('optionsOf', () => {
  it('hands over the entry’s options as written, and nothing for an entry without', () => {
    expect(optionsOf({ id: 'a', type: 'command', options: { command: 'ls' } })).toEqual({ command: 'ls' });
    expect(optionsOf({ id: 'a', type: 'command' })).toEqual({});
    expect(optionsOf(null)).toEqual({});
  });
});

describe('optionProblems', () => {
  it('says nothing about options that are sound', () => {
    expect(optionProblems({ command: 'git status --short' }, commandType)).toEqual([]);
    expect(optionProblems({ script: 'scripts/status.sh' }, commandType)).toEqual([]);
    expect(optionProblems({ script: '~/bin/status' }, commandType)).toEqual([]);
    expect(optionProblems({}, none)).toEqual([]);
  });

  it.each([
    [{}, 'One of command or script is required.'],
    [{ command: 'ls', script: 'x.sh' }, 'command and script are both given; give one.'],
    [{ command: 7 }, 'command is not a string.'],
    [{ command: '  ' }, 'command is empty.'],
    [{ script: '' }, 'script is empty.'],
    [{ script: '~me/bin/status' }, 'script ~me/bin/status: only ~ and ~/… are expanded.'],
    [{ comand: 'ls' }, 'comand is not an option of the command type (it has: command, script, cwd).'],
    [{ command: 'ls', cwd: '' }, 'cwd is empty.'],
    [{ command: 'ls', cwd: 3 }, 'cwd is not a string.'],
    [{ command: 'ls', cwd: '~other/x' }, 'cwd ~other/x: only ~ and ~/… are expanded.'],
  ])('refuses %j: %s', (options, problem) => {
    expect(optionProblems(options, commandType)).toContain(problem);
  });

  it('names an option on a type that takes none', () => {
    expect(optionProblems({ cwd: '/x' }, none)).toEqual(['cwd is not an option: the terminal type takes none.']);
  });

  it('collects every problem, not only the first', () => {
    expect(optionProblems({ comand: 'ls' }, commandType)).toEqual([
      'comand is not an option of the command type (it has: command, script, cwd).',
      'One of command or script is required.',
    ]);
  });
});

describe('a duration', () => {
  const every: OptionsDecl = { name: 'reviews', options: [INTERVAL_OPTION], exactlyOne: [] };

  it.each([
    ['30s', 30_000],
    ['5m', 300_000],
    ['1h', 3_600_000],
  ])('reads %s as %i ms', (value, ms) => expect(parseDuration(value)).toBe(ms));

  it.each(['5', '5 m', '1.5m', '0s', '-5m', '5d', 'm'])('refuses %j', (value) => expect(parseDuration(value)).toBeNull());

  it('names a value that is not one, and one below the shortest the interval allows', () => {
    expect(optionProblems({ interval: 'soon' }, every)).toEqual(['interval "soon" is not a duration like 30s, 5m or 1h.']);
    expect(optionProblems({ interval: '5s' }, every)).toEqual(['interval 5s is shorter than the 10s it can be at the least.']);
    expect(optionProblems({ interval: '10s' }, every)).toEqual([]);
  });
});

describe('isFixedPath', () => {
  it.each(['/srv/app', '~', '~/development/standards-sync'])('takes %s as one place whatever is selected', (value) => expect(isFixedPath(value)).toBe(true));
  it.each(['packages/api', './x', '../up', '~other/x', 'x/~/y'])('takes %s as relative', (value) => expect(isFixedPath(value)).toBe(false));
});

describe('pathChecks', () => {
  it('asks main about each path option given, with its base and what it must be, and about nothing else', () => {
    expect(pathChecks({ script: 'scripts/status.sh' }, commandType, '/repo')).toEqual([{ name: 'script', value: 'scripts/status.sh', base: 'config', must: 'executable' }]);
    expect(pathChecks({ command: 'ls' }, commandType, '/repo')).toEqual([]);
  });

  it('checks a relative cwd under the context directory, and a fixed one whatever is selected', () => {
    expect(pathChecks({ command: 'ls', cwd: 'packages/api' }, commandType, '/repo')).toEqual([{ name: 'cwd', value: 'packages/api', base: { dir: '/repo' }, must: 'directory' }]);
    expect(pathChecks({ command: 'ls', cwd: '~/x' }, commandType, null)).toEqual([{ name: 'cwd', value: '~/x', base: { dir: '/' }, must: 'directory' }]);
  });

  it('leaves out a relative cwd with no context to be under, since the panel says Pick a project for it', () => {
    expect(pathChecks({ command: 'ls', cwd: 'packages/api' }, commandType, null)).toEqual([]);
  });

  it('keeps a script against the config folder even beside a cwd: a cwd moves where it runs, never which file runs', () => {
    expect(pathChecks({ script: 'scripts/s.sh', cwd: 'sub' }, commandType, '/repo').map((ask) => [ask.name, ask.base])).toEqual([
      ['script', 'config'],
      ['cwd', { dir: '/repo' }],
    ]);
  });
});
