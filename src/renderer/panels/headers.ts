import { needsShown } from '../status/shown';
import { badgeClass } from '../status/status-dot';
import { element } from '../ui/dom';
import { clockInLanguage } from '../ui/locale';
import { forgetMoment, momentLine, showMoment, type Moment } from '../ui/moments';
import { strokeIcon } from '../ui/svg';
import { relativeTime } from '../ui/time-words';
import { setTooltip } from '../ui/tooltip';
import type { PanelStatus, Refreshed } from './contract';
import type { HeaderTabs } from './tabs';

const REFRESH_ICON = strokeIcon(14, '<path d="M12.8 8.6A4.8 4.8 0 1 1 11.6 4.5" /><path d="M12.9 2.8v2.6h-2.6" />');
// Four corners pointing out, and back in: apart from the window's maximize square (chrome.ts), since a panel filling the window is not the window changing size.
const FULL_SCREEN_ICON = strokeIcon(14, '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />');
const BACK_TO_LAYOUT_ICON = strokeIcon(14, '<path d="M6 2.5V6H2.5M13.5 6H10V2.5M10 13.5V10h3.5M2.5 10H6v3.5" />');

/**
 * The rail dot, in the status dot's own states: `waiting` and `needs` in their looks, `needs` in the look of `look` where the panel names one, `failed` for a run that did not end well.
 * Any look draws here as a filled dot of its colour, never its icon or ring (looks.ts): an icon on an icon's corner would read as neither.
 */
export function showStatus(badge: HTMLElement, status: PanelStatus, look?: string): void {
  badge.className = badgeClass(status === 'wait' ? 'waiting' : status === 'needs' ? (look === undefined ? 'needs' : needsShown(look)) : status === 'fail' ? 'failed' : null);
  badge.hidden = status === null;
}

/** The header's one button, in the compact box: the header takes the tab bar's density, and a standard box made it taller than a header without one. */
export function actionButton(label: string): HTMLButtonElement {
  const button = element('button', 'icon-btn compact');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  setTooltip(button, label);
  button.innerHTML = REFRESH_ICON;
  return button;
}

/**
 * The header's time beside its button: how long ago what the panel shows came from a run, on the clock every "x ago" ages on, with the moment in full in its tooltip, and the failed run after it where one failed since.
 * The button's tooltip gives the moment too, as the one place it stays when a narrow header drops the time (`fitHeader`); it is set with each drawing of the time, so a change of the language reaches both.
 */
export function drawRefreshed(time: HTMLElement, action: HTMLButtonElement | null, refreshed: Refreshed | null): void {
  if (refreshed === null) {
    time.hidden = true;
    forgetMoment(time);
    if (action) setTooltip(action, action.getAttribute('aria-label'));
    return;
  }
  const at = refreshed.at.toISOString();
  const moment = (): Moment => {
    if (action) setTooltip(action, `${action.getAttribute('aria-label') ?? ''}\n${momentLine('Last refreshed', at)}`);
    const failed = refreshed.failedAt ? [`The run at ${clockInLanguage(refreshed.failedAt)} failed`] : [];
    return { text: relativeTime(at), at, label: 'Refreshed', tooltip: [momentLine('Refreshed', at), ...failed].join('\n') };
  };
  time.hidden = false;
  showMoment(time, moment(), moment);
}

/** Drop the header's time while its title would be cut beside it, so the title gives way last; Refresh's tooltip still gives the time. */
function fitHeader(row: HTMLElement): void {
  const title = row.querySelector<HTMLElement>(':scope > .panel-title');
  const time = row.querySelector<HTMLElement>(':scope > .panel-refreshed');
  if (!title || !time) return;
  time.classList.remove('dropped');
  if (title.scrollWidth > title.clientWidth) time.classList.add('dropped');
}

/** Fit a header again whenever it or its title changes size: the header with the window, the title as the time beside it grows a word. */
const headerSizes = new ResizeObserver((entries) => {
  for (const { target } of entries) {
    const row = target.closest<HTMLElement>('.panel-header');
    if (row?.isConnected) fitHeader(row);
  }
});

/** What `headerSizes` watches: one observer for every header, since the tree builds a new header at each draw, so the ones gone from the page are let go once a draw is done (`letGoOfGone`). */
const watched = new Set<Element>();
let letGoQueued = false;

/** Stop watching the headers no longer in the page; run after the task that drew the tree, since a header is built before its place in the page is. */
function letGoOfGone(): void {
  letGoQueued = false;
  for (const el of watched) {
    if (el.isConnected) continue;
    headerSizes.unobserve(el);
    watched.delete(el);
  }
}

/** Keep `row`'s time dropped while its title would be cut beside it (`fitHeader`). */
export function watchHeaderFit(row: HTMLElement): void {
  if (!letGoQueued) {
    letGoQueued = true;
    queueMicrotask(letGoOfGone);
  }
  const title = row.querySelector(':scope > .panel-title');
  for (const el of title ? [row, title] : [row]) {
    headerSizes.observe(el);
    watched.add(el);
  }
}

/** The full-screen button as it stands: pressed, saying the way back, while its panel fills the window. */
export function drawFullScreenButton(button: HTMLButtonElement, on: boolean): void {
  const label = on ? 'Back to the layout' : 'Full screen';
  if (button.getAttribute('aria-label') === label) return;
  button.innerHTML = on ? BACK_TO_LAYOUT_ICON : FULL_SCREEN_ICON;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(on));
  setTooltip(button, label);
}

export function header(title: string, controls: HTMLElement[] = []): HTMLElement {
  const row = element('div', 'panel-header');
  const heading = element('span', 'panel-title');
  heading.textContent = title;
  setTooltip(heading, title);
  row.append(heading, ...controls);
  return row;
}

/** A header whose panel has tabs: the tabs where the title would be, then its controls, and the tabs' fold on its bottom line (panels/tabs.ts). */
export function tabsHeader(tabs: HeaderTabs, controls: HTMLElement[]): HTMLElement {
  const row = element('div', 'panel-header with-tabs');
  row.append(tabs.el, ...controls, tabs.foldButton);
  return row;
}

/** A panel or node that cannot be drawn says why, one sentence per line, where its content would be. */
export function problemList(problems: string[]): HTMLElement {
  const box = element('div', 'panel-problems');
  for (const problem of problems) {
    const line = element('p');
    line.textContent = problem;
    box.appendChild(line);
  }
  return box;
}

/** What the app did in the file's place, or does not honour yet, under the node it is about. */
export function notesLine(notes: string[]): HTMLElement {
  const box = element('div', 'panel-note');
  for (const note of notes) {
    const line = element('div');
    line.textContent = note;
    box.appendChild(line);
  }
  return box;
}
