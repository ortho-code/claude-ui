import { typeIsOn } from '../../shared/needsyou';
import { cameDue, clearedSetAside, markedSetAside } from '../../shared/sessionmarks';
import { store } from './app';

/**
 * The writes to the set-aside marks: the session's menu sets and clears one, the bar of selecting several sets them and its Undo clears them, a finish clears them and its Undo puts them back, a prompt there takes one off, and its day coming turns it into needing you.
 * Each is made in the store by main's own rule and sent to main, which keeps them in `meta.json`.
 */

/** The longest the window waits between looks for a set-aside mark come due: a timer set for the soonest is held to this, so one a sleeping machine slept through is found within the hour of waking. */
const LOOK_AT_LEAST_EVERY_MS = 60 * 60 * 1000;

/** Set sessions aside, in one write, `due` the moment they come back, or null for whenever, from `at`: now, or when it was marked for a mark Undo puts back. */
export function markSetAside(ids: readonly string[], due: number | null, at = Date.now()): void {
  if (ids.length === 0) return;
  let setAside = Object.fromEntries(store.get().setAside);
  for (const id of ids) setAside = markedSetAside(setAside, id, due, at);
  store.set({ setAside: new Map(Object.entries(setAside)) });
  window.claudeUi.markSetAside([...ids], due, at);
}

/** Take sessions' set-aside marks off, in one write; nothing is sent for those that have none. */
export function clearSetAside(ids: readonly string[]): void {
  const marked = ids.filter((id) => store.get().setAside.has(id));
  if (marked.length === 0) return;
  let setAside = Object.fromEntries(store.get().setAside);
  for (const id of marked) setAside = clearedSetAside(setAside, id);
  store.set({ setAside: new Map(Object.entries(setAside)) });
  window.claudeUi.clearSetAside(marked);
}

/** Settle the set-aside marks that have come due (`cameDue`); nothing is sent while none has. */
export function settleDueSetAside(now = Date.now()): void {
  const { setAside, needsYou } = store.get();
  if (![...setAside.values()].some((mark) => mark.due !== null && mark.due <= now)) return;
  const remind = typeIsOn(store.get().needsYouTypes, 'app.reminder');
  const next = cameDue({ setAside: Object.fromEntries(setAside), needsYou: Object.fromEntries(needsYou) }, now, remind);
  store.set({ setAside: new Map(Object.entries(next.setAside)), needsYou: new Map(Object.entries(next.needsYou)) });
  window.claudeUi.setAsideCameDue(now, remind);
}

let lookTimer: ReturnType<typeof setTimeout> | null = null;

/** Settle what has come due, and set the next look for the soonest mark still to come, an hour from now at the latest. */
function lookForDue(): void {
  settleDueSetAside();
  if (lookTimer !== null) clearTimeout(lookTimer);
  const now = Date.now();
  const soonest = Math.min(...[...store.get().setAside.values()].flatMap((mark) => (mark.due !== null ? [mark.due] : [])), now + LOOK_AT_LEAST_EVERY_MS);
  lookTimer = setTimeout(lookForDue, Math.max(0, Math.min(soonest - now, LOOK_AT_LEAST_EVERY_MS)));
}

/** Look for set-aside marks come due now, then again when the soonest one is due and whenever the marks change, for as long as the window is open. */
export function watchDueSetAside(): void {
  lookForDue();
  store.watch(['setAside'], lookForDue);
}
