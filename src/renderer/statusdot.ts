import { showsRead, statusLabel, type NudgeStatus } from './logic';
import type { View } from './state/app';
import { toggleAck } from './state/statuses';
import { dotStatus } from './state/views';
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
 * Paint a session's dot as a control, from what it shows (`dotStatus`) and whether it is marked read, on every surface that draws one as a control.
 * A paused session's dot is not one: there is nothing to mark read, and a click goes to what holds it, which opens the session and so resumes it.
 */
export function applyStatus(dot: HTMLElement, id: string, view: View<'statuses' | 'backgroundTasks' | 'acked' | 'tabs'>): void {
  const status = dotStatus(id, view);
  dot.className = sessionDotClass(status, view.acked.has(id), status !== 'paused');
  setTooltip(dot, statusText(id, view));
}

/** What a session's dot says it shows, as its tooltip and in its menu's header; null for nothing to report. */
export function statusText(id: string, view: View<'statuses' | 'backgroundTasks' | 'acked' | 'tabs'>): string | null {
  return statusLabel(dotStatus(id, view), view.acked.has(id), view.backgroundTasks.get(id));
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
    // A dot painted as no control, a paused session's, leaves the click to what holds it.
    if (!dot.classList.contains('clickable')) return;
    event.stopPropagation();
    const id = sessionId();
    if (id) toggleAck(id);
  });
}
