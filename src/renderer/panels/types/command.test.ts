import { describe, it, expect } from 'vitest';
import { resolveContext, commandSource, endLabel, commandType } from './command';

describe('resolveContext', () => {
  it('runs in the active tab’s cwd, so a worktree session’s panel reports the worktree', () => {
    expect(resolveContext({ tab: { cwd: '/repo/.worktrees/x', repoRoot: '/repo', id: 's1' }, project: '/repo' })).toEqual({
      projectRoot: '/repo',
      cwd: '/repo/.worktrees/x',
      sessionId: 's1',
    });
  });

  it('falls back to the selected project’s root with no tab, and to nothing with neither', () => {
    expect(resolveContext({ tab: null, project: '/repo' })).toEqual({ projectRoot: '/repo', cwd: '/repo', sessionId: '' });
    expect(resolveContext({ tab: null, project: null })).toBeNull();
  });

  it('prefers the tab over the project even when the tab belongs to another project (the All view)', () => {
    expect(resolveContext({ tab: { cwd: '/other', repoRoot: '/other', id: 's2' }, project: null })?.cwd).toBe('/other');
  });
});

describe('commandSource', () => {
  it('takes the one parameter the entry gave', () => {
    expect(commandSource({ id: 'a', type: 'command', command: 'git status' })).toEqual({ command: 'git status' });
    expect(commandSource({ id: 'a', type: 'command', script: 'scripts/s.sh' })).toEqual({ script: 'scripts/s.sh' });
  });
});

describe('endLabel', () => {
  it('says nothing about a run that ended well', () => {
    expect(endLabel({ kind: 'exit', code: 0, signal: null })).toBe('');
  });

  it('names the exit code, the signal, or the failure to start', () => {
    expect(endLabel({ kind: 'exit', code: 3, signal: null })).toBe('exit 3');
    expect(endLabel({ kind: 'exit', code: null, signal: 'SIGSEGV' })).toBe('killed by SIGSEGV');
    expect(endLabel({ kind: 'exit', code: null, signal: null, error: '/gone is not there' })).toBe('/gone is not there');
  });

  it('says why the app stopped a run', () => {
    expect(endLabel({ kind: 'stopped', reason: 'timeout' })).toBe('stopped after 30 s');
    expect(endLabel({ kind: 'stopped', reason: 'truncated' })).toBe('output cut at 1 MB');
    expect(endLabel({ kind: 'truncated' })).toBe('output cut at 1 MB');
    expect(endLabel({ kind: 'stopped', reason: 'request' })).toBe('stopped');
  });
});

describe('the declaration', () => {
  it('requires exactly one of command and script', () => {
    expect(commandType.exactlyOne).toEqual([['command', 'script']]);
    expect(commandType.params.map((p) => p.name)).toEqual(['command', 'script']);
  });

  it('resolves a script against the config folder, declared beside the parameter', () => {
    expect(commandType.params.find((p) => p.name === 'script')).toEqual({ name: 'script', kind: 'path', against: 'config' });
  });

  it('titles by the line, cut to length, or by the script’s file name', () => {
    expect(commandType.defaultTitle({ id: 'a', type: 'command', command: '  git status --short ' })).toBe('git status --short');
    expect(commandType.defaultTitle({ id: 'a', type: 'command', command: 'x'.repeat(60) })).toBe(`${'x'.repeat(39)}…`);
    expect(commandType.defaultTitle({ id: 'a', type: 'command', script: 'scripts/my status.sh' })).toBe('my status.sh');
    expect(commandType.defaultTitle({ id: 'a', type: 'command', script: '/opt/tools/status' })).toBe('status');
  });
});
