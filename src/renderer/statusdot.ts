import { statusLabel, type NudgeStatus } from './logic';
import { toggleAck } from './state/statuses';
import { setTooltip } from './tooltip';

/** The status dots: a session's own, as the sidebar row, the tab, the attention strip and a list panel's row draw it, and a roll-up's, which stands for many; how each looks is base.css's `.nudge`. */

/** A session's dot: hollow with nothing to report, dimmed once read, and a control where `clickable` (a click marks it read, `ackOnClick`). */
export function sessionDotClass(status: string | null | undefined, acked: boolean, clickable = false): string {
  return `nudge single${clickable ? ' clickable' : ''}${status ? ` ${status}${acked ? ' acked' : ''}` : ''}`;
}

/** A roll-up's dot, or a panel's: the strongest state under it, or nothing at all, since it has no quiet state of its own. */
export function badgeClass(badge: NudgeStatus | 'failed'): string {
  return badge ? `nudge ${badge}` : 'nudge';
}

export function applyStatus(dot: HTMLElement, status: string | undefined, isAcked = false): void {
  dot.className = sessionDotClass(status, isAcked, true);
  setTooltip(dot, statusLabel(status, isAcked));
}

/**
 * Make a status dot mute its session when clicked, wherever that dot is drawn.
 *
 * The gesture is "click the status dot", and it has to mean the same thing on all three surfaces that draw one — the sidebar row, the tab, and the attention strip — so it is one helper rather than three copies of the same four lines.
 * `stopPropagation` is the load-bearing part: every one of those dots sits inside something clickable that does something else (select the row, switch to the tab, jump to the session), and muting must not also do that.
 * The id arrives as a thunk because the sidebar's rows are REUSED across renders: the row knows its key, and which session that key holds is only true at the moment of the click.
 */
export function ackOnClick(dot: HTMLElement, sessionId: () => string | null): void {
  dot.addEventListener('click', (event) => {
    event.stopPropagation();
    const id = sessionId();
    if (id) toggleAck(id);
  });
}
