import Sortable from 'sortablejs';
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
    if (items) openMenu(kebab, items, () => actions.menu());
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

/** What a drag of tabs tells the surface that owns the row it started in. */
interface DragEnds {
  start(): void;
  end(event: Sortable.SortableEvent): void;
}

/** Whether a drag of tabs is under way, in any row of any surface. */
let dragging = false;

/**
 * Rows' Sortables whose rows went while a drag was under way, destroyed once it ends.
 * A Sortable destroyed during a drag, even another surface's, ends that drag in the library without its end reaching anyone, leaving the dragged tab marked and its copy on screen, and the surface that owns it holding its draws for good (seen when the tab bar dropped a row during a drag of a panel's tab).
 */
const destroyLater: Sortable[] = [];

/** Let go of a row's Sortable: at once, or once the drag under way has ended. */
export function dropSortable(sortable: Sortable): void {
  if (dragging) destroyLater.push(sortable);
  else sortable.destroy();
}

/**
 * Drag to reorder the tabs in `row`, one Sortable per row; none names a group, so none takes a drop from another, and a drag stays inside its row.
 * `start` and `end` are the owner's: while a drag is under way the library moves the tabs itself, so the owner holds its draws until `end`.
 * Made with its row, and let go of when the row goes through `dropSortable`, never destroyed directly.
 */
export function sortableTabs(row: HTMLElement, on: DragEnds): Sortable {
  return Sortable.create(row, {
    draggable: '.tab', // never a row's label
    // The tab's buttons, its close and its kebab, are not drag handles.
    // Without this, a mousedown on one starts a potential drag, and `forceFallback` then calls preventDefault to take over pointer handling — after which Chromium on macOS never synthesises the click, so closing a tab silently did nothing there.
    // It survived on Linux, which is why this only appeared once the app reached a Mac.
    // preventOnFilter: false is the half that matters: the default (true) still preventDefaults on the filtered element, which is the very thing that swallows the click.
    filter: '.tab-close, .tab-kebab',
    preventOnFilter: false,
    // Pointer-based dragging instead of native HTML5 DnD, which is flaky under WSLg.
    forceFallback: true,
    // A press that wanders a pixel or two is a click: with Sortable's default of 0, any movement at all started a drag, and the tab was never chosen.
    fallbackTolerance: 4,
    animation: 0,
    ghostClass: 'tab-ghost',
    onStart: () => {
      dragging = true;
      on.start();
    },
    onEnd: (event) => {
      dragging = false;
      on.end(event);
      for (const sortable of destroyLater.splice(0)) sortable.destroy();
    },
  });
}

// Alt-tabbing away mid-drag never delivers a pointerup, so SortableJS can leave a drag stuck.
// On blur, synthesise the release so it ends cleanly (dropping the tab where it currently is).
window.addEventListener('blur', () => {
  if (!dragging) return;
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
});

/** Draw a tab as `look` says. */
export function drawTab({ el, label, kebab, button }: TabEls, look: TabLook): void {
  el.className = ['tab', look.active ? 'active' : '', look.cold ? 'cold' : '', ...(look.classes ?? [])].filter(Boolean).join(' ');
  label.textContent = look.text;
  setTooltip(label, look.tooltip);
  setUnavailable(button, look.button.disabled ? look.button.tooltip : null, look.button.tooltip);
  setMarkup(button, tabButtonIcon(look.button.mark, 14));
  // What it was drawn as, as the strip's button says it, so the two can be told by more than their ink.
  button.dataset.mark = look.button.mark;
  placeChildren(el, [...look.lead, label, kebab, button]);
}
