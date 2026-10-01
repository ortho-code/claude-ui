import { describe, it, expect } from 'vitest';
import { commandSource, commandType } from '../../../../../src/renderer/panels/types/command';

describe('commandSource', () => {
  it('takes the one option the entry gave', () => {
    expect(commandSource({ command: 'git status' })).toEqual({ command: 'git status' });
    expect(commandSource({ script: 'scripts/s.sh' })).toEqual({ script: 'scripts/s.sh' });
  });
});

describe('the declaration', () => {
  it('requires exactly one of command and script', () => {
    expect(commandType.exactlyOne).toEqual([['command', 'script']]);
    expect(commandType.options.map((option) => option.name)).toEqual(['command', 'script', 'cwd']);
  });

  it('takes the one cwd declaration both types share: a folder, under the context directory when relative', () => {
    expect(commandType.options.find((option) => option.name === 'cwd')).toEqual({ name: 'cwd', kind: 'path', against: 'context', must: 'directory' });
  });

  it('asks a script to be an executable, resolved against the config folder, declared beside the option', () => {
    expect(commandType.options.find((option) => option.name === 'script')).toEqual({ name: 'script', kind: 'path', against: 'config', must: 'executable' });
  });

  it('titles by the line, cut to length, or by the script’s file name', () => {
    expect(commandType.defaultTitle({ command: '  git status --short ' })).toBe('git status --short');
    expect(commandType.defaultTitle({ command: 'x'.repeat(60) })).toBe(`${'x'.repeat(39)}…`);
    expect(commandType.defaultTitle({ script: 'scripts/my status.sh' })).toBe('my status.sh');
    expect(commandType.defaultTitle({ script: '/opt/tools/status' })).toBe('status');
  });

  it('gives no title for options that give none, since they are read before they are checked', () => {
    expect(commandType.defaultTitle({})).toBeNull();
    expect(commandType.defaultTitle({ command: 7 })).toBeNull();
    expect(commandType.defaultTitle({ command: '   ' })).toBeNull();
    expect(commandType.defaultTitle({ script: '', command: 'ls' })).toBe('ls');
  });
});
