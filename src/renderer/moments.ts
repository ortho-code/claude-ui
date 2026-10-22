import { setTooltip } from './tooltip';

/**
 * A MOMENT ON SCREEN: an element that says when something happened, in words that may say how long ago ("5 min ago", `relativeTime`), with the moment in full in its tooltip.
 * Such words go out of date while nothing in the store moves, and the surfaces that draw them draw again only when something does, or never, as the history keeps each exchange it has drawn.
 * So an element that keeps such words on screen is handed here, and drawn again on one clock, once a minute while it is in the page: a minute is the finest step `relativeTime` takes past "just now".
 * What it says is asked again at each tick rather than kept, so one whose moment moved without its surface drawing again, the row of a session claude is writing to, says the new one at the next tick.
 */

/** What an element says of a moment, and the moment itself as an ISO time, or null when it is not known. */
export interface Moment {
  text: string;
  at: string | null;
}

const MINUTE = 60_000;

/** The elements on the clock, each with what it asks for at a tick; one that has left the page is dropped at the next, and its surface puts it back on when it draws it again. */
const shown = new Map<HTMLElement, () => Moment>();
let clock: number | undefined;

/** Draw `moment` into `el` now, and what `later` says at every tick from here while `el` is in the page; a second call for the same element replaces the first. */
export function showMoment(el: HTMLElement, moment: Moment, later: () => Moment): void {
  draw(el, moment);
  shown.set(el, later);
  clock ??= window.setInterval(tick, MINUTE);
}

function tick(): void {
  for (const [el, later] of shown) {
    if (el.isConnected) draw(el, later());
    else shown.delete(el);
  }
}

/** The words only where they changed, since most do not from one minute to the next. */
function draw(el: HTMLElement, { text, at }: Moment): void {
  if (el.textContent !== text) el.textContent = text;
  setTooltip(el, at && new Date(at).toLocaleString());
}
