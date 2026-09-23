import { describe, it, expect } from 'vitest';
import { optionProblems, optionsOf, pathChecks, type OptionsDecl } from './options';
import { commandType } from './types/command';

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
    [{ comand: 'ls' }, 'comand is not an option of the command type (it has: command, script).'],
  ])('refuses %j: %s', (options, problem) => {
    expect(optionProblems(options, commandType)).toContain(problem);
  });

  it('names an option on a type that takes none', () => {
    expect(optionProblems({ cwd: '/x' }, none)).toEqual(['cwd is not an option: the terminal type takes none.']);
  });

  it('collects every problem, not only the first', () => {
    expect(optionProblems({ comand: 'ls' }, commandType)).toEqual([
      'comand is not an option of the command type (it has: command, script).',
      'One of command or script is required.',
    ]);
  });
});

describe('pathChecks', () => {
  it('asks main about each path option given, with its base and what it must be, and about nothing else', () => {
    expect(pathChecks({ script: 'scripts/status.sh' }, commandType)).toEqual([{ value: 'scripts/status.sh', base: 'config', must: 'executable' }]);
    expect(pathChecks({ command: 'ls' }, commandType)).toEqual([]);
  });
});
