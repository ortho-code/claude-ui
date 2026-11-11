import { sessionLabel } from '../../../rules/sessions';
import { store, type TabState } from '../../../state/app';
import { clearNudge } from '../../../state/statuses';
import { showToast } from '../../../ui/toast';
import { persistOpenTabs } from './open-tabs';
import { clearStopTimers, isOnShow, keptWhenGone, setTab, stopTimers, tabOf, terminalOf } from './tab-state';

/**
 * Asking a tab's claude to leave, forcing one that does not, calling a leave off, and the cold tab one leaves behind.
 * What a close or a finish does once claude has gone is closing.ts's.
 */

/**
 * How long a stop waits before its control becomes a force.
 * Past the moment claude takes to put a question on screen — about 0.5 s from its prompt and 0.9 s mid-turn, measured — so a double-click cannot force a session before what it is asking is even there.
 */
const FORCE_AFTER_MS = 1000;

/**
 * How long a stop goes before it says, where it shows without a hover, that claude has not left (`notLeftWords`, and a toast).
 * Past most exits, so an ordinary one says nothing: of the 49 exits after an ask the app's logs held to 2026-10-23, half had gone by 1.43 s, 95 % by 2.98 s, and the slowest took 6.6 s.
 */
const NOT_LEFT_AFTER_MS = 3000;

/**
 * Ask a live tab's claude to leave, and wait for the exit, however long it takes: `onExit` says whether the tab goes with it or stays cold.
 * Claude can answer an exit with a question — a worktree with changes asks whether to keep it — and the tab has to outlive it for it to be answered, so nothing here ends the session itself.
 * Mid-turn, as the hooks last reported it, claude needs a third Ctrl-C, since the first then only interrupts the turn; any other session gets two, because a third at its prompt would arm claude's own "press again to exit" under its question.
 * Waiting counts as mid-turn, though claude also reports it for a session ready at its prompt, which then gets the third press as well.
 * So does a session with a task scheduled, as its clock in its own colour shows (a muted one, kept from before its claude started, adds none): a `/loop` wakeup takes the first press to cancel itself, and the same press interrupts a turn, so it is one more either way, never two; a cron makes claude ask what to do with it, where the third only arms "press again to exit" for a moment and the question stays (both measured on claude 2.1.302).
 * The list is the last Stop's, so it can still name a wakeup cancelled since by an Esc at claude's prompt; the third press then lands on whatever claude asks on its way out, where one press only arms "press again" too (measured at the worktree question).
 * Nothing asks first: claude asks its own question for a cron, and a second one before it was too much (decided 2026-10-24); the clock's tooltip says what becomes of each task (`afterStop`).
 */
export function askToLeave(token: string, terminalId: number, onExit: TabState['onExit']): void {
  const tab = tabOf(token);
  if (!tab) return;
  // At once, so the button shows the leave under way for as long as the exit takes rather than after it.
  setTab(token, { stopping: true, onExit, forceable: false, notLeft: false });
  const { statuses, scheduledTasks } = store.get();
  const status = statuses.get(tab.session.id);
  window.claudeUi.closeTerminal(terminalId, status === 'busy' || status === 'waiting' || scheduledTasks.has(tab.session.id));
  clearStopTimers(token);
  // Each step only for the ask it was set for, still under way.
  const step = (patch: Partial<TabState>, after: number): ReturnType<typeof setTimeout> =>
    setTimeout(() => {
      const now = tabOf(token);
      if (now?.stopping && now.terminalId === terminalId) setTab(token, patch);
    }, after);
  stopTimers.set(token, [step({ forceable: true }, FORCE_AFTER_MS), step({ notLeft: true }, NOT_LEFT_AFTER_MS)]);
}

/**
 * End a session that was asked to leave and has not: the stop control's second act, once it has become a force.
 * Its process group gets `SIGTERM`, and `SIGKILL` after the grace, so whatever claude was asking goes unanswered — for a worktree, the tree is kept.
 * The control goes back to unavailable until the exit lands, which the escalation in main makes sure of.
 */
export function forceStop(token: string): void {
  const tab = tabOf(token);
  if (!tab?.forceable || tab.terminalId === null) return;
  // Nothing is asked any more, so nothing is said of it either.
  clearStopTimers(token);
  setTab(token, { forceable: false, forced: true, notLeft: false });
  window.claudeUi.killTerminal(tab.terminalId);
}

