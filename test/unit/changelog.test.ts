import { describe, expect, it } from 'vitest';
import { linesBreaking, tracked } from './tracked';

/**
 * `CHANGELOG.md` follows Keep a Changelog: a version's entries go under `### Added`, `### Changed` or `### Fixed`, never a commit category such as `chore` or `refactor`, which has no audience there (`CLAUDE.md` § Conventions).
 * A version's section is published as its release notes, so a heading of another name reaches the people installing it.
 */
const SECTIONS = new Set(['Added', 'Changed', 'Fixed']);

/** Each heading below a version's that is not one of the three. */
function strayHeadings(file: string, text: string): string[] {
  return linesBreaking(file, text, (line) => /^#{3,}\s/.test(line) && !SECTIONS.has(line.replace(/^#{3,}\s+/, '').trim()));
}

describe('the changelog', () => {
  it('sorts every entry under Added, Changed or Fixed', () => {
    expect(tracked(/^CHANGELOG\.md$/).flatMap(({ file, text }) => strayHeadings(file, text))).toEqual([]);
  });

  it('what counts as a stray heading, and what does not', () => {
    expect(strayHeadings('CHANGELOG.md', '## 1.0.0\n\n### Refactor\n\n- Moved a file.\n')).toEqual(['CHANGELOG.md:3: ### Refactor']);
    expect(strayHeadings('CHANGELOG.md', '## Unreleased\n\n### Added\n\n- A thing.\n\n### Fixed\n\n- A bug.\n')).toEqual([]);
  });
});
