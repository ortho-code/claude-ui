import { typeIsOn } from '../../shared/status/needs-you';
import { cameDue, clearedSetAside, markedSetAside } from '../../shared/status/session-marks';
import { store, withMember } from './app';

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

/** Take sessions' set-aside marks off, in one write; nothing is sent for those that have none; `by` says a prompt there did, rather than you. */
export function clearSetAside(ids: readonly string[], by?: 'prompt'): void {
  const marked = ids.filter((id) => store.get().setAside.has(id));
  if (marked.length === 0) return;
  let setAside = Object.fromEntries(store.get().setAside);
  for (const id of marked) setAside = clearedSetAside(setAside, id);
  store.set({ setAside: new Map(Object.entries(setAside)) });
  if (by === undefined) window.claudeUi.clearSetAside(marked);
  else window.claudeUi.clearSetAside(marked, by);
}

/**
 * Settle the set-aside marks that have come due (`cameDue`); nothing is sent while none has.
 * A day coming is news, whether it brings the reminder or lights up the reasons the mark muted, so it takes each session's read mark off, as a new needs-you reason does (`markNeedsYou`, decided 2026-11-11).
 */
function settleDueSetAside(now = Date.now()): void {
  const { setAside, needsYou, acked } = store.get();
  const due = [...setAside].filter(([, mark]) => mark.due !== null && mark.due <= now).map(([id]) => id);
  if (due.length === 0) return;
  const remind = typeIsOn(store.get().needsYouTypes, 'app.reminder');
  const next = cameDue({ setAside: Object.fromEntries(setAside), needsYou: Object.fromEntries(needsYou) }, now, remind);
  store.set({
    setAside: new Map(Object.entries(next.setAside)),
    needsYou: new Map(Object.entries(next.needsYou)),
    acked: due.reduce((set, id) => withMember(set, id, false), acked),
  });
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