/**
 * End a tab's claude without asking it, keeping the tab, cold: for a claude that must not go on, which an ask it ignores would leave running.
 * The tab says it is stopping until the exit lands, as any stop does, and the exit cools it.
 */
export function forceOutAtOnce(token: string): void {
  if (tabOf(token)?.terminalId == null) return;
  clearStopTimers(token);
  // A stop already past its ask, so the force is the one every stop ends in.
  setTab(token, { stopping: true, onExit: 'cool', forceable: true, notLeft: false });
  forceStop(token);
}

/**
 * End the session but keep its tab, cold and resumable.
 * The opposite of closeTab, and the deliberate counterpart to claude exiting on its own — which still CLOSES the tab, so a finished session does not leave an empty one behind.
 * `stopping` is what tells those two apart when the exit arrives.
 * A claude already leaving, for a close or a finish, is asked nothing more: its exit keeps the tab instead (decided 2026-10-28), as a close changes a stop.
 */
export function stopSession(token: string): void {
  const tab = tabOf(token);
  if (!tab) return;
  if (tab.terminalId === null || tab.starting) return;
  if (tab.stopping) {
    setTab(token, { onExit: 'cool' });
    return;
  }
  askToLeave(token, tab.terminalId, 'cool');
}

/**
 * A session asked to leave that went on working: a prompt it submitted, or a `/resume` or `/clear` that moved its tab to another session (`adoptReplacement`), so the stop is off and the tab is live again.
 * Claude's exit can be called off — Esc at a worktree's keep-or-remove question takes it back to its prompt — and only what is done next says so; until then the tab goes on saying it is stopping.
 * Whatever the leave was, a stop, a close or a finish, it goes (decided 2026-10-28: a leave left unfinished for something else is one called off).
 * Not once its claude has been forced out (`forced`): that claude is being ended whatever it reports.
 * Answers the tab as it was when its leave was called off, or null when there was none to call off.
 */
export function stopCalledOff(token: string): TabState | null {
  const tab = tabOf(token);
  if (!tab?.stopping || tab.forced) return null;
  clearStopTimers(token);
  setTab(token, { stopping: false, onExit: 'cool', forceable: false, notLeft: false });
  calledOff(token);
  return tab;
}

/** What else a leave called off undoes, set once as the terminal area is wired: what a close, a finish or a set aside noted for that leave's exit (closing.ts). */
let calledOff: (token: string) => void = () => {};

/** Set what else a leave called off undoes. */
export function whenCalledOff(handler: (token: string) => void): void {
  calledOff = handler;
}

/**
 * A prompt a tab's claude submitted: it went on working, so a leave under way is off (`stopCalledOff`).
 * A finish called off by one says so, since a prompt sent just before the press can report after it, and claude then leaves on the presses with the session unfinished (decided 2026-10-28).
 * Only a prompt: a `/resume` or `/clear` that calls a finish off is one you typed, and one into a session another tab runs already says that it runs there.
 */
export function promptSubmitted(token: string): void {
  const calledOff = stopCalledOff(token);
  if (calledOff?.onExit === 'finish') showToast(`Finishing "${sessionLabel(calledOff.session)}" was called off`);
}

/** Turn a tab that has just lost its process into a cold one. */
export function coolTab(token: string): void {
  const terminal = terminalOf(token);
  // Wipe the dead session's output: left in place it reads as a live terminal, and a resume would paint the new session over the old one's tail.
  terminal.term.reset();
  terminal.el.classList.remove('active');
  // What the cold tab goes on showing, read before its claude's report is forgotten with the rest.
  const tab = tabOf(token)!;
  const id = tab.session.id;
  const scheduledWhenStopped = keptWhenGone(tab);
  // Its claude has gone, so its last report is forgotten, as closing a tab forgets it: a claude forced out may never report that it ended, and its busy or waiting would go on nudging from every roll-up.
  // A SessionEnd that does arrive writes `closed`, which draws the same hollow dot as no status.
  clearNudge(id);
  // One change, which also stops it counting as running now rather than when its SessionEnd lands.
  store.batch(() => {
    // A stopped tab is not a slow one: the loader must not outlive the process.
    setTab(token, { terminalId: null, stopping: false, onExit: 'cool', forceable: false, forced: false, notLeft: false, booting: false, scheduledWhenStopped });
    // Stopping what you were looking at drops you to the empty screen rather than leaving a selected tab with nothing behind it; the panels lose their tab too, and fall back to the project.
    if (isOnShow(token)) store.set({ activeTab: null });
  });
  persistOpenTabs();
}
