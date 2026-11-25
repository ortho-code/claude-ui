import { notchAt } from './menu';
import { closeIcon } from './svg';
import './popover.css';
import './side-popover.css';

/**
 * A SIDE POPOVER — a wide surface opened beside the panel that asked for it, toward the side with room, over the panel there, for content too big for a menu: the session list's filters first.
 * One per use, made by `sidePopover`; it holds whatever nodes its opener gives it, so a page of the guide can be one more kind of content rather than a second popover.
 * Shut only deliberately, by its ×, its opener again, or Esc, since it is something to work from: a press outside it, such as in the field it helps with, leaves it open, and a change of the window's size moves it rather than shutting it.
 */
export interface SidePopover {
  readonly el: HTMLElement;
  /** Open beside `beside`, pointing at `anchor`, filled by `content`; shut it when it is already open for `anchor`. */
  toggle(anchor: HTMLElement, beside: HTMLElement, content: () => Node[]): void;
  close(): void;
}

/** The widest it opens, the narrowest it opens beside a panel, and how far it keeps from the panel beside it and from the window's edges. */
const WIDTH = 500;
const MIN_WIDTH = 280;
const GAP = 8;
const MARGIN = 8;

/** Where it stands across: its left edge and width, and the side of the panel it is attached to, or null over the panel itself. */
interface Across {
  left: number;
  width: number;
  side: 'right' | 'left' | null;
}

/** Beside the panel on the side with more room; over the panel itself, against its right edge, when neither side has `MIN_WIDTH`, as when the panel fills the window. */
function across(panel: DOMRect): Across {
  const roomRight = window.innerWidth - panel.right - GAP - MARGIN;
  const roomLeft = panel.left - GAP - MARGIN;
  const room = Math.max(roomRight, roomLeft);
  if (room < MIN_WIDTH) {
    const width = Math.max(0, Math.min(WIDTH, panel.width - 2 * MARGIN));
    return { left: panel.right - MARGIN - width, width, side: null };
  }
  const width = Math.min(WIDTH, room);
  return roomRight >= roomLeft ? { left: panel.right + GAP, width, side: 'right' } : { left: panel.left - GAP - width, width, side: 'left' };
}

/** Place the popover beside `beside`, its top at the anchor's, its notch pointing at the anchor when it stands beside the panel. */
function place(el: HTMLElement, anchor: HTMLElement, beside: HTMLElement): void {
  const at = anchor.getBoundingClientRect();
  const { left, width, side } = across(beside.getBoundingClientRect());
  el.classList.toggle('attach-right', side === 'right');
  el.classList.toggle('attach-left', side === 'left');
  el.style.width = `${width}px`;
  el.style.left = `${left}px`;
  const top = Math.max(MARGIN, Math.min(at.top, window.innerHeight - MARGIN - 120));
  el.style.top = `${top}px`;
  el.style.maxHeight = `${window.innerHeight - top - MARGIN}px`;
  el.style.setProperty('--notch-y', `${notchAt(at.top + at.height / 2, top, parseFloat(getComputedStyle(el).borderTopWidth), el.offsetHeight)}px`);
}

/** A side popover with its own id and label, attached to the page and shut until opened; `onChange` hears it open and shut, whatever shut it. */
export function sidePopover(id: string, label: string, onChange?: (open: boolean) => void): SidePopover {
  const el = document.createElement('div');
  el.id = id;
  el.className = 'side-popover popover';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', label);
  el.hidden = true;
  // The content scrolls inside, so the notch, which stands out of the popover's edge, is never clipped, as a menu's list does (menu.ts).
  const body = document.createElement('div');
  body.className = 'side-popover-body';
  const shut = document.createElement('button');
  shut.type = 'button';
  shut.className = 'icon-btn side-popover-close';
  shut.setAttribute('aria-label', 'Close');
  shut.dataset.tooltip = 'Close';
  shut.innerHTML = closeIcon(12);
  el.append(shut, body);
  document.body.append(el);
  let owner: HTMLElement | null = null;
  let besideOf: HTMLElement | null = null;

  const close = (): void => {
    if (owner) onChange?.(false);
    el.hidden = true;
    owner?.setAttribute('aria-expanded', 'false');
    // The look every icon button wears while what it opened is up (base.css).
    owner?.classList.remove('menu-open');
    owner = null;
    besideOf = null;
  };

  shut.addEventListener('click', close);
  // On the window, which the key reaches after every listener on the document, so one that steps aside for an open popover, such as bulk mode's Esc, still finds it open.
  window.addEventListener('keydown', (event) => {
    if (owner && event.key === 'Escape') close();
  });
  window.addEventListener('resize', () => {
    if (owner && besideOf) place(el, owner, besideOf);
  });

  return {
    el,
    close,
    toggle(anchor, beside, content) {
      if (owner === anchor) {
        close();
        return;
      }
      close();
      body.replaceChildren(...content());
      el.hidden = false;
      place(el, anchor, beside);
      owner = anchor;
      besideOf = beside;
      anchor.setAttribute('aria-expanded', 'true');
      anchor.classList.add('menu-open');
      onChange?.(true);
    },
  };
}
