import type { NudgeStatus } from './logic';
import { badgeClass, sessionDotClass } from './statusdot';
import { chevronIcon, strokeIcon } from './svg';
import { setUnavailable } from './unavailable';
import './menu-row.css';
import './menu.css';

// A small floating kebab menu, generic over its items so the project-heading and session-row kebabs share the open/close/outside-click machinery.
// An item may carry a `submenu`: it then opens a child list on hover (one level deep) instead of running an action.

const tickIcon = (size: number): string => strokeIcon(size, '<path d="M3.5 8.4L6.6 11.5L12.5 4.9" />', 1.5);

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  submenu?: MenuItem[];
  /** Present on items in a pick-one list: shows a tick column, so the current choice is visible. */
  checked?: boolean;
  /** A rule instead of an item, splitting a list into groups of related actions. */
  separator?: boolean;
  /** A count for the thing the item names, right-aligned in its own column. */
  count?: number;
  /** A rolled-up status dot ahead of the label, in the column a tick would use. */
  badge?: NudgeStatus;
  /** An item that IS a session: its own dot ahead of the label, as its row draws it, in place of a roll-up's. */
  session?: { status: string | null; acked: boolean };
  /** Dims the label — used for "Ungrouped", which is a place rather than a named thing. */
  muted?: boolean;
  /**
   * The action exists but cannot be taken right now, with `disabled` saying why.
   * Kept in the list rather than dropped: a menu that changes SHAPE is one you have to re-read, and an action that silently disappears looks like it was never there — where a dimmed one with a reason answers the question you opened the menu to ask.
   */
  disabled?: string;
}
let openMenuEl: HTMLElement | null = null;
let openMenuAnchor: HTMLElement | null = null;
let openSubmenuEl: HTMLElement | null = null;
let openSubmenuOwner: HTMLElement | null = null;
function closeSubmenu(): void {
  openSubmenuEl?.remove();
  openSubmenuEl = null;
  openSubmenuOwner?.classList.remove('menu-open'); // parent row drops its held state
  openSubmenuOwner = null;
}
function closeMenu(): void {
  closeSubmenu();
  openMenuEl?.remove();
  openMenuEl = null;
  openMenuAnchor?.classList.remove('menu-open');
  openMenuAnchor = null;
  document.removeEventListener('click', onMenuOutside, true);
}
function onMenuOutside(event: MouseEvent): void {
  const target = event.target as Node;
  // A click on the trigger itself is left to its own handler (which toggles the menu shut); closing here too would close-then-reopen and the menu would never toggle off.
  // A click inside the open submenu counts as inside too, so it isn't dismissed before its own handler runs.
  if (
    openMenuEl &&
    !openMenuEl.contains(target) &&
    !openSubmenuEl?.contains(target) &&
    !openMenuAnchor?.contains(target)
  )
    closeMenu();
}

