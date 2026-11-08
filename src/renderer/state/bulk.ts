import { tickedRun } from '../ticks';
import { store } from './app';

/**
 * The writes to the session list's bulk mode (docs/architecture/session-list.md § Selecting several): entering it with rows ticked, ticking, and leaving it.
 * Which rows are drawn is the list's; a caller hands their keys in the order drawn where a write needs them.
 */

/** Enter bulk mode with `keys` ticked, the last of them the row a Shift+press ticks from. */
export function startBulk(keys: readonly string[]): void {
  store.set({ bulk: { ticked: new Set(keys), anchor: keys.at(-1) ?? null } });
}

/** Leave bulk mode, and the review with it; nothing stays ticked. */
export function endBulk(): void {
  store.set({ bulk: null, reviewing: false });
}

/** Open the review (docs/architecture/session-list.md § The review): the list shows its sets, in bulk mode, nothing ticked. */
export function startReview(): void {
  store.set({ reviewing: true, bulk: { ticked: new Set(), anchor: null } });
}

/** A press on a row: tick it or untick it, and make it the row a Shift+press ticks from. */
export function toggleTick(key: string): void {
  const { bulk } = store.get();
  if (!bulk) return;
  const ticked = new Set(bulk.ticked);
  if (ticked.has(key)) ticked.delete(key);
  else ticked.add(key);
  store.set({ bulk: { ticked, anchor: key } });
}

/** A Shift+press on a row: tick the run from the row last pressed to it (`tickedRun`), in `order`, the rows as drawn. */
export function tickRun(order: readonly string[], key: string): void {
  const { bulk } = store.get();
  if (!bulk) return;
  store.set({ bulk: { ticked: new Set([...bulk.ticked, ...tickedRun(order, bulk.anchor, key)]), anchor: key } });
}

/** A heading's box: tick every one of `keys`, the rows under it, or untick them all. */
export function tickAll(keys: readonly string[], on: boolean): void {
  const { bulk } = store.get();
  if (!bulk) return;
  const ticked = new Set(bulk.ticked);
  for (const key of keys) {
    if (on) ticked.add(key);
    else ticked.delete(key);
  }
  store.set({ bulk: { ticked, anchor: bulk.anchor } });
}
