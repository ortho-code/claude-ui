import type { SetAside, NeedsYou, SessionSummary } from '../../../../shared/types';
import { leaveAction, leaveLabel, type LeaveAction, type TabButtonMark } from '../../../rules/claude';
import { defaultSettings } from '../../../../shared/config/defaults';
import { entityKey, sessionLabel, unstartableReason } from '../../../rules/sessions';
import { store, type TabState } from '../../../state/app';
import { clearSetAside, markSetAside } from '../../../state/set-aside';
import { clearNeedsYou, restoreNeedsYou } from '../../../state/needs-you';
import { leaveTab, sessionById, tabButtonOf } from '../../../state/views';
import { setAsideUntil } from '../../../status/state-lines';
import { showToast } from '../../../ui/toast';
import { isQuitting } from '../../../window/quitting';
import { hostOf } from '../builtin';
import { askToLeave, forceStop, stopSession } from './leave';
import { persistOpenTabs } from './open-tabs';
import { keptWhenGone, setTab, tabOf } from './tab-state';
import { buildTab, removeTab, startTab } from './terminals';

/**
 * Closing a tab, finishing a session and what setting one aside does to its tabs, at once or once claude has gone, and the Undo each offers; and the leave a press asks for, which ends in a stop (leave.ts), a close or a finish.
 */

/**
 * A leave item pressed, from the session's menu or the tab's button (`leaveAction`): Stop session, Close tab, Finished, or the force of what claude is leaving for.
 * It acts only while the item would still do the same, and, given the mark it was drawn with, still draws it, since a press can land on an item drawn before the tab moved on — a Force stop pressed once claude has gone would otherwise close the tab (decided 2026-10-21).
 */
export function pressLeave(token: string, action: LeaveAction, mark?: TabButtonMark): void {
  const tab = tabOf(token);
  if (!tab) return;
  const now = leaveAction(tab, action);
  if (now.disabled || (mark !== undefined && now.mark !== mark)) return;
  if (now.mark === `force-${action}`) forceStop(token);
  else if (action === 'stop') stopSession(token);
  else if (action === 'close') closeTab(token, true);
  else finishSessions([entityKey(tab.session)]);
}

/**
 * The tab button's two steps: end the session first, remove the tab second.
 *
 * A running session and a tab are separate things — a cold tab costs nothing but a line in the bar, and it is restored on the next launch — so one press should not decide both.
 * The first press stops (claude gets its normal exit path and flushes), the tab stays and goes cold; the second removes it, unless the settings make it one press, or no button, for which a press does nothing.
 * While a session is arriving, or in the first moment of leaving, the button does nothing at all, and a session that is slow to leave is forced: see tabButton.
 * Checked here too, since a middle click reaches this without going through the button.
 */
export function pressTabButton(token: string): void {
  const tab = tabOf(token);
  if (!tab) return;
  const button = tabButtonOf(tab);
  if (button && !button.disabled) pressLeave(token, button.action, button.mark);
}

/** A tab you removed, as it was, so Undo can put it back: its session, where it stood among the tabs, and what it kept of its session's crons. */
interface RemovedTab {
  session: SessionSummary;
  at: number;
  scheduledWhenStopped: TabState['scheduledWhenStopped'];
  /** Every reason its session needed you for, which its going settled. */
  needsYou: readonly NeedsYou[] | null;
  /** Whether its claude was running when the close or the finish began, so that close or finish asked it to leave, rather than a stop before it. */
  running: boolean;
}

/** What Undo needs of a tab about to be removed, read before it goes; `running` for one whose claude the close or the finish asked to leave. */
function removedTab(tab: TabState, running = false): RemovedTab {
  return {
    session: tab.session,
    at: store.get().tabs.findIndex((t) => t.token === tab.token),
    scheduledWhenStopped: keptWhenGone(tab),
    needsYou: store.get().needsYou.get(entityKey(tab.session)) ?? null,
    running,
  };
}

/**
 * Undo's put-back: each tab back where it stood, as a tab restored at launch is, and marked as needing you again if it was.
 * One whose claude the close or the finish ended gets claude started again, unless `undoRunning` says to leave it cold or its folder has gone (decided 2026-11-11); any other comes back cold.
 * `removed` is in the order the tabs went, each `at` counted among the tabs as they were then, so they come back last first.
 * A session another tab holds by now, opened again meanwhile, keeps that tab rather than gaining a second, and a finished one gets none, since the app opens no finished session.
 */
