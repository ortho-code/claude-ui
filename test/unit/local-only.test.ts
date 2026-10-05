import { describe, expect, it } from 'vitest';
import { linesBreaking, tracked } from './tracked';

/**
 * Nothing committed points at what only one person's machine has: the plans in `.plan/`, `CLAUDE.local.md`, or a personal skill such as `wsl` or `phpstorm`.
 * Such a pointer reads as a dead end to everybody else, and what it points at is not reviewed with the code.
 * `CLAUDE.md` is the exception: it says where local content goes.
 */
const LOCAL_ONLY = /\.plan\b|\b(plan|research|design)_[\w-]+\.(md|html)\b|CLAUDE\.local\.md|\b(wsl|phpstorm)`? skill\b/i;

/** Each line of a file that points at local-only content. */
function pointsLocal(file: string, text: string): string[] {
  return linesBreaking(file, text, (line) => LOCAL_ONLY.test(line));
}

describe('local-only content', () => {
  it('is pointed at by nothing committed', () => {
    // This file holds the names it looks for.
    const committed = tracked(/\.(ts|mjs|js|css|md|yml|yaml|sh|toml|json|html)$/).filter(({ file }) => file !== 'CLAUDE.md' && file !== 'test/unit/local-only.test.ts');
    expect(committed.flatMap(({ file, text }) => pointsLocal(file, text))).toEqual([]);
  });

  it('what counts as pointing at it, and what does not', () => {
    expect(pointsLocal('a.ts', '// Why is in .plan/plan_window-chrome.md.')).toHaveLength(1);
    expect(pointsLocal('a.css', '/* See the wsl skill for the cursor. */')).toHaveLength(1);
    expect(pointsLocal('a.ts', "// Why is in docs/architecture.md § The window's own chrome.")).toEqual([]);
    expect(pointsLocal('a.ts', "// A skill's expanded body is not a request.")).toEqual([]);
  });
});
