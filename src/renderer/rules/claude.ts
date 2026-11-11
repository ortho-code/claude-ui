import type { LeaveButton } from '../../shared/config/settings';

/**
 * Enough of a tab to know what its button should say: whether it has a process, four of the flags a tab's data carries (`TabState`, in state/app.ts), and nothing of its terminal.
 * The flags are optional, so a caller can name only the one it is about: absent means "not in that transition", which is the same thing as false and is why every check on them is a truthiness test.
 */
export interface TabButtonTab {
  /** Its process, or null for a cold tab. */
  terminalId: number | null;
  /** A process is on its way. */
  starting?: boolean;
  /** A process is on its way out. */
  stopping?: boolean;
  /** It has been on its way out long enough that the control now forces it. */
  forceable?: boolean;
  /** It has been on its way out long enough to say so where it shows without a hover (`notLeftWords`). */
  notLeft?: boolean;
  /** What its exit does once claude has gone, while it is on its way out: keep the tab (`cool`, the default), remove it, or remove it and mark its session finished. */
  onExit?: 'cool' | 'close' | 'finish';
  /** A tab of its session is starting, this one or another, which leaves no claude yet to ask to leave for a finish, the session's rather than a tab's (`finishSessions`). */
  sessionStarting?: boolean;
}

/**
 * What a tab's claude can be asked to leave for, each one press of its own meaning (decided 2026-10-28): a stop keeps the tab, cold, a close removes it, and a finish removes it and marks its session finished, each waiting out what claude asks on its way out.
 */
export type LeaveAction = 'stop' | 'close' | 'finish';

/**
 * The mark on a tab's button and its menu's items: the stop square, the cross, or the lidded box (`tabButtonIcon`).
 * Each has a force, which ends a claude that has not left without asking: the stop square filled, and for a close and a finish the filled square with their own mark cut through it.
 */
export type TabButtonMark = LeaveAction | `force-${LeaveAction}`;

/** What a tab's button, or one of its menu's leave items, shows and does: `action` is what a press asks for, and the item's words are `label`. */
export interface TabButton {
  disabled: boolean;
  tooltip: string;
  mark: TabButtonMark;
  label: string;
  action: LeaveAction;
}

const LEAVE_WORDS: Record<LeaveAction, { label: string; force: string; going: string }> = {
  stop: { label: 'Stop session', force: 'Force stop', going: 'Stopping…' },
  close: { label: 'Close tab', force: 'Force close', going: 'Closing…' },
  finish: { label: 'Finished', force: 'Force finish', going: 'Finishing…' },
};

/** What a press on a leave item does, in words: its label, and the button's tooltip while it can act. */
export function leaveLabel(action: LeaveAction): string {
  return LEAVE_WORDS[action].label;
}

/** What a tab that is on its way out is leaving for: what its exit will do; null while it is not leaving. */
export function leaveUnderWay(tab: TabButtonTab): LeaveAction | null {
  if (!tab.stopping) return null;
  return tab.onExit === 'close' || tab.onExit === 'finish' ? tab.onExit : 'stop';
}

const available = (action: LeaveAction): TabButton => ({ disabled: false, tooltip: LEAVE_WORDS[action].label, mark: action, label: LEAVE_WORDS[action].label, action });
const unavailable = (action: LeaveAction, why: string): TabButton => ({ disabled: true, tooltip: why, mark: action, label: LEAVE_WORDS[action].label, action });

/**
 * The force of what a tab is leaving for, named for it: Force stop, Force close or Force finish.
 * A session asked to leave may never go: claude can ask something on its way out and wait for the answer, and nothing it sends tells that from a claude that hangs.
 * So after a moment the force ends it without asking; the moment, when it is unavailable, is what keeps a double-click from forcing before the question is even on screen, and it is unavailable again once forced, until the exit lands.
 */
function leaveForce(tab: TabButtonTab, under: LeaveAction): TabButton {
  const { force, going } = LEAVE_WORDS[under];
  if (tab.forceable) return { disabled: false, tooltip: `${force}: claude has not left yet — it may be asking you something`, mark: `force-${under}`, label: force, action: under };
  return { disabled: true, tooltip: going, mark: under, label: force, action: under };
}

/**
 * A leave item of a tab's menu, by one rule for every surface that draws it: Stop session, Close tab or Finished.
 *
 * Starting is checked FIRST, and the order matters: a tab can carry both flags, and what it is doing is arriving, not leaving, so there is no claude yet to ask.
 * Finished is the session's, so a tab of the session starting, whichever, leaves it unavailable too.
 * While claude is on its way out, the item of what was asked is its force (decided 2026-10-28), and the others change what the exit does without asking claude again, since a second pair of presses ends what it asks on its way out unanswered: Stop session turns a close or a finish back into a stop, Close tab and Finished turn a leave into theirs.
 * A cold tab has nothing to stop; it closes and finishes at once.
 */
export function leaveAction(tab: TabButtonTab, action: LeaveAction): TabButton {
  if (tab.starting || (action === 'finish' && tab.sessionStarting)) return unavailable(action, 'Starting…');
  const under = leaveUnderWay(tab);
  if (under === action) return leaveForce(tab, under);
  if (under === null && tab.terminalId === null && action === 'stop') return unavailable('stop', 'Not running');
  return available(action);
}

/**
 * What a tab's button shows; null for no button, which `choice` `none` asks for.
 * A shortcut to one of its menu's leave items, so it says and does what that item would (`leaveAction`): on a running tab Stop session, or with `close` or `finish` that leave in one press, and on a cold one the leave `choice` ends in; while claude is on its way out, the force of what it is leaving for, so the button stays the press that ends claude, and changing what the exit does is the menu's.
 */
export function tabButton(tab: TabButtonTab, choice: LeaveButton = 'stop-close'): TabButton | null {
  if (choice === 'none') return null;
  const removes = choice === 'stop-finish' || choice === 'finish' ? 'finish' : 'close';
  const running = choice === 'close' || choice === 'finish' ? removes : 'stop';
  if (tab.starting) return unavailable(running, 'Starting…');
  const under = leaveUnderWay(tab);
  if (under) return leaveForce(tab, under);
  return leaveAction(tab, tab.terminalId === null ? removes : running);
}

/**
 * The words beside a session's name, on its tab and its list row, for a stop claude has not answered by leaving a while after the ask; null otherwise.
 * The button's own words say the same, but only on a hover, and the question claude may be asking is out of sight on a tab not on show.
 */
export function notLeftWords(tab: TabButtonTab): string | null {
  return tab.stopping && tab.notLeft ? "hasn't left" : null;
}