function putBack(removed: readonly RemovedTab[]): void {
  const toStart: string[] = [];
  for (const { session, at, scheduledWhenStopped, needsYou, running } of [...removed].reverse()) {
    if (store.get().tabs.some((t) => t.session.id === session.id) || store.get().finished.has(entityKey(session))) continue;
    // As it was, from when it was marked, so a set-aside mark that muted it mutes it again.
    if (needsYou) restoreNeedsYou(entityKey(session), needsYou);
    // Built at the end, as every tab is, then moved to where it stood.
    const token = buildTab(session, scheduledWhenStopped);
    const tabs = [...store.get().tabs];
    const built = tabs.pop()!;
    tabs.splice(Math.min(Math.max(at, 0), tabs.length), 0, built);
    store.set({ tabs });
    if (running && restartsOnUndo(session)) toStart.push(token);
  }
  persistOpenTabs();
  for (const token of toStart) void startTab(token);
}

/** Whether an Undo starts claude again in a tab of `session` whose claude it ended: as `undoRunning` says, and only while its folder is there, read from the session as the app knows it now, as a launch reads it. */
function restartsOnUndo(session: SessionSummary): boolean {
  return (store.get().settings?.undoRunning.value ?? defaultSettings().undoRunning) === 'start' && !unstartableReason(sessionById(session.id) ?? session);
}

/**
 * The toast a close you pressed raises once its tabs have gone, one for a batch, with Undo putting the tabs it removed back where they were (decided 2026-10-28), and Finished and Set aside… for the sessions it closed, so deciding what becomes of them is one press while it is cheapest (decided 2026-11-05).
 * Whichever is pressed, the toast it raises has an Undo back to before the close: Finished's puts the tabs back as a finish's Undo does for the tabs it closed, and Set aside…'s takes the marks off and puts the tabs back; cancelling Set aside… brings this toast back.
 */
function offerUndoClose(removed: readonly RemovedTab[]): void {
  const keys = [...new Set(removed.map((r) => entityKey(r.session)))];
  const { setAside } = store.get();
  const mark = removed.length === 1 ? setAside.get(keys[0]!) : undefined;
  const said = removed.length === 1 ? `Closed "${sessionLabel(removed[0]!.session)}"${mark ? `, set aside${setAsideUntil(mark.due)}` : ''}` : `Closed ${removed.length} tabs`;
  // A session already set aside is offered its mark's way out too, as one press while the toast is up (decided 2026-11-11).
  const marked = keys.filter((key) => setAside.has(key));
  showToast(said, false, [
    { label: 'Undo', run: () => putBack(removed) },
    { label: leaveLabel('finish'), run: () => finishSessions(keys, removed) },
    { label: 'Set aside…', run: () => void setAsideClosed(keys, removed) },
    ...(marked.length > 0 ? [{ label: 'Clear set aside', run: () => clearSetAside(marked) }] : []),
  ]);
}

/** Set aside… from a close's toast: the session list's dialog for the sessions it closed, then the set aside's toast, whose Undo takes the marks off and puts the tabs back, or the close's toast again when the dialog is cancelled. */
async function setAsideClosed(keys: readonly string[], removed: readonly RemovedTab[]): Promise<void> {
  const done = await hostOf('claude').setAside(keys);
  if (!done) {
    offerUndoClose(removed);
    return;
  }
  setAsideTabs(keys, done, removed);
}

/** One set aside, from its toast to its Undo: what the toast says, the Undo of its marks, and what it has done to the tabs so far, the ones it closed and the ones it stopped. */
interface SetAsideAct {
  said: string;
  undoMarks: () => void;
  removed: RemovedTab[];
  stopped: string[];
}

/** The tabs whose claude a set aside asked to leave and that have not gone yet, each with its set aside. */
const leavingForSetAside = new Map<string, SetAsideAct>();

/** The tabs an Undo kept whose claude was still leaving: claude starts again in each once it has gone. */
const restartAtExit = new Set<string>();

/** A tab's leave called off, by a prompt, a `/resume` or a `/clear`: what was noted for its exit goes with it, so the tab's next exit is its own. */
export function leaveCalledOff(token: string): void {
  leavingForSetAside.delete(token);
  restartAtExit.delete(token);
  stoppedFirst.delete(token);
}

