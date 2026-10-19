import { store, withEntry, withMember, type View } from './app';
import { dotStatus } from './views';

/** The writes to a session's status and its mark read, which both surfaces make: a status event, a click on a dot, a tab that closes. */

/** `background` is what still runs behind a finished turn, kept for the status `background` and dropped with any other. */
export function setStatus(id: string, status: string | undefined, background: readonly string[] = []): void {
  const { statuses, backgroundTasks, acked } = store.get();
  // A new status event is fresh activity: drop any "read" mark so the dot re-lights (and, for a new waiting, re-pulses) even if the user had acked the previous state.
  store.set({
    statuses: withEntry(statuses, id, status),
    backgroundTasks: withEntry(backgroundTasks, id, status === 'background' ? background : undefined),
    acked: withMember(acked, id, false),
  });
}

/**
 * Whether a session's "read" mark can be set or cleared now: only in the attention states, idle (done) and waiting (needs you), as its dot shows them.
 * Busy (working) and closed/hollow have nothing to acknowledge, and a paused session reports no claude at all.
 */
export function canMarkRead(id: string, view: View<'statuses' | 'tabs'> = store.get()): boolean {
  const status = dotStatus(id, view);
  return status === 'idle' || status === 'waiting';
}

// Toggle the "read" mark on a session's dot: mutes a live status (dimmed, no pulse) without closing the tab or replying; a no-op where there is nothing to mark (`canMarkRead`).
export function toggleAck(id: string): void {
  if (!canMarkRead(id)) return;
  const { acked } = store.get();
  store.set({ acked: withMember(acked, id, !acked.has(id)) });
}

// You've attended to a session by viewing it, so drop its "needs you" nudge.
export function clearNudge(id: string): void {
  window.claudeUi.clearStatus(id);
  setStatus(id, undefined);
}
