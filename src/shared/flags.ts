/**
 * Turning the user's one line of default launch flags into arguments for `claude`.
 *
 * Pure, and deliberately not shell-aware beyond quoting: the tokens produced here are passed to the pty as real argv entries (see `claudeArgs`), so nothing in this file has to defend against shell metacharacters — a `;` or a `$(…)` in a flag value is just text by the time it arrives.
 * What it does have to get right is what a person means when they type a quoted value, which is why this is a tokenizer rather than a `split(' ')`.
 */

/**
 * Flags that cannot be set here, and what to tell someone who tries.
 *
 * The test is one thing only: would this flag break the app's own model of a session? It is NOT a judgement about what is wise to run — `--dangerously-skip-permissions` and friends are deliberately absent, because that is the user's call on their own machine and it does not stop the app working.
 *
 * Names are checked against `claude --help` (2.1.241) rather than remembered, aliases included, since blocking `--print` while letting `-p` through would be worse than not blocking it at all.
 * `claudeArgs` is the other half of the first group: a test asserts that every flag it emits appears here, so adding one to the launch line without reserving it fails the suite rather than shipping.
 */
const RESERVED: { names: string[]; because: string }[] = [
  // Set by claude-ui itself. A second one decides something the app has already decided — which session a tab opens, what it is called, where its hooks come from.
  { names: ['--settings'], because: 'claude-ui loads its status hooks through it' },
  { names: ['--resume', '-r'], because: 'claude-ui decides which session a tab resumes' },
  { names: ['--fork-session'], because: 'claude-ui sets it when you fork a session' },
  { names: ['--name', '-n'], because: 'claude-ui sets it when you name a session' },
  { names: ['--worktree', '-w'], because: 'claude-ui sets it when you start a session in a worktree' },
  { names: ['--session-id'], because: 'claude-ui gives each session its own id, and claude refuses an id twice' },

  // Would not leave an interactive claude running in the tab, which is the one thing a tab is.
  { names: ['--print', '-p'], because: 'it answers once and exits, so the tab would close immediately' },
  { names: ['--continue', '-c'], because: 'it opens the directory’s most recent session, not the one you clicked' },
  { names: ['--background', '--bg'], because: 'it returns straight away and runs the session out of sight' },
  { names: ['--cloud'], because: 'the session would run in the cloud rather than in this tab' },
  { names: ['--teleport'], because: 'it moves the session somewhere else rather than running it here' },
  { names: ['--remote-control'], because: 'it hands the session to another client rather than to this tab' },
  { names: ['--tmux'], because: 'the tab already is the terminal claude runs in' },
  { names: ['--from-pr'], because: 'it starts one particular session, which is not something to do to every session' },
  { names: ['--version', '-v'], because: 'it prints a version and exits' },
  { names: ['--help', '-h'], because: 'it prints help and exits' },

  // Would leave a session the app cannot see or read.
  { names: ['--no-session-persistence'], because: 'nothing is written to disk, so the session would never appear in the list' },

  // Only meaningful with --print, and they reshape output the TUI has to draw.
  { names: ['--input-format'], because: 'it belongs to --print, which a tab cannot use' },
  { names: ['--output-format'], because: 'it belongs to --print, which a tab cannot use' },
  { names: ['--json-schema'], because: 'it belongs to --print, which a tab cannot use' },
  { names: ['--include-partial-messages'], because: 'it belongs to --print, which a tab cannot use' },
  { names: ['--replay-user-messages'], because: 'it belongs to --print, which a tab cannot use' },
];

export interface ParsedFlags {
  /** The arguments to append to the launch line. Empty when there are none, or when `error` is set. */
  tokens: string[];
  /** A message to show the user, or null when the input is usable. */
  error: string | null;
}

/**
 * Split a command-line-ish string into arguments the way a shell would, minus the parts a shell does that we do not want.
 *
 * Quoting is honoured (a value with a space is one argument), escapes work outside quotes and inside double quotes, and everything else — variables, globs, pipes, substitutions — stays literal text.
 * That last part is the point: `--append-system-prompt "$HOME is home"` passes those characters to claude rather than expanding them here.
 */
function tokenize(input: string): ParsedFlags {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
      continue;
    }
    if (quote === '"') {
      // Inside double quotes a backslash only escapes a quote or another backslash; anywhere else it is literal, which is what a shell does and what someone typing a Windows path expects.
      if (char === '\\' && (input[i + 1] === '"' || input[i + 1] === '\\')) current += input[++i]!;
      else if (char === '"') quote = null;
      else current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      // An empty quoted string is still an argument, so opening a quote starts a token even if nothing follows.
      started = true;
      continue;
    }
    if (char === '\\') {
      if (i + 1 >= input.length) return { tokens: [], error: 'The flags end with a lone backslash.' };
      current += input[++i]!;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
      continue;
    }
    current += char;
    started = true;
  }

  if (quote) return { tokens: [], error: `The flags have an unclosed ${quote === "'" ? 'single' : 'double'} quote.` };
  if (started) tokens.push(current);
  return { tokens, error: null };
}

/** The flag a token names: `--flag=value` is named by what comes before the `=`. */
function flagName(token: string): string {
  return token.split('=', 1)[0]!;
}

/** Whether a token names a flag claude-ui passes itself, and why it is taken. `--flag=value` is checked by its name. */
function reservationFor(token: string): { names: string[]; because: string } | null {
  if (!token.startsWith('-')) return null;
  const name = flagName(token);
  return RESERVED.find((entry) => entry.names.includes(name)) ?? null;
}

/** Exported for the test that keeps this list in step with the flags `claudeArgs` actually emits. */
export function isReservedFlag(token: string): boolean {
  return reservationFor(token) !== null;
}

/**
 * Parse the settings screen's flags field.
 *
 * Returns the arguments to append, or an error to show inline while keeping the dialog open — the field is saved only when it is usable, so a broken value can never reach a session launch.
 */
export function parseLaunchFlags(input: string): ParsedFlags {
  const parsed = tokenize(input);
  if (parsed.error) return parsed;
  // A leading word is not a flag: claude reads it as a subcommand or as a prompt, so a field holding `update` would run `claude update` in every new tab.
  // Only the FIRST token can be judged this way — a bare word after a flag is that flag's value, and there is no table here of which flags take one.
  if (parsed.tokens.length > 0 && !parsed.tokens[0]!.startsWith('-')) {
    return {
      tokens: [],
      error: `Flags have to start with a flag. "${parsed.tokens[0]}" would reach claude as a command or a prompt.`,
    };
  }
  for (const token of parsed.tokens) {
    const reserved = reservationFor(token);
    if (reserved) return { tokens: [], error: `${flagName(token)} can't be set here — ${reserved.because}.` };
  }
  return parsed;
}
