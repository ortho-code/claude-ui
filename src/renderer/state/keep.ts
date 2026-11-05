import { keptFrom, unkept } from '../../shared/sessionmarks';
import { store } from './app';

/**
 * The writes to the keep stamps, which take sessions out of the review (docs/architecture.md § The review): the bar's Keep and its Undo.
 * Each is made in the store by main's own rule and sent to main, which keeps them in `meta.json`, as the later marks are (state/setaside.ts).
 */

/** Keep sessions out of the review from `at`: now, or when it was kept for a stamp Undo puts back. */
export function keepSessions(ids: readonly string[], at = Date.now()): void {
  if (ids.length === 0) return;
  store.set({ kept: new Map(Object.entries(keptFrom(Object.fromEntries(store.get().kept), ids, at))) });
  window.claudeUi.keep([...ids], at);
}

/** Take sessions' keep stamps off; nothing is sent for those that have none. */
export function unkeepSessions(ids: readonly string[]): void {
  const stamped = ids.filter((id) => store.get().kept.has(id));
  if (stamped.length === 0) return;
  store.set({ kept: new Map(Object.entries(unkept(Object.fromEntries(store.get().kept), stamped))) });
  window.claudeUi.unkeep(stamped);
}
