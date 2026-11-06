import { clearedNeedsYou, markedNeedsYou } from '../../shared/sessionmarks';
import type { NeedsYou, SettledBy } from '../../shared/types';
import { store } from './app';

/**
 * The writes to the needs-you marks, which several surfaces make: a launch marks, a prompt, a close and Clear needs you take one off, Undo puts one back.
 * Each is made in the store by main's own rule and sent to main, which keeps them in `meta.json`, with each session's history of what settled its reasons, which the window does not keep.
 */

/** Mark sessions as needing you for `reasons`, each from its own time. */
export function markNeedsYou(ids: readonly string[], reasons: readonly NeedsYou[]): void {
  if (ids.length === 0 || reasons.length === 0) return;
  store.set({ needsYou: new Map(Object.entries(markedNeedsYou(Object.fromEntries(store.get().needsYou), ids, reasons))) });
  window.claudeUi.markNeedsYou([...ids], [...reasons]);
}

/** Take a session's mark off, every reason with it, main recording them as settled by `by`; nothing is sent for one that has none. */
export function clearNeedsYou(id: string, by: SettledBy): void {
  if (!store.get().needsYou.has(id)) return;
  store.set({ needsYou: new Map(Object.entries(clearedNeedsYou(Object.fromEntries(store.get().needsYou), id))) });
  window.claudeUi.clearNeedsYou(id, by);
}

/** Put a session's reasons back as they were, from when each was marked, as Undo of a close or a finish does; main takes them back off its history. */
export function restoreNeedsYou(id: string, reasons: readonly NeedsYou[]): void {
  if (reasons.length === 0) return;
  store.set({ needsYou: new Map(Object.entries(markedNeedsYou(Object.fromEntries(store.get().needsYou), [id], reasons))) });
  window.claudeUi.restoreNeedsYou(id, [...reasons]);
}
