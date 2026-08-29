import { describe, it, expect, vi } from 'vitest';

// terminal.ts reaches electron and node-pty at import time, and through status.ts it reaches paths.ts, which pins the userData path on import. None of that is involved in building an argument list.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/claude-ui-test', setPath: () => {} },
  ipcMain: { handle: () => {}, on: () => {} },
}));
vi.mock('node-pty', () => ({ spawn: () => ({}) }));

import { claudeArgs } from './terminal';

const SETTINGS = '/home/u/.config/claude-ui/claude-settings.json';

describe('claudeArgs', () => {
  it('passes the settings file when there is one', () => {
    expect(claudeArgs({ settingsFile: SETTINGS })).toEqual(['--settings', SETTINGS]);
  });

  it('launches bare while the settings file has not been written yet', () => {
    expect(claudeArgs({ settingsFile: null })).toEqual([]);
  });

  it('resumes a session, and forks only when asked', () => {
    expect(claudeArgs({ settingsFile: null, resumeSessionId: 'abc-123' })).toEqual(['--resume', 'abc-123']);
    expect(claudeArgs({ settingsFile: null, resumeSessionId: 'abc-123', fork: true })).toEqual([
      '--resume',
      'abc-123',
      '--fork-session',
    ]);
  });

  it('ignores a fork with nothing to fork from', () => {
    expect(claudeArgs({ settingsFile: null, fork: true })).toEqual([]);
  });

  it('drops a session id that is not filename-safe, rather than passing it on', () => {
    for (const id of ['a b', 'a;rm -rf /', '../x', '']) {
      expect(claudeArgs({ settingsFile: null, resumeSessionId: id })).toEqual([]);
    }
  });

  it('tells the three worktree cases apart', () => {
    expect(claudeArgs({ settingsFile: null, worktree: 'feature' })).toEqual(['-w', 'feature']);
    expect(claudeArgs({ settingsFile: null, worktree: '' })).toEqual(['-w']);
    expect(claudeArgs({ settingsFile: null })).toEqual([]);
  });

  it('keeps a name with spaces and quotes as ONE argument, unescaped', () => {
    // The whole point of passing argv rather than a shell string: no quoting happens here, so none has to be undone later.
    const name = "it's a \"long\" name";
    expect(claudeArgs({ settingsFile: null, name })).toEqual(['--name', name]);
  });

  it('keeps a settings path containing a space intact (macOS Application Support)', () => {
    const mac = '/Users/u/Library/Application Support/claude-ui/claude-settings.json';
    expect(claudeArgs({ settingsFile: mac })).toEqual(['--settings', mac]);
  });

  it('omits an empty name, which claude would reject', () => {
    expect(claudeArgs({ settingsFile: null, name: '' })).toEqual([]);
  });

  it('orders the flags settings, resume, name, worktree', () => {
    expect(
      claudeArgs({ settingsFile: SETTINGS, resumeSessionId: 'abc', fork: true, name: 'my thing', worktree: 'wt' }),
    ).toEqual(['--settings', SETTINGS, '--resume', 'abc', '--fork-session', '--name', 'my thing', '-w', 'wt']);
  });
});
