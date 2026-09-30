import { store, withEntry, withMember } from './app';

/** The writes to a session's status and its mark read, which both surfaces make: a status event, a click on a dot, a tab that closes. */

export function setStatus(id: string, status: string | undefined): void {
  const { statuses, acked } = store.get();
  // A new status event is fresh activity: drop any "read" mark so the dot re-lights (and, for a new waiting, re-pulses) even if the user had acked the previous state.
  store.set({ statuses: withEntry(statuses, id, status), acked: withMember(acked, id, false) });
}

// Toggle the "read" mark on a session's dot: mutes a live status (dimmed, no pulse) without closing the tab or replying.
// Only the attention states are ackable — idle (done) and waiting (needs you).
// Busy (working) and closed/hollow have nothing to acknowledge, so acking them is a no-op.
export function toggleAck(id: string): void {
  const { statuses, acked } = store.get();
  const status = statuses.get(id);
  if (status !== 'idle' && status !== 'waiting') return;
  store.set({ acked: withMember(acked, id, !acked.has(id)) });
}

// You've attended to a session by viewing it, so drop its "needs you" nudge.
export function clearNudge(id: string): void {
  window.claudeUi.clearStatus(id);
  setStatus(id, undefined);
}
