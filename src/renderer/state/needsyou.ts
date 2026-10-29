import { clearedNeedsYou, markedNeedsYou } from '../../shared/sessionmarks';
import type { NeedsYouReason } from '../../shared/types';
import { store } from './app';

/**
 * The writes to the needs-you marks, which several surfaces make: a launch marks, a prompt, a close and Clear needs you take one off.
 * Each is made in the store by main's own rule and sent to main, which keeps them in `meta.json`.
 */

/** Mark sessions as needing you, for `reason`, from `at`: now, or when it was marked for a mark Undo puts back. */
export function markNeedsYou(ids: readonly string[], reason: NeedsYouReason, at = Date.now()): void {
  if (ids.length === 0) return;
  store.set({ needsYou: new Map(Object.entries(markedNeedsYou(Object.fromEntries(store.get().needsYou), ids, reason, at))) });
  window.claudeUi.markNeedsYou([...ids], reason, at);
}

/** Take a session's mark off; nothing is sent for one that has none. */
export function clearNeedsYou(id: string): void {
  if (!store.get().needsYou.has(id)) return;
  store.set({ needsYou: new Map(Object.entries(clearedNeedsYou(Object.fromEntries(store.get().needsYou), id))) });
  window.claudeUi.clearNeedsYou(id);
}