/**
 * What setting sessions aside does to their tabs once `done` has marked them, by `setAsideRunning` (decided 2026-11-11): each claude running in one asked to leave, as Stop asks, its tab closed or kept cold once it has gone, or left running.
 * A tab with no running claude, one starting and one already leaving are left as they are.
 * The toast comes at once, and again as each claude goes, so its Undo covers all done by then; `closed` are tabs a close removed already, whose toast's Set aside… this is.
 */
export function setAsideTabs(keys: readonly string[], done: { said: string; undo: () => void }, closed: readonly RemovedTab[] = []): void {
  const act: SetAsideAct = { said: done.said, undoMarks: done.undo, removed: [...closed], stopped: [] };
  const how = store.get().settings?.setAsideRunning.value ?? defaultSettings().setAsideRunning;
  const wanted = new Set(keys);
  if (how !== 'keep') {
    for (const tab of store.get().tabs) {
      if (!wanted.has(entityKey(tab.session)) || tab.terminalId === null || tab.starting || tab.stopping) continue;
      leavingForSetAside.set(tab.token, act);
      stoppedFirst.delete(tab.token);
      askToLeave(tab.token, tab.terminalId, how === 'stop' ? 'cool' : 'close');
    }
  }
  offerUndoSetAside(act);
}

function offerUndoSetAside(act: SetAsideAct): void {
  showToast(act.said, false, [{ label: 'Undo', run: () => undoSetAside(act) }]);
}

/** A set aside's Undo: its marks off, the tabs it closed back where they stood, and claude started again where it ran, in a tab still leaving once it has gone. */
function undoSetAside(act: SetAsideAct): void {
  for (const [token, leaving] of leavingForSetAside) {
    if (leaving !== act) continue;
    leavingForSetAside.delete(token);
    setTab(token, { onExit: 'cool' });
    restartAtExit.add(token);
  }
  act.undoMarks();
  putBack(act.removed);
  for (const token of act.stopped) restartCold(token);
}

/** Start claude again in a cold tab an Undo kept, where `undoRunning` says to and its folder is still there. */
function restartCold(token: string): void {
  const tab = tabOf(token);
  if (tab?.terminalId === null && restartsOnUndo(tab.session)) void startTab(token);
}

/**
 * The set aside a claude's exit belongs to, taken off the tabs still leaving for one: only while its session is still set aside.
 * A leave called off, or a close or a finish pressed while it is under way, takes the tab off its set aside before the exit (`leaveCalledOff`); a mark taken off meanwhile, by Clear set aside, leaves the exit to the stop or the close it is.
 */
function setAsideLeft(token: string, key: string): SetAsideAct | undefined {
  const act = leavingForSetAside.get(token);
  leavingForSetAside.delete(token);
  return act && store.get().setAside.has(key) ? act : undefined;
}

/**
 * Close the tabs of several sessions at once, as Close tab in the session list's bar does (docs/architecture/session-list.md § Selecting several): each tab by the rule its menu's Close tab follows (`leaveAction`), never forcing one already closing, and a tab starting left as it is.
 * The cold ones go at once and raise one toast, whose Undo puts them all back; a running one goes once its claude has gone, with its own Undo then, as a single close does.
 */
export function closeTabs(keys: readonly string[]): void {
  const wanted = new Set(keys);
  const removed: RemovedTab[] = [];
  for (const tab of store.get().tabs.filter((t) => wanted.has(entityKey(t.session)))) {
    const item = leaveAction(leaveTab(tab), 'close');
    if (item.disabled || item.mark !== 'close') continue;
    if (tab.terminalId === null) {
      removed.push(removedTab(tab));
      removeTab(tab.token);
    } else pressLeave(tab.token, 'close', 'close');
  }
  if (removed.length > 0) offerUndoClose(removed);
}

/**
 * Close a tab: at once when it is cold, and for a live one once its claude has gone, asked to leave as a stop asks it.
 * The tab outlives the session because claude can ask something on its way out, which a tab removed first would make unanswerable: it is kept, stopping, until the exit lands, and goes then.
 * claude persists per turn, so a session's context is on disk whichever way it ends.
 * `undoable` is a close you pressed of a cold tab, whose going offers Undo at once; a live tab's close offers it at its exit (`leftAtExit`), unless a finish closed it, whose own toast is its Undo.
 */