// Render `items` as buttons into `menu`.
// A leaf runs its onSelect and closes everything; a submenu-parent opens its child list on hover (and on click, for non-hover input).
// `isRoot` marks the top menu: only its leaves close an open submenu on hover — a submenu's own leaves must not, or hovering toward them would close the very submenu being reached for.
function fillMenu(menu: HTMLElement, items: MenuItem[], isRoot: boolean): void {
  for (const item of items) {
    if (item.separator) {
      const rule = document.createElement('div');
      rule.className = 'menu-separator';
      menu.append(rule);
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menu-row';
    button.textContent = item.label;
    if (item.disabled) {
      // Nothing is wired below: it takes no click and opens no submenu, and it carries the reason as its tooltip.
      setUnavailable(button, item.disabled);
      menu.append(button);
      continue;
    }
    // A row led by a status dot: a session's own, or the roll-up of something countable (a group, say), whose count then sits in its own column at the right; the label takes the room it needs and ellipsizes.
    if (item.count !== undefined || item.session) {
      button.classList.add('has-dot');
      const label = document.createElement('span');
      label.className = 'menu-item-label';
      label.textContent = item.label;
      if (item.muted) label.classList.add('muted');
      const dot = document.createElement('span');
      dot.className = item.session ? sessionDotClass(item.session.status, item.session.acked) : badgeClass(item.badge ?? null);
      button.textContent = '';
      button.append(dot, label);
      if (item.count !== undefined) {
        const count = document.createElement('span');
        count.className = 'menu-item-count';
        count.textContent = String(item.count);
        button.append(count);
      }
    }
    if (item.checked !== undefined) {
      // A fixed-width column, empty when unchecked, so every label in the list still lines up.
      const tick = document.createElement('span');
      tick.className = 'menu-tick';
      tick.innerHTML = item.checked ? tickIcon(11) : '';
      button.classList.add('has-tick');
      button.prepend(tick);
    }
    if (item.submenu) {
      button.className = 'menu-row has-submenu';
      const chev = document.createElement('span');
      chev.className = 'submenu-chev';
      chev.innerHTML = chevronIcon('right', 10);
      button.append(chev);
      const open = (): void => openSubmenu(button, item.submenu!);
      button.addEventListener('mouseenter', open);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        open();
      });
    } else {
      // Moving onto a sibling root leaf closes any open submenu; submenu leaves keep it open.
      if (isRoot) button.addEventListener('mouseenter', closeSubmenu);
      button.addEventListener('click', () => {
        closeMenu();
        item.onSelect?.();
      });
    }
    menu.append(button);
  }
}

// Open a child list beside its parent item; prefer the right, flip left when it would overflow.
function openSubmenu(item: HTMLElement, items: MenuItem[]): void {
  if (openSubmenuOwner === item) return; // already open for this item; don't rebuild/flicker
  closeSubmenu();
  const menu = document.createElement('div');
  menu.className = 'kebab-menu submenu';
  fillMenu(menu, items, false);
  document.body.append(menu);
  const r = item.getBoundingClientRect();
  const flipped = r.right + menu.offsetWidth + 8 > window.innerWidth;
  menu.classList.add(flipped ? 'attach-left' : 'attach-right');
  const left = flipped ? r.left - menu.offsetWidth - 5 : r.right + 5;
  const top = Math.max(8, Math.min(r.top, window.innerHeight - menu.offsetHeight - 8));
  menu.style.top = `${top}px`;
  menu.style.left = `${Math.max(8, left)}px`;
  // The notch points at the parent item's vertical center, clamped clear of the rounded corners.
  const notchY = Math.max(10, Math.min(r.top + r.height / 2 - top - 4, menu.offsetHeight - 18));
  menu.style.setProperty('--notch-y', `${notchY}px`);
  openSubmenuEl = menu;
  openSubmenuOwner = item;
  item.classList.add('menu-open'); // hold the parent row's active look while its submenu is up
}

export function openMenu(anchor: HTMLElement, items: MenuItem[]): void {
  // Clicking the same trigger again toggles the menu shut.
  if (openMenuAnchor === anchor) {
    closeMenu();
    return;
  }
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'kebab-menu';
  fillMenu(menu, items, true);
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  // Below the trigger, and above it when the menu would run off the bottom of the window and there is more room above — a row near the bottom of the list opened its menu half out of sight.
  const roomBelow = window.innerHeight - r.bottom - 5 - 8;
  const flipped = menu.offsetHeight > roomBelow && r.top - 5 - 8 > roomBelow;
  menu.classList.add(flipped ? 'attach-bottom' : 'attach-top');
  menu.style.top = `${flipped ? Math.max(8, r.top - 5 - menu.offsetHeight) : r.bottom + 5}px`;
  const left = Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8));
  menu.style.left = `${left}px`;
  // The notch points at the anchor's horizontal center, clamped clear of the rounded corners.
  const notchX = Math.max(10, Math.min(r.left + r.width / 2 - left - 4, menu.offsetWidth - 18));
  menu.style.setProperty('--notch-x', `${notchX}px`);
  openMenuEl = menu;
  openMenuAnchor = anchor;
  anchor.classList.add('menu-open'); // trigger shows an open/active state while its menu is up
  // Defer so the click that opened it doesn't immediately close it.
  setTimeout(() => document.addEventListener('click', onMenuOutside, true));
}
