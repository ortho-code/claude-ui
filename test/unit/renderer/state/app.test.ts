import { afterEach, describe, expect, it } from 'vitest';
import type { NeedsYou, SetAside } from '../../../../src/shared/types';
import { store, type AppState } from '../../../../src/renderer/state/app';

const reasons = (at: number): NeedsYou[] => [{ type: 'app.was-running', at, how: 'quit' }];
const mark = (due: number | null): SetAside => ({ due, at: 1_000 });

/** For each slice, a value as a read from main builds it, the same again as new objects, and one that differs. */
const cases = [
  { slice: 'needsYou', value: () => new Map([['s1', reasons(5)]]), other: () => new Map([['s1', reasons(6)]]) },
  { slice: 'setAside', value: () => new Map([['s1', mark(null)]]), other: () => new Map([['s1', mark(9_000)]]) },
  { slice: 'acked', value: () => new Set(['s1']), other: () => new Set(['s2']) },
] as const satisfies readonly { slice: keyof AppState; value: () => unknown; other: () => unknown }[];

let unsubscribe: () => void = () => undefined;
afterEach(() => unsubscribe());

/** How many times a watcher of `slice` is told while `act` runs. */
function toldDuring(slice: keyof AppState, act: () => void): number {
  let told = 0;
  unsubscribe = store.watch([slice], () => told++);
  act();
  unsubscribe();
  return told;
}

describe("the app's store tells a slice read afresh from main only when its contents changed", () => {
  for (const { slice, value, other } of cases) {
    it(`${slice}: the same contents as new objects tell nobody`, () => {
      store.set({ [slice]: value() });
      expect(toldDuring(slice, () => store.set({ [slice]: value() }))).toBe(0);
    });

    it(`${slice}: other contents tell its watchers`, () => {
      store.set({ [slice]: value() });
      expect(toldDuring(slice, () => store.set({ [slice]: other() }))).toBe(1);
    });
  }
});
