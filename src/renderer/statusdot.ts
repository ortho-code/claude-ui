import { statusLabel } from './logic';
import { toggleAck } from './state/statuses';
import { setTooltip } from './tooltip';

/** A session's status dot, as the sidebar row, the tab and the attention strip draw it. */

export function applyStatus(dot: HTMLElement, status: string | undefined, isAcked = false): void {
  dot.className = status ? `nudge single clickable ${status}${isAcked ? ' acked' : ''}` : 'nudge single clickable';
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
