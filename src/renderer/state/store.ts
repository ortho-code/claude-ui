/**
 * The window's shared state, and who is told when it changes (docs/architecture.md § The store).
 *
 * State is a set of named slices. A setter replaces slices and tells every watcher of a slice that changed, SYNCHRONOUSLY, so a flow that renders and then measures — reveal a row, then scroll to it — reads the DOM it just changed.
 * `batch` holds the telling to its end, so a read of seven slices from main repaints once.
 * A watcher names the slices it reads and is handed a view typed as only those, so a repaint that reads a slice it did not subscribe to does not compile: "who repaints when this changes?" answered by the build rather than by whoever remembers.
 * Handlers read the whole state through `get`, which is what a click needs; only repaints go through views.
 *
 * A slice's equality decides whether to TELL, never whether to assign: a value equal to the last is still stored, so `get` always has the newest, and watchers are simply not told.
 * A watcher that sets state while being told is not re-entered: what it changed is told after the current round, to everyone who watches it.
 * A watcher is not called when it subscribes; the first paint is the caller's, at the point in start-up where it belongs.
 */

export type Equality<T> = (a: T, b: T) => boolean;

export interface Store<S extends object> {
  /** The whole state as it is now, for handlers. */
  get(): Readonly<S>;
  /** Replace the slices in `patch`, and tell the watchers of those that changed, now or at the end of the batch. */
  set(patch: Partial<S>): void;
  /** Run `fn`, telling watchers once at its end about everything it changed. Batches nest; the outermost one tells. One that throws tells nothing, and what it changed is told with the next change. */
  batch(fn: () => void): void;
  /** Call `fn` whenever one of `slices` changes, with a view of only those slices; answers the unsubscribe. */
  watch<K extends keyof S>(slices: readonly K[], fn: (view: Readonly<Pick<S, K>>) => void): () => void;
}

/** A round of telling that sets state which tells again, this many times over, is a loop between watchers rather than state settling. */
const MAX_ROUNDS = 100;

interface Watcher<S> {
  slices: ReadonlySet<keyof S>;
  fn: (view: Readonly<S>) => void;
}

export function createStore<S extends object>(initial: S, equality: { [K in keyof S]?: Equality<S[K]> } = {}): Store<S> {
  const state = { ...initial };
  let watchers: Watcher<S>[] = [];
  let changed = new Set<keyof S>();
  let depth = 0;
  let telling = false;

  const equal = <K extends keyof S>(key: K, a: S[K], b: S[K]): boolean => (equality[key] ?? Object.is)(a, b);

  /** Tell every watcher of a changed slice, in the order they subscribed, round after round until nothing a watcher set is left untold. */
  function tell(): void {
    if (telling || depth > 0) return;
    telling = true;
    let failure: Error | null = null;
    try {
      for (let round = 0; changed.size > 0; round++) {
        if (round === MAX_ROUNDS) throw new Error(`The store's watchers kept changing ${[...changed].map(String).join(', ')} for ${MAX_ROUNDS} rounds.`);
        const told = changed;
        changed = new Set();
        // A copy, so a watcher that unsubscribes another mid-round does not shift the ones still to come.
        for (const watcher of [...watchers]) {
          if (!watchers.includes(watcher) || ![...told].some((slice) => watcher.slices.has(slice))) continue;
          // One failing repaint is not a reason to leave the others stale: every watcher is told, and the first failure is thrown after.
          try {
            watcher.fn(state);
          } catch (error) {
            failure ??= error instanceof Error ? error : new Error(String(error));
          }
        }
      }
    } finally {
      telling = false;
    }
    if (failure !== null) throw failure;
  }

  return {
    get: () => state,
    set(patch) {
      for (const key of Object.keys(patch) as (keyof S)[]) {
        const next = patch[key] as S[keyof S];
        const was = state[key];
        state[key] = next;
        if (!equal(key, was, next)) changed.add(key);
      }
      tell();
    },
    batch(fn) {
      depth++;
      try {
        fn();
      } finally {
        depth--;
      }
      tell();
    },
    watch(slices, fn) {
      const watcher: Watcher<S> = { slices: new Set(slices), fn };
      watchers.push(watcher);
      return () => {
        watchers = watchers.filter((each) => each !== watcher);
      };
    },
  };
}
