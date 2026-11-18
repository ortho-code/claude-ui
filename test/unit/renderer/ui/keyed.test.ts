import { describe, expect, it } from 'vitest';
import { Keyed, longestInOrder } from '../../../../src/renderer/ui/keyed';

/** A thing kept by key, counting how often it was taken off the page and forgotten. */
interface Thing {
  key: string;
  removed: number;
  forgotten: boolean;
}

function things(): Keyed<Thing> {
  return new Keyed<Thing>(
    (thing) => ({ remove: () => thing.removed++ }) as unknown as Element,
    (thing) => (thing.forgotten = true),
  );
}
const build = (key: string): Thing => ({ key, removed: 0, forgotten: false });

describe('Keyed', () => {
  it('draws a key as the same thing on every render that draws it', () => {
    const kept = things();
    const first = kept.draw('a', build);
    kept.sweep();
    expect(kept.draw('a', build)).toBe(first);
    expect(first.removed).toBe(0);
  });

  it('forgets what a render leaves out, so drawing it again builds it anew', () => {
    const kept = things();
    const first = kept.draw('a', build);
    kept.sweep();
    kept.sweep();
    expect(first).toEqual({ key: 'a', removed: 1, forgotten: true });
    expect(kept.draw('a', build)).not.toBe(first);
  });

  it('keeps off the page what a render leaves out and `keep` says yes to, unfound until it is drawn again as the same', () => {
    const kept = things();
    const first = kept.draw('a', build);
    kept.sweep(() => true);
    kept.sweep(() => true);
    expect(first).toEqual({ key: 'a', removed: 1, forgotten: false });
    expect(kept.find('a')).toBeUndefined();
    expect([...kept.values()]).toEqual([]);
    expect(kept.draw('a', build)).toBe(first);
    expect(kept.find('a')).toBe(first);
  });

  it('forgets a thing kept off the page once `keep` no longer says yes to it', () => {
    const kept = things();
    const first = kept.draw('a', build);
    // The first sweep follows the render that drew it, the second takes it off the page.
    kept.sweep(() => true);
    kept.sweep(() => true);
    expect(first.forgotten).toBe(false);
    kept.sweep(() => false);
    expect(first.forgotten).toBe(true);
    expect(kept.draw('a', build)).not.toBe(first);
  });
});

/** The length of a longest rising run, the slow way, to hold the fast one to. */
function longestLength(sequence: readonly number[]): number {
  const ending = sequence.map(() => 1);
  for (let i = 0; i < sequence.length; i++) {
    for (let j = 0; j < i; j++) if (sequence[j] < sequence[i]) ending[i] = Math.max(ending[i], ending[j] + 1);
  }
  return Math.max(0, ...ending);
}

/** Whether `run`'s values rise in the order `sequence` has them. */
function rises(sequence: readonly number[], run: Set<number>): boolean {
  const kept = sequence.filter((value) => run.has(value));
  return kept.length === run.size && kept.every((value, i) => i === 0 || kept[i - 1] < value);
}

// The children already in order stay where they are, so this is what decides how few a render moves (placeChildren).
describe('longestInOrder', () => {
  it('keeps everything that is in order already, and nothing of nothing', () => {
    expect(longestInOrder([])).toEqual(new Set());
    expect(longestInOrder([0, 1, 2, 3])).toEqual(new Set([0, 1, 2, 3]));
  });

  it('leaves out only the one that moved, wherever it moved to', () => {
    // The last to the front, the first to the end, one from the middle to the end.
    expect(longestInOrder([3, 0, 1, 2])).toEqual(new Set([0, 1, 2]));
    expect(longestInOrder([1, 2, 3, 0])).toEqual(new Set([1, 2, 3]));
    expect(longestInOrder([0, 2, 3, 1])).toEqual(new Set([0, 2, 3]));
  });

  it('finds a longest rising run in any order', () => {
    let seed = 7;
    const random = (): number => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let round = 0; round < 500; round++) {
      const sequence = Array.from({ length: Math.floor(random() * 12) }, (_, i) => i);
      for (let i = sequence.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [sequence[i], sequence[j]] = [sequence[j], sequence[i]];
      }
      const run = longestInOrder(sequence);
      expect(rises(sequence, run)).toBe(true);
      expect(run.size).toBe(longestLength(sequence));
    }
  });
});
