import { showsRead, statusLabel, type NudgeStatus } from './logic';
import type { View } from './state/app';
import { canMarkRead, toggleAck } from './state/statuses';
import { dotStatus, mutedNeedsYou, shownRead, tabDot, tabWith } from './state/views';
import { setTooltip } from './tooltip';

/** The status dots: a session's own, as the sidebar row, the tab, the live strip and a list panel's row draw it, and a roll-up's, which stands for many; how each looks is base.css's `.nudge`. */

/** A session's dot: hollow with nothing to report, dimmed once read, and a control where `clickable` (a click marks it read, `ackOnClick`). */
export function sessionDotClass(status: string | null | undefined, acked: boolean, clickable = false): string {
  return `nudge single${clickable ? ' clickable' : ''}${status ? ` ${status}${showsRead(status, acked) ? ' acked' : ''}` : ''}`;
}

/** A roll-up's dot, or a panel's: the strongest state under it, or nothing at all, since it has no quiet state of its own. */
export function badgeClass(badge: NudgeStatus | 'failed'): string {
  return badge ? `nudge ${badge}` : 'nudge';
}

/**
 * Paint a session's dot, from what it shows (`dotStatus`) and whether it is marked read, on every surface that draws one as a control.
 * It is a control only where a click marks something, idle, waiting and needs and not archived (`canMarkRead`, the rule the click and the menu's Mark as read follow too); any other dot is no control, and a click on it goes to what holds it, such as a stopping session's strip row, which takes you to its tab.
 */
export function applyStatus(dot: HTMLElement, id: string, view: View<'statuses' | 'backgroundTasks' | 'acked' | 'needsYou' | 'setAside' | 'tabs' | 'archived'>): void {
  const shown = dotStatus(id, view);
  dot.className = sessionDotClass(shown, shownRead(id, shown, view), canMarkRead(id, view));
  setTooltip(dot, statusText(id, view));
}

/** What a session's dot says it shows, as its tooltip; null for nothing to report. */
export function statusText(id: string, view: View<'statuses' | 'backgroundTasks' | 'acked' | 'needsYou' | 'setAside' | 'tabs'>): string | null {
  const shown = dotStatus(id, view);
  return statusLabel(shown, shownRead(id, shown, view), view.backgroundTasks.get(id), view.needsYou.get(id));
}

/**
 * Every state a session is in, each with its dot, for its menu's header: what its tab says, its status as its hooks last reported it, and its needs-you mark, a line per reason, in that order, where its one dot shows only the strongest of them (`dotStatus`).
 * The read mark dims the state the dot shows, as it dims the dot, and a needs-you mark its later mark mutes is dimmed wherever it is.
 */
export function statusLines(id: string, view: View<'statuses' | 'backgroundTasks' | 'acked' | 'needsYou' | 'setAside' | 'tabs'>): { text: string; dot: string }[] {
  const tab = tabWith(id, view);
  const shown = dotStatus(id, view);
  const needsYou = view.needsYou.get(id);
  const states = [tab && tabDot(tab), view.statuses.get(id), needsYou ? 'needs' : undefined].filter((state): state is string => Boolean(state));
  return states.flatMap((state) => {
    const read = (view.acked.has(id) && state === shown) || (state === 'needs' && mutedNeedsYou(view).has(id));
    const text = statusLabel(state, read, view.backgroundTasks.get(id), needsYou) ?? state;
    return text.split('\n').map((line) => ({ text: line, dot: sessionDotClass(state, read) }));
  });
}

/**
 * Make a status dot mute its session when clicked, wherever that dot is drawn.
 *
 * The gesture is "click the status dot", and it has to mean the same thing on all three surfaces that draw one — the sidebar row, the tab, and the live strip — so it is one helper rather than three copies of the same four lines.
 * `stopPropagation` is the load-bearing part: every one of those dots sits inside something clickable that does something else (select the row, switch to the tab, jump to the session), and muting must not also do that.
 * The id arrives as a thunk because the sidebar's rows are REUSED across renders: the row knows its key, and which session that key holds is only true at the moment of the click.
 */
export function ackOnClick(dot: HTMLElement, sessionId: () => string | null): void {
  dot.addEventListener('click', (event) => {
    // A dot painted as no control, one with nothing to mark (`applyStatus`), leaves the click to what holds it.
    if (!dot.classList.contains('clickable')) return;
    event.stopPropagation();
    const id = sessionId();
    if (id) toggleAck(id);
  });
}