function closeTab(token: string, undoable = false): void {
  const tab = tabOf(token);
  if (!tab) return;
  if (tab.terminalId === null) {
    const removed = removedTab(tab);
    removeTab(token);
    if (undoable) offerUndoClose([removed]);
    return;
  }
  // Already leaving: it goes with the exit rather than staying cold.
  if (tab.stopping) {
    if (tab.onExit === 'cool') stoppedFirst.add(token);
    // A close you press takes the exit over from a set aside under way, with the close's own toast.
    leavingForSetAside.delete(token);
    setTab(token, { onExit: 'close' });
    return;
  }
  stoppedFirst.delete(token);
  askToLeave(token, tab.terminalId, 'close');
}

/** The tabs whose claude a stop asked to leave before a close or a finish took the exit over: the stop had ended claude, so an Undo brings them back cold. */
const stoppedFirst = new Set<string>();

/**
 * Mark sessions finished, closing every tab each is open in: at once where no claude of the app's runs it, all of those in one write with one toast, and where one does, once that claude has gone, asked to leave as a close asks it.
 * The mark waits for the exit so that no claude the app runs when it is written runs a finished session, and the tab waits so that what claude asks on its way out can be answered there.
 * A claude already asked to leave, by a stop or a close, is asked nothing more, since a second pair of presses ends what it asks on its way out unanswered: its exit finishes instead, as a close changes a stop.
 * Going on working meanwhile, a prompt or a `/resume` or `/clear`, calls the finish off with the stop (`stopCalledOff`), a prompt saying so (`promptSubmitted`), and a quit finishes nothing (`finishAtExit`).
 * Not a session with a tab starting, which has no claude yet to ask; the menu's Finished is unavailable then, and a batch leaves it out.
 * `closed` are tabs a close removed already, whose toast's Finished this is: its Undo puts them back with the rest.
 */
export function finishSessions(keys: readonly string[], closed: readonly RemovedTab[] = []): void {
  const now: string[] = [];
  for (const key of keys) {
    const held = store.get().tabs.filter((t) => entityKey(t.session) === key);
    if (held.some((t) => t.starting)) continue;
    // A fresh finish starts its list afresh, so what a finish called off had removed is not put back by this one's Undo.
    if (!held.some((t) => t.stopping && t.onExit === 'finish')) finishRemoved.delete(key);
    finishedTabs(key).push(...closed.filter((r) => entityKey(r.session) === key));
    if (held.every((t) => t.terminalId === null)) {
      now.push(key);
      continue;
    }
    for (const tab of held) {
      if (tab.terminalId === null) {
        finishedTabs(key).push(removedTab(tab));
        removeTab(tab.token);
      } else if (tab.stopping) {
        if (tab.onExit === 'cool') stoppedFirst.add(tab.token);
        leavingForSetAside.delete(tab.token);
        setTab(tab.token, { onExit: 'finish' });
      } else {
        stoppedFirst.delete(tab.token);
        askToLeave(tab.token, tab.terminalId, 'finish');
      }
    }
  }
  if (now.length > 0) void finishNow(now);
}

/** Per session being finished, the tabs its finish has removed so far, for its Undo to put back; taken when the mark is written. */
const finishRemoved = new Map<string, RemovedTab[]>();

function finishedTabs(key: string): RemovedTab[] {
  let removed = finishRemoved.get(key);
  if (!removed) finishRemoved.set(key, (removed = []));
  return removed;
}

/** What a finish's Undo puts back of one session: its set-aside and needs-you marks as they were, read before the write. */
interface FinishedMarks {
  key: string;
  setAside: SetAside | null;
  needsYou: readonly NeedsYou[] | null;
}

/** A session's title, for a toast, or the start of its id when the app no longer has it. */
function titleOf(key: string, removed: readonly RemovedTab[]): string {
  const session = sessionById(key) ?? removed.find((r) => entityKey(r.session) === key)?.session;
  return session ? `"${sessionLabel(session)}"` : `"${key.slice(0, 8)}"`;
}

/** The toast a finish raises once its marks are written, one for a batch, with Undo making them unfinished in one write, putting back the tabs the finish closed (decided 2026-10-28), and each one's set-aside and needs-you marks as they were, a session with no tab too. */
function offerUndoFinish(marks: readonly FinishedMarks[], removed: readonly RemovedTab[]): void {
  const keys = marks.map((m) => m.key);
  const what = keys.length === 1 ? titleOf(keys[0]!, removed) : `${keys.length} sessions`;
  showToast(`Finished ${what}`, false, [
    {
      label: 'Undo',
      run: () =>
        void window.claudeUi.unfinish(keys).then(
          (finished) => {
            store.set({ finished: new Map(Object.entries(finished)) });
            for (const { key, setAside: setAside, needsYou } of marks) {
              if (setAside) markSetAside([key], setAside.due, setAside.at);
              if (needsYou) restoreNeedsYou(key, needsYou);
            }
            putBack(removed);
          },
          () => showToast(`Couldn't make ${what} unfinished; make ${keys.length === 1 ? 'it' : 'them'} unfinished from the finished sessions`),
        ),
    },
  ]);
}

