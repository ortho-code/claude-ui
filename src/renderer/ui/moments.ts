import { momentInLanguage, onLanguageChange } from './locale';
import { setTooltip } from './tooltip';

/**
 * A MOMENT ON SCREEN: an element that says when something happened, in words that may say how long ago ("5 min ago", `relativeTime`), with what the moment is and the moment in full in its tooltip ("Last active: Tue 3 Nov, 09:00").
 * Such words go out of date while nothing in the store moves, and the surfaces that draw them draw again only when something does, or never, as the history keeps each exchange it has drawn.
 * So an element that keeps such words on screen is handed here, and drawn again on one clock, once a minute while it is in the page: a minute is the finest step `relativeTime` takes past "just now".
 * What it says is asked again at each tick rather than kept, so one whose moment moved without its surface drawing again, the row of a session claude is writing to, says the new one at the next tick.
 * A change of the language ticks at once, so every tooltip says its moment in the new one.
 */

/**
 * What an element says of a moment, the moment itself as an ISO time, or null when it is not known, and what the moment is, "Last active", which leads its tooltip.
 * `tooltip`, where given, is the whole tooltip in place of that one line, for a surface that says more around its moment.
 */
export interface Moment {
  text: string;
  at: string | null;
  label: string;
  tooltip?: string;
}

const MINUTE = 60_000;

/** The elements on the clock, each with what it asks for at a tick and the element its tooltip goes on; one that has left the page is dropped at the next, and its surface puts it back on when it draws it again. */
const shown = new Map<HTMLElement, { later: () => Moment; tipOn: HTMLElement }>();
let clock: number | undefined;

/**
 * Draw `moment` into `el` now, and what `later` says at every tick from here while `el` is in the page; a second call for the same element replaces the first.
 * Its tooltip goes on `tipOn`, `el` itself unless a surface around it carries the tooltip, as a session row does.
 */
export function showMoment(el: HTMLElement, moment: Moment, later: () => Moment, tipOn: HTMLElement = el): void {
  draw(el, moment, tipOn);
  shown.set(el, { later, tipOn });
  clock ??= window.setInterval(tick, MINUTE);
}

/** Draw what `el` says now, off the clock, for a surface whose words around the moment changed while the moment did not; nothing for an element not on the clock. */
export function redrawMoment(el: HTMLElement): void {
  const entry = shown.get(el);
  if (entry) draw(el, entry.later(), entry.tipOn);
}

/** What else follows the clock, told after the moments are drawn at each tick (`onMinute`). */
const followers: (() => void)[] = [];

/** Call `follow` at every tick from here on, the one a change of the language forces included, after the moments on screen are drawn: for what goes out of date with the clock as a moment does, such as the session list's order (list.ts), so the two move together rather than on two timers. */
export function onMinute(follow: () => void): void {
  followers.push(follow);
  clock ??= window.setInterval(tick, MINUTE);
}

function tick(): void {
  for (const [el, { later, tipOn }] of shown) {
    if (el.isConnected) draw(el, later(), tipOn);
    else shown.delete(el);
  }
  for (const follow of followers) follow();
}

/** The words only where they changed, since most do not from one minute to the next. */
function draw(el: HTMLElement, { text, at, label, tooltip }: Moment, tipOn: HTMLElement): void {
  if (el.textContent !== text) el.textContent = text;
  setTooltip(tipOn, tooltip ?? (at && momentLine(label, at)));
}

/** A moment as one line of a tooltip: what it is and when, "Last active: Tue 3 Nov, 09:00". */
export function momentLine(label: string, at: string): string {
  return `${label}: ${momentInLanguage(Date.parse(at))}`;
}

onLanguageChange(tick);
