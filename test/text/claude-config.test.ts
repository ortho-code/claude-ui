import { describe, expect, it } from 'vitest';
import { linesBreaking, tracked } from './tracked';

/**
 * `README.md`, `CONTRIBUTING.md`, `UPGRADING.md`, `CHANGELOG.md` and `docs/` are for people, and never name the Claude config: `CLAUDE.md`, the local one beside it, or the repo's `.claude/` (`CLAUDE.md` § Conventions).
 * The session store, `~/.claude`, is the app's subject and named freely.
 */
const CLAUDE_CONFIG = /CLAUDE(\.local)?\.md|(?<![~\w/.])\.claude\b/;

/** Each line of a file that names the Claude config. */
function namesConfig(file: string, text: string): string[] {
  return linesBreaking(file, text, (line) => CLAUDE_CONFIG.test(line));
}

/**
 * A decision a doc or a comment records says when and why, never who asked for it: "(user, 2026-10-20)" is a note from a session with Claude, and reads to anyone else as any user of the app.
 * The Claude config is where such a session's own notes belong, so it is left out.
 */
const ASKED_BY = /\(user[,:)]/;

/** Each line of a file that credits a decision to who asked for it. */
function creditsAsker(file: string, text: string): string[] {
  return linesBreaking(file, text, (line) => ASKED_BY.test(line));
}

describe('the Claude config', () => {
  it('is named in no document written for people', () => {
    const forPeople = tracked(/^(README\.md|CONTRIBUTING\.md|UPGRADING\.md|CHANGELOG\.md|docs\/.*)$/);
    expect(forPeople.flatMap(({ file, text }) => namesConfig(file, text))).toEqual([]);
  });

  it('what counts as naming it, and what does not', () => {
    expect(namesConfig('a.md', 'See CLAUDE.md for the rules.')).toHaveLength(1);
    expect(namesConfig('a.md', 'The skills live in `.claude/skills`.')).toHaveLength(1);
    expect(namesConfig('a.md', 'Sessions are read from `~/.claude/projects`.')).toEqual([]);
  });
});

describe('a decision', () => {
  it('is credited to who asked for it in no doc or comment', () => {
    // This file holds the pattern it looks for.
    const committed = tracked(/\.(ts|mjs|js|css|md|yml|yaml|sh|toml|json|html)$/).filter(({ file }) => file !== 'CLAUDE.md' && !file.startsWith('.claude/') && file !== 'test/text/claude-config.test.ts');
    expect(committed.flatMap(({ file, text }) => creditsAsker(file, text))).toEqual([]);
  });

  it('what counts as crediting the asker, and what does not', () => {
    expect(creditsAsker('a.md', 'It was called Unpause (user, 2026-10-20).')).toHaveLength(1);
    expect(creditsAsker('a.ts', '// A heading\'s options (user, 2026-10-20).')).toHaveLength(1);
    expect(creditsAsker('a.md', 'It was called Unpause (decided 2026-10-20).')).toEqual([]);
    expect(creditsAsker('a.md', "Ending it is still the user's.")).toEqual([]);
  });
});
