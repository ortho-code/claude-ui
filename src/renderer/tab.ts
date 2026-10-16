import { element } from './dom';
import { placeChildren, setMarkup } from './keyed';
import type { TabButtonMark } from './logic';
import { kebabButton, openMenu, type MenuItem } from './menu';
import { tabButtonIcon } from './svg';
import { setTooltip } from './tooltip';
import { setUnavailable, unavailable } from './unavailable';
import './tab.css';

/**
 * A TAB: what leads its label, the label, then a kebab and a button as one pair at its end; filled and edged while it is on show, unfilled while its owner says nothing runs behind it (`cold`).
 * What a tab does is its owner's, handed in when it is built.
 * What it shows each draw writes into its elements without building them again (`drawTab`), so a tab its owner keeps from one draw to the next (`Keyed`, keyed.ts) keeps a press on it.
 */

/** A tab's elements, built once. */
export interface TabEls {
  el: HTMLElement;
  label: HTMLElement;
  kebab: HTMLButtonElement;
  button: HTMLButtonElement;
}

/** What a tab does, which its owner answers for whatever the tab holds at the press. */
export interface TabActions {
  /** A click on the tab. */
  select(): void;
  /**
   * Its button, and a middle-click on the tab, so that a middle-click takes no quicker way out than the button.
   * The middle-click skips the check the button makes of whether it can act now, so `press` itself refuses whatever the button would.
   */
  press(): void;
  /** Its kebab's menu, listed afresh at each press; null for nothing to offer. */
  menu(): MenuItem[] | null;
  /** What the kebab says it holds, for its tooltip and a screen reader. */
  kebabLabel: string;
}

/** A tab, built once: a click on its button never selects the tab, and a right-click on the tab opens its kebab's menu, anchored on the kebab. */
export function buildTab(actions: TabActions): TabEls {
  const el = element('div');
  const label = element('span', 'tab-label');
  const kebab = kebabButton('compact tab-kebab abuts', actions.kebabLabel, () => actions.menu());
  const button = element('button', 'icon-btn compact tab-close');
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (unavailable(button)) return;
    actions.press();
  });
  el.addEventListener('click', () => actions.select());
  el.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const items = actions.menu();
    if (items) openMenu(kebab, items);
  });
  el.addEventListener('mousedown', (event) => {
    if (event.button !== 1) return;
    event.preventDefault();
    actions.press();
  });
  return { el, label, kebab, button };
}

/** How a tab looks at one draw. */
export interface TabLook {
  /** It is the one on show. */
  active: boolean;
  /** Nothing runs behind it. */
  cold: boolean;
  /** Its owner's own states, as classes. */
  classes?: string[];
  text: string;
  tooltip: string | null;
  /** Its button: which mark, the tooltip, and whether it can act now. */
  button: { mark: TabButtonMark; tooltip: string; disabled: boolean };
  /** What leads the label, such as a status dot, in order. */
  lead: readonly HTMLElement[];
}

/** Draw a tab as `look` says. */
export function drawTab({ el, label, kebab, button }: TabEls, look: TabLook): void {
  el.className = ['tab', look.active ? 'active' : '', look.cold ? 'cold' : '', ...(look.classes ?? [])].filter(Boolean).join(' ');
  label.textContent = look.text;
  setTooltip(label, look.tooltip);
  setUnavailable(button, look.button.disabled ? look.button.tooltip : null, look.button.tooltip);
  setMarkup(button, tabButtonIcon(look.button.mark, 14));
  placeChildren(el, [...look.lead, label, kebab, button]);
}
