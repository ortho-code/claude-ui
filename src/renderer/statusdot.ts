import { isNeeds, showsRead, stateLines, type NudgeStatus, type StateLine } from './logic';
import { lookClass, lookOf } from './looks';
import type { View } from './state/app';
import { canMarkRead, toggleAck } from './state/statuses';
import { dotStatus, mutedNeedsYou, shownRead, strengthNow, tabDot, tabWith } from './state/views';
import { setTooltip } from './tooltip';

/** The status dots: a session's own, as the sidebar row, the tab, the live strip and a list panel's row draw it, and a roll-up's, which stands for many; their shape is base.css's `.nudge`, and each state's look is a class the looks' stylesheet draws (looks.ts). */

/**
 * The classes a state draws with: a needs-you reason's `needs` and any other state its own, then its look's.
 * On anything but a dot they give only the look's colour, `--look`, a reason of a type without a look of its own taking needs-you's through `needs` (looks.ts).
 */
export function stateClass(state: string): string {
  const look = lookOf(state);
  return `${isNeeds(state) ? 'needs' : state}${look === null ? '' : ` ${lookClass(look)}`}`;
}

/** A session's dot: hollow with nothing to report, dimmed once read, and a control where `clickable` (a click marks it read, `ackOnClick`). */
export function sessionDotClass(status: string | null | undefined, acked: boolean, clickable = false): string {
  return `nudge single${clickable ? ' clickable' : ''}${status ? ` ${stateClass(status)}${showsRead(status, acked) ? ' acked' : ''}` : ''}`;
}

/** A roll-up's dot, or a panel's: the strongest state under it, or nothing at all, since it has no quiet state of its own; a panel's `needs` is the needs-you mark's. */
export function badgeClass(badge: NudgeStatus | 'needs' | 'failed'): string {
  return badge ? `nudge ${stateClass(badge)}` : 'nudge';
}

/**
 * Paint a session's dot, from what it shows (`dotStatus`) and whether it is marked read, on every surface that draws one as a control.
 * It is a control only where a click marks something, idle, waiting and needs and not finished (`canMarkRead`, the rule the click and the menu's Mark as read follow too); any other dot is no control, and a click on it goes to what holds it, such as a stopping session's strip row, which takes you to its tab.
 */
export function applyStatus(dot: HTMLElement, id: string, view: View<'statuses' | 'backgroundTasks' | 'acked' | 'needsYou' | 'setAside' | 'tabs' | 'finished' | 'settings' | 'needsYouTypes'>): void {
  const shown = dotStatus(id, view);
  dot.className = sessionDotClass(shown, shownRead(id, shown, view), canMarkRead(id, view));
  setTooltip(dot, statusText(id, view));
}

/** Every state a session's dot can show, a line each, in the strength order (`stateLines`). */
function linesOf(id: string, view: View<'statuses' | 'backgroundTasks' | 'acked' | 'needsYou' | 'setAside' | 'tabs' | 'settings' | 'needsYouTypes'>): (StateLine & { read: boolean })[] {
  const tab = tabWith(id, view);
  return stateLines(
    {
      tab: tab && tabDot(tab),
      status: view.statuses.get(id),
      background: view.backgroundTasks.get(id) ?? [],
      reasons: view.needsYou.get(id) ?? [],
      acked: view.acked.has(id),
      muted: mutedNeedsYou(view).has(id),
    },
    strengthNow(view),
  );
}

/** What a session's dot says, as its tooltip: every state it is in, the one it shows first; null for nothing to report. */
export function statusText(id: string, view: View<'statuses' | 'backgroundTasks' | 'acked' | 'needsYou' | 'setAside' | 'tabs' | 'settings' | 'needsYouTypes'>): string | null {
  const lines = linesOf(id, view);
  return lines.length === 0 ? null : lines.map((line) => line.text).join('\n');
}

/**
 * Every state a session is in, each with its dot, for its menu's header: the lines of its dot's tooltip (`statusText`), in the same order, where its one dot shows only the first.
 * The read mark dims the state the dot shows, as it dims the dot, and a needs-you mark its set-aside mark mutes is dimmed wherever it is.
 */
export function statusLines(id: string, view: View<'statuses' | 'backgroundTasks' | 'acked' | 'needsYou' | 'setAside' | 'tabs' | 'settings' | 'needsYouTypes'>): { text: string; dot: string }[] {
  return linesOf(id, view).map(({ text, state, read }) => ({ text, dot: sessionDotClass(state, read) }));
}

/**
 * Make a status dot mute its session when clicked, wherever that dot is drawn.
 *
 * The gesture is "click the status dot", and it has to mean the same thing on every surface that draws one — the sidebar row, the tab, the live strip and a list panel's row naming a session — so it is one helper rather than copies of the same four lines.
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
