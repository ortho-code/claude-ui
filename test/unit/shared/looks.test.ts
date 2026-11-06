import { describe, it, expect } from 'vitest';
import { DEFAULT_STRENGTH, expandedStrength, strengthProblem } from '../../../src/shared/looks';
import { withOverrides } from '../../../src/shared/needsyou';
import { bundledNeedsYou } from '../../renderer/support/needsyou';

const registry = bundledNeedsYou();
const ordered = (...middle: string[]): string[] => ['waiting', 'busy', 'background', ...middle, 'idle', 'closed'];

describe('expandedStrength', () => {
  it("puts the app's categories at needs-you in Now's order, Your turn left out, and keeps needs-you after them", () => {
    expect(expandedStrength(DEFAULT_STRENGTH, registry)).toEqual(ordered('back-to-work', 'ready-to-merge', 'look-again', 'reminders', 'finish-up', 'needs-you'));
  });

  it('leaves a category named on its own where it is named', () => {
    expect(expandedStrength(['waiting', 'back-to-work', 'busy', 'background', 'needs-you', 'idle', 'closed'], registry)).toEqual([
      'waiting',
      'back-to-work',
      'busy',
      'background',
      'ready-to-merge',
      'look-again',
      'reminders',
      'finish-up',
      'needs-you',
      'idle',
      'closed',
    ]);
  });

  it('takes a category added later, or moved in Now, at needs-you, so a list written before it still places it', () => {
    const moved = withOverrides(registry, [{ name: 'finish-up.json', json: { id: 'finish-up', order: 15 } }]).registry;
    expect(expandedStrength(DEFAULT_STRENGTH, moved)).toEqual(ordered('finish-up', 'back-to-work', 'ready-to-merge', 'look-again', 'reminders', 'needs-you'));
  });
});

describe('strengthProblem', () => {
  it('takes the default, and any category named once', () => {
    expect(strengthProblem(DEFAULT_STRENGTH, registry)).toBeNull();
    expect(strengthProblem(['finish-up', ...DEFAULT_STRENGTH], registry)).toBeNull();
  });

  it('names what is wrong: no list, a name twice, a status or needs-you missing, Your turn, a category nobody has', () => {
    expect(strengthProblem('waiting', registry)).toMatch(/has to be a list of names/);
    expect(strengthProblem([...DEFAULT_STRENGTH, 'busy'], registry)).toBe('"busy" is named more than once.');
    expect(strengthProblem(['waiting', 'busy', 'needs-you', 'idle'], registry)).toBe('It has to name "background", "closed" too: every status and "needs-you" once.');
    expect(strengthProblem(['your-turn', ...DEFAULT_STRENGTH], registry)).toBe('"your-turn" has no place of its own: its types are "waiting" and "idle".');
    expect(strengthProblem(['merged', ...DEFAULT_STRENGTH], registry)).toBe('"merged" is neither a status, "needs-you" nor a needs-you category.');
  });

  it('passes any other name without a registry, as for a save, and a category switched off with one', () => {
    expect(strengthProblem(['merged', ...DEFAULT_STRENGTH], null)).toBeNull();
    const off = withOverrides(registry, [{ name: 'finish-up.json', json: { id: 'finish-up', enabled: false } }]).registry;
    expect(strengthProblem(['finish-up', ...DEFAULT_STRENGTH], off)).toBeNull();
  });
});
