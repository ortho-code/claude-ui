import { firesFor, typeIsOn } from '../../shared/status/needs-you';
import { clearedNeedsYou, markedNeedsYou, settledTypes } from '../../shared/status/session-marks';
import type { NeedsYou, PrNeedsYouType, PrRole, SettledBy } from '../../shared/types';
import { store, withMember, type View } from './app';

/**
 * The writes to the needs-you marks, which several surfaces make: a launch marks, a prompt, a close and Clear needs you take one off, Undo puts one back.
 * Each is made in the store by main's own rule and sent to main, which keeps them in `meta.json`, with each session's history of what settled its reasons, which the window does not keep.
 */

/**
 * Mark sessions as needing you for `reasons`, each from its own time.
 * A new reason is news, one that replaces an older reason of its kind included, so it takes each session's read mark off, as a new status from claude does (`setStatus`): news is never born read (decided 2026-11-11).
 */
export function markNeedsYou(ids: readonly string[], reasons: readonly NeedsYou[]): void {
  if (ids.length === 0 || reasons.length === 0) return;
  const { needsYou, acked } = store.get();
  store.set({
    needsYou: new Map(Object.entries(markedNeedsYou(Object.fromEntries(needsYou), ids, reasons))),
    acked: ids.reduce((set, id) => withMember(set, id, false), acked),
  });
  window.claudeUi.markNeedsYou([...ids], [...reasons]);
}

/** Take a session's mark off, every reason with it, main recording them as settled by `by`; nothing is sent for one that has none. */
export function clearNeedsYou(id: string, by: SettledBy): void {
  if (!store.get().needsYou.has(id)) return;
  store.set({ needsYou: new Map(Object.entries(clearedNeedsYou(Object.fromEntries(store.get().needsYou), id))) });
  window.claudeUi.clearNeedsYou(id, by);
}

/**
 * Take every reason of a type that is switched off, itself or by its category, off every session, main recording each as settled `off` (decided 2026-11-06): switching a type off retires the marks it made rather than hiding them.
 * Watched on the marks and the types (`watchSwitchedOff`), so it holds for a switch made while the app runs, and for marks read at launch.
 */
function settleSwitchedOff({ needsYou, needsYouTypes }: View<'needsYou' | 'needsYouTypes'>): void {
  const off = [...new Set([...needsYou.values()].flat().map((reason) => reason.type))].filter((type) => !typeIsOn(needsYouTypes, type));
  if (off.length === 0) return;
  store.set({ needsYou: new Map(Object.entries(settledTypes({ needsYou: Object.fromEntries([...needsYou].map(([id, reasons]) => [id, [...reasons]])), needsYouHistory: {} }, off, Date.now()).needsYou)) });
  window.claudeUi.settleNeedsYouTypes(off);
}

/** Start settling the reasons of a type switched off, whenever the marks or the types change. */
export function watchSwitchedOff(): void {
  store.watch(['needsYou', 'needsYouTypes'], settleSwitchedOff);
}

/** Whether a type marks a session now, by the types as main last said them (`typeIsOn`). */
export function marks(type: NeedsYou['type']): boolean {
  return typeIsOn(store.get().needsYouTypes, type);
}

/** Whether a PR's type marks a session now for a PR you have `role` on: on (`marks`), and listing that role (`firesFor`). */
export function marksFor(type: PrNeedsYouType, role: PrRole | null): boolean {
  return marks(type) && firesFor(store.get().needsYouTypes, type, role);
}

/** Put a session's reasons back as they were, from when each was marked, as Undo of a close or a finish does; main takes them back off its history. */
export function restoreNeedsYou(id: string, reasons: readonly NeedsYou[]): void {
  if (reasons.length === 0) return;
  store.set({ needsYou: new Map(Object.entries(markedNeedsYou(Object.fromEntries(store.get().needsYou), [id], reasons))) });
  window.claudeUi.restoreNeedsYou(id, [...reasons]);
}
