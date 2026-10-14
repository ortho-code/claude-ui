import { describe, it, expect } from 'vitest';
import { INTERVAL_OPTION, intervalOf, isFixedPath, optionProblems, optionsOf, parseDuration, pathChecks, type OptionDecl, type OptionsDecl } from '../../../../src/renderer/panels/options';
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
    [{ comand: 'ls' }, 'comand is not an option of the command type (it has: command, script, cwd, interval, watch).'],
    [{ command: 'ls', watch: 'tree' }, 'watch "tree" is not one this build has (it has: git).'],
    [{ command: 'ls', watch: true }, 'watch is not a string.'],
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
      'comand is not an option of the command type (it has: command, script, cwd, interval, watch).',
      'One of command or script is required.',
    ]);
  });

  it('takes watch: git', () => {
    expect(optionProblems({ command: 'ls', watch: 'git' }, commandType)).toEqual([]);
  });
});

describe('a list', () => {
  const actions: OptionDecl = { name: 'actions', kind: 'list', fields: [{ name: 'button', kind: 'text' }, { name: 'prompt', kind: 'text' }] };
  const labels: OptionDecl = { name: 'labels', kind: 'list' };
  const stories: OptionsDecl = { name: 'stories', options: [actions, labels], exactlyOne: [] };

  it('takes objects of the fields it declares, a field left out included, and texts without fields', () => {
    expect(optionProblems({ actions: [{ button: 'Research', prompt: '/research {id}' }, { prompt: '/autopilot {id}' }], labels: ['bug', 'chore'] }, stories)).toEqual([]);
  });

  it.each([
    [{ actions: 'Research' }, 'actions is not an array.'],
    [{ actions: [] }, 'actions is empty.'],
    [{ labels: ['bug', 3] }, 'labels[1] is not a string.'],
    [{ labels: [' '] }, 'labels[0] is empty.'],
    [{ actions: ['Research'] }, 'actions[0] is not an object.'],
    [{ actions: [{ buton: 'Research' }] }, 'actions[0].buton is not a field of actions (it has: button, prompt).'],
    [{ actions: [{ button: 3 }] }, 'actions[0].button is not a string.'],
    [{ actions: [{ button: 'Research', prompt: '' }] }, 'actions[0].prompt is empty.'],
  ])('refuses %j: %s', (options, problem) => {
    expect(optionProblems(options, stories)).toEqual([problem]);
  });

  it("names every item's problems, not only the first", () => {
    expect(optionProblems({ actions: [{ button: 3 }, { prompt: '' }] }, stories)).toEqual(['actions[0].button is not a string.', 'actions[1].prompt is empty.']);
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

  it('names a value that is not one, and one below the shortest or above the longest the interval allows', () => {
    expect(optionProblems({ interval: 'soon' }, every)).toEqual(['interval "soon" is not a duration like 30s, 5m or 1h.']);
    expect(optionProblems({ interval: '5s' }, every)).toEqual(['interval 5s is shorter than the 10s it can be at the least.']);
    expect(optionProblems({ interval: '10s' }, every)).toEqual([]);
    expect(optionProblems({ interval: '24h' }, every)).toEqual([]);
    expect(optionProblems({ interval: '25h' }, every)).toEqual(['interval 25h is longer than the 24h it can be at the most.']);
    // Past what a timer holds, which would wrap and run the panel at once, every time.
    expect(optionProblems({ interval: '720h' }, every)).toEqual(['interval 720h is longer than the 24h it can be at the most.']);
  });

  it("reads an entry's interval over its type's, and neither as none", () => {
    expect(intervalOf({ interval: '5m' }, '1h')).toBe(300_000);
    expect(intervalOf({}, '1h')).toBe(3_600_000);
    expect(intervalOf({})).toBeNull();
    expect(intervalOf({ interval: 'soon' })).toBeNull();
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
