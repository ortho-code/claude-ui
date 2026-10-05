import { describe, it, expect, vi } from 'vitest';

import { parseLaunchFlags, isReservedFlag, flagNames } from '../../../src/shared/flags';

// Only needed for the reserved-list cross-check below, which imports terminal.ts.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/claude-ui-test', setPath: () => {} },
  ipcMain: { handle: () => {}, on: () => {} },
}));
vi.mock('node-pty', () => ({ spawn: () => ({}) }));

import { claudeArgs } from '../../../src/main/terminal';

const ok = (input: string): string[] => {
  const parsed = parseLaunchFlags(input);
  expect(parsed.error).toBe(null);
  return parsed.tokens;
};

const fails = (input: string): string => {
  const parsed = parseLaunchFlags(input);
  expect(parsed.error).not.toBe(null);
  expect(parsed.tokens).toEqual([]);
  return parsed.error!;
};

describe('flagNames', () => {
  it('names each flag once, without its value in either form', () => {
    expect(flagNames(ok('--model opus --effort=high --append-system-prompt "be brief, it is late"'))).toEqual([
      '--model',
      '--effort',
      '--append-system-prompt',
    ]);
  });

  it('has nothing for an empty line', () => {
    expect(flagNames([])).toEqual([]);
  });
});

describe('parseLaunchFlags', () => {
  it('has nothing to say about an empty field', () => {
    expect(ok('')).toEqual([]);
    expect(ok('   \t ')).toEqual([]);
  });

  it('splits the motivating case', () => {
    expect(ok('--allowedTools Grep,Glob')).toEqual(['--allowedTools', 'Grep,Glob']);
  });

  it('treats any run of whitespace as one separator', () => {
    expect(ok('  --a\t\t--b   --c ')).toEqual(['--a', '--b', '--c']);
  });

  it('keeps a quoted value as one argument', () => {
    expect(ok('--append-system-prompt "be brief and kind"')).toEqual(['--append-system-prompt', 'be brief and kind']);
    expect(ok("--add-dir '/home/u/my projects'")).toEqual(['--add-dir', '/home/u/my projects']);
  });

  it('leaves an apostrophe inside double quotes alone', () => {
    expect(ok('--append-system-prompt "it\'s fine"')).toEqual(['--append-system-prompt', "it's fine"]);
  });

  it('joins quoted and unquoted halves of one argument, as a shell does', () => {
    expect(ok('--model"opus"')).toEqual(['--modelopus']);
    expect(ok('--x a"b"c')).toEqual(['--x', 'abc']);
  });

  it('keeps an empty quoted argument', () => {
    expect(ok('--name-ish ""')).toEqual(['--name-ish', '']);
  });

  it('escapes a space outside quotes', () => {
    expect(ok('--add-dir /home/u/my\\ dir')).toEqual(['--add-dir', '/home/u/my dir']);
  });

  it('escapes a quote inside double quotes, and leaves other backslashes literal', () => {
    expect(ok('--x "say \\"hi\\""')).toEqual(['--x', 'say "hi"']);
    expect(ok('--x "C:\\Users\\me"')).toEqual(['--x', 'C:\\Users\\me']);
  });

  it('takes a single-quoted string literally, backslashes included', () => {
    expect(ok("--x 'a\\b'")).toEqual(['--x', 'a\\b']);
  });

  it('does NOT expand anything a shell would', () => {
    // These reach claude as argv, so they are text.
    // The test pins that, because the day someone reintroduces a shell string this is what silently changes.
    expect(ok('--x $HOME')).toEqual(['--x', '$HOME']);
    expect(ok('--x "$(rm -rf /)"')).toEqual(['--x', '$(rm -rf /)']);
    expect(ok('--x *.ts')).toEqual(['--x', '*.ts']);
    expect(ok('--x a;b')).toEqual(['--x', 'a;b']);
  });

  it('reports an unclosed quote rather than guessing where it ended', () => {
    expect(fails('--x "unfinished')).toMatch(/double quote/);
    expect(fails("--x 'unfinished")).toMatch(/single quote/);
  });

  it('reports a trailing backslash', () => {
    expect(fails('--x \\')).toMatch(/backslash/);
  });

  it('refuses each flag claude-ui sets itself, by either spelling', () => {
    for (const flag of ['--settings', '--resume', '-r', '--fork-session', '--name', '-n', '--worktree', '-w', '--session-id']) {
      expect(fails(`--allowedTools Grep ${flag} x`)).toContain(flag);
    }
  });

  it('refuses flags that would leave no interactive session in the tab', () => {
    for (const flag of [
      '--print',
      '-p',
      '--continue',
      '-c',
      '--background',
      '--bg',
      '--cloud',
      '--teleport',
      '--remote-control',
      '--tmux',
      '--from-pr',
      '--version',
      '-v',
      '--help',
      '-h',
    ]) {
      expect(fails(flag)).toContain(flag);
    }
  });

  it('refuses flags that would hide the session from the app, or that belong to --print', () => {
    for (const flag of [
      '--no-session-persistence',
      '--input-format',
      '--output-format',
      '--json-schema',
      '--include-partial-messages',
      '--replay-user-messages',
    ]) {
      expect(fails(flag)).toContain(flag);
    }
  });

  it('leaves flags that are merely risky to the person typing them', () => {
    // The rule is "would this break the app", not "is this wise".
    // Someone's own machine, their call.
    expect(ok('--dangerously-skip-permissions')).toEqual(['--dangerously-skip-permissions']);
    expect(ok('--permission-mode acceptEdits')).toEqual(['--permission-mode', 'acceptEdits']);
  });

  it('refuses a leading word, which claude would read as a command or a prompt', () => {
    expect(fails('update')).toContain('update');
    expect(fails('doctor --verbose')).toContain('doctor');
  });

  it('still allows a bare word as a flag VALUE, which is where most of them belong', () => {
    expect(ok('--model opus')).toEqual(['--model', 'opus']);
  });

  it('refuses a reserved flag written as --flag=value', () => {
    expect(fails('--name=mine')).toContain('--name');
  });

  it('allows a flag that merely starts like a reserved one', () => {
    expect(ok('--resumeish x')).toEqual(['--resumeish', 'x']);
    expect(ok('--settings-ish x')).toEqual(['--settings-ish', 'x']);
  });

  it('allows a reserved word as a VALUE, since only flags are reserved', () => {
    expect(ok('--append-system-prompt "use --resume to continue"')).toEqual([
      '--append-system-prompt',
      'use --resume to continue',
    ]);
  });
});

describe('the reserved list and the launch line', () => {
  it('reserves every flag claude-ui passes itself', () => {
    // The link between the two lists, since the compiler cannot make one: ask claudeArgs for a launch with every option set, and require that each flag it emits is refused in the field.
    const emitted = claudeArgs({
      settingsFile: '/tmp/claude-settings.json',
      sessionId: 'new-id',
      resumeSessionId: 'abc',
      fork: true,
      name: 'a name',
      worktree: 'wt',
    }).filter((arg) => arg.startsWith('-'));
    expect(emitted.length).toBeGreaterThan(0);
    for (const flag of emitted) expect(isReservedFlag(flag)).toBe(true);
  });
});