/**
 * Write the finished marks of sessions, in one write, and close their tabs in the same change, so the list draws once, with both gone.
 * A tab opened while main writes is closed too: its claude, if one has started by then, asked to leave as a close asks it, after the mark, or closed at its exit if it was leaving already, and one still starting ended as it arrives.
 * A write main refuses says so, since at an exit the tab is gone already and the row staying would be all that says it.
 */
async function finishNow(keys: readonly string[]): Promise<void> {
  let finished: Map<string, number>;
  // Read before the write, as the tabs are, for Undo: with or without a tab, a session was set aside, or needed you.
  const marks: FinishedMarks[] = keys.map((key) => ({ key, setAside: store.get().setAside.get(key) ?? null, needsYou: store.get().needsYou.get(key) ?? null }));
  try {
    finished = new Map(Object.entries(await window.claudeUi.finish([...keys])));
  } catch {
    for (const key of keys) finishRemoved.delete(key);
    showToast(`Couldn't finish ${keys.length === 1 ? `${titleOf(keys[0]!, [])}. It's` : `${keys.length} sessions. They're`} still here.`);
    return;
  }
  const removed: RemovedTab[] = [];
  for (const key of keys) {
    removed.push(...finishedTabs(key));
    finishRemoved.delete(key);
  }
  const wanted = new Set(keys);
  store.batch(() => {
    store.set({ finished });
    for (const tab of store.get().tabs) {
      if (!wanted.has(entityKey(tab.session))) continue;
      if (tab.terminalId === null) removed.push(removedTab(tab));
      closeTab(tab.token);
    }
    // Main's finish took the marks off as it finished (src/main/sessions/meta.ts); after the tabs, whose Undo puts the needs-you mark back.
    for (const key of keys) clearNeedsYou(key, 'finished');
    clearSetAside(keys);
  });
  offerUndoFinish(marks, removed);
}

/**
 * The exit of a claude asked to leave for a finish, its tab already gone: the session is finished once no tab holds it.
 * A tab still holding it is either still leaving for the finish, whose exit finishes it then, or one whose stop was called off, where the session is being worked in.
 * Not at a quit: a claude that had not gone may still have needed you, answering its question say, so the session stays unfinished and its tab comes back at the next launch, as a close under way does (decided 2026-10-28).
 */
function finishAtExit(key: string): void {
  if (isQuitting()) return;
  if (store.get().tabs.some((t) => entityKey(t.session) === key)) return;
  void finishNow([key]);
}

/**
 * The exit of a claude asked to leave: for a stop, its tab cold by now, claude started again where an Undo asked for it, and a set aside's toast raised again with this tab among those it stopped.
 * For a close or a finish, the tab goes now that claude has gone, and the session is marked finished for the finish; a close for a set aside raises the set aside's toast rather than its own.
 */
export function leftAtExit(token: string, tab: TabState): void {
  const key = entityKey(tab.session);
  const aside = setAsideLeft(token, key);
  if (tab.onExit === 'cool') {
    if (restartAtExit.delete(token)) restartCold(token);
    if (aside) {
      aside.stopped.push(token);
      offerUndoSetAside(aside);
    }
    return;
  }
  const left = removedTab(tab, !stoppedFirst.delete(token));
  removeTab(token);
  if (aside && tab.onExit === 'close') {
    aside.removed.push(left);
    offerUndoSetAside(aside);
    return;
  }
  const removed = finishedTabs(key);
  removed.push(left);
  if (tab.onExit === 'finish') {
    finishAtExit(key);
    return;
  }
  // A close: a finish it was turned from leaves no mark, so the tabs that finish had removed already come back with this one's Undo.
  finishRemoved.delete(key);
  // One a finish closed, opened while it wrote its mark, offers nothing: the finish's own toast is the Undo.
  if (!store.get().finished.has(key)) offerUndoClose(removed);
}
