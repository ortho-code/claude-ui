import { describe, expect, it } from 'vitest';
import { linesBreaking, tracked } from './tracked';

/**
 * `README.md`, `UPGRADING.md`, `CHANGELOG.md` and `docs/` are for people, and never name the Claude config: `CLAUDE.md`, the local one beside it, or the repo's `.claude/` (`CLAUDE.md` § Conventions).
 * The session store, `~/.claude`, is the app's subject and named freely.
 */
const CLAUDE_CONFIG = /CLAUDE(\.local)?\.md|(?<![~\w/.])\.claude\b/;

/** Each line of a file that names the Claude config. */
function namesConfig(file: string, text: string): string[] {
  return linesBreaking(file, text, (line) => CLAUDE_CONFIG.test(line));
}

describe('the Claude config', () => {
  it('is named in no document written for people', () => {
    const forPeople = tracked(/^(README\.md|UPGRADING\.md|CHANGELOG\.md|docs\/.*)$/);
    expect(forPeople.flatMap(({ file, text }) => namesConfig(file, text))).toEqual([]);
  });

  it('what counts as naming it, and what does not', () => {
    expect(namesConfig('a.md', 'See CLAUDE.md for the rules.')).toHaveLength(1);
    expect(namesConfig('a.md', 'The skills live in `.claude/skills`.')).toHaveLength(1);
    expect(namesConfig('a.md', 'Sessions are read from `~/.claude/projects`.')).toEqual([]);
  });
});
