import { openMenu, type MenuItem } from '../../../menu';
import { chevronIcon, strokeIcon } from '../../../svg';
import { setTooltip } from '../../../tooltip';
import { unavailable } from '../../../unavailable';
import { hostOf } from '../builtin';
import './controls.css';

/**
 * THE SESSION LIST'S SHARED CONTROLS: the kebab the headings and the rows both carry, the new-session split button a project's heading and a group's both carry, and the marks they wear.
 */

// The chrome marks — carets, +, ⋮, ✓, × — as SVG rather than the text glyphs they used to be.
// Every one of those resolved through system font fallback, which is how ⑂ ended up rendering from a MONOSPACE face beside its neighbours (see the family and worktree marks in svg.ts).
// These render the same whatever the system has installed, take their colour from `currentColor` like the other icons, and are drawn through `strokeIcon`, which keeps their weight equal at every size.
// Chevrons, not filled triangles: the collapse-all button already says fold/unfold with a chevron, and a solid triangle would be the only filled shape in an outline icon set.
const chevronDown = (size: number): string => chevronIcon('down', size);
const plusIcon = (size: number): string => strokeIcon(size, '<path d="M8 3.5V12.5M3.5 8H12.5" />');
// Dots, so it stays a kebab rather than becoming a dashed line. The radius is in px for the same reason the stroke is: three 2.6px dots whatever the button's size.
const kebabIcon = (size: number): string => {
  const r = ((1.3 * 16) / size).toFixed(2);
  return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="currentColor"><circle cx="8" cy="3.4" r="${r}" /><circle cx="8" cy="8" r="${r}" /><circle cx="8" cy="12.6" r="${r}" /></svg>`;
};

/**
 * A kebab: the options behind a ⋮, listed afresh at each click by `items`, which answers null when there is nothing to offer.
 * The click goes no further, so it neither folds a heading nor opens a row.
 */
export function kebabButton(className: string, tooltip: string, items: () => MenuItem[] | null): HTMLButtonElement {
  const kebab = document.createElement('button');
  kebab.className = `icon-btn ${className}`;
  kebab.innerHTML = kebabIcon(14);
  setTooltip(kebab, tooltip);
  kebab.addEventListener('click', (event) => {
    event.stopPropagation();
    const menu = items();
    if (menu) openMenu(kebab, menu);
  });
  return kebab;
}

interface NewSessionSplit {
  /** The class of the "+" and of the caret, which the heading's stylesheet sizes. */
  addClass: string;
  caretClass: string;
  /** The project heading's "+" is a 12px mark in a filled box, the group's a 14px one in a standard box (list.css). */
  plusSize: number;
  tooltip: string;
  /** Where to start a session at the click: the project's folder, and the group to file it in; null when there is none any more. */
  where: () => { repoRoot: string; groupId?: string } | null;
}

// A heading's new-session split button: the "+" is one-click "New session"; the caret opens a dropdown with the worktree variant too. reconcileProjectSections shows the caret only for git repos.
export function newSessionSplit({ addClass, caretClass, plusSize, tooltip, where }: NewSessionSplit): { split: HTMLElement; add: HTMLButtonElement; addCaret: HTMLButtonElement } {
  const split = document.createElement('div');
  split.className = 'split-button';
  const add = document.createElement('button');
  add.className = `icon-btn composite ${addClass}`;
  add.innerHTML = plusIcon(plusSize);
  setTooltip(add, tooltip);
  add.addEventListener('click', (event) => {
    event.stopPropagation();
    if (unavailable(add)) return; // aria-disabled still delivers the click, which is the trade for a tooltip that works
    const at = where();
    if (at) void hostOf('sessions').openNewSession(at.repoRoot, at.groupId);
  });
  const addCaret = document.createElement('button');
  addCaret.className = `icon-btn composite ${caretClass}`;
  addCaret.innerHTML = chevronDown(9);
  addCaret.hidden = true;
  setTooltip(addCaret, 'New session options');
  addCaret.addEventListener('click', (event) => {
    event.stopPropagation();
    if (unavailable(addCaret)) return;
    const at = where();
    if (!at) return;
    openMenu(addCaret, [
      { label: 'New session', onSelect: () => void hostOf('sessions').openNewSession(at.repoRoot, at.groupId) },
      { label: 'New worktree session…', onSelect: () => void hostOf('sessions').openWorktreeSession(at.repoRoot, at.groupId) },
    ]);
  });
  split.append(add, addCaret);
  return { split, add, addCaret };
}
