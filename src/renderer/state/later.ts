import { cameDue, clearedLater, markedLater } from '../../shared/sessionmarks';
import { store } from './app';

/**
 * The writes to the later marks: the session's menu marks and clears one, a prompt there takes it off, and its day coming turns it into needing you.
 * Each is made in the store by main's own rule and sent to main, which keeps them in `meta.json`.
 */

/** The longest the window waits between looks for a later mark come due: a timer set for the soonest is held to this, so one a sleeping machine slept through is found within the hour of waking. */
const LOOK_AT_LEAST_EVERY_MS = 60 * 60 * 1000;

/** Mark a session for later, `due` the moment it comes back, or null for whenever, from `at`: now, or when it was marked for a mark Undo puts back. */
export function markLater(id: string, due: number | null, at = Date.now()): void {
  store.set({ later: new Map(Object.entries(markedLater(Object.fromEntries(store.get().later), id, due, at))) });
  window.claudeUi.markLater([id], due, at);
}

/** Take a session's later mark off; nothing is sent for one that has none. */
export function clearLater(id: string): void {
  if (!store.get().later.has(id)) return;
  store.set({ later: new Map(Object.entries(clearedLater(Object.fromEntries(store.get().later), id))) });
  window.claudeUi.clearLater([id]);
}

/** Settle the later marks that have come due (`cameDue`); nothing is sent while none has. */
export function settleDueLater(now = Date.now()): void {
  const { later, needsYou } = store.get();
  if (![...later.values()].some((mark) => mark.due !== null && mark.due <= now)) return;
  const next = cameDue({ later: Object.fromEntries(later), needsYou: Object.fromEntries(needsYou) }, now);
  store.set({ later: new Map(Object.entries(next.later)), needsYou: new Map(Object.entries(next.needsYou)) });
  window.claudeUi.laterCameDue(now);
}

let lookTimer: ReturnType<typeof setTimeout> | null = null;

/** Settle what has come due, and set the next look for the soonest mark still to come, an hour from now at the latest. */
function lookForDue(): void {
  settleDueLater();
  if (lookTimer !== null) clearTimeout(lookTimer);
  const now = Date.now();
  const soonest = Math.min(...[...store.get().later.values()].flatMap((mark) => (mark.due !== null ? [mark.due] : [])), now + LOOK_AT_LEAST_EVERY_MS);
  lookTimer = setTimeout(lookForDue, Math.max(0, Math.min(soonest - now, LOOK_AT_LEAST_EVERY_MS)));
}

/** Look for later marks come due now, then again when the soonest one is due and whenever the marks change, for as long as the window is open. */
export function watchDueLater(): void {
  lookForDue();
  store.watch(['later'], lookForDue);
}
