import { openMenu, type MenuItem } from '../../../menu';
import { store } from '../../../state/app';
import { projectGroups } from '../../../state/views';
import { chevronIcon, plusIcon } from '../../../svg';
import { setTooltip } from '../../../tooltip';
import { unavailable } from '../../../unavailable';
import { hostOf } from '../builtin';
import { projectFacts } from './drawn';
import './controls.css';

/**
 * THE SESSION LIST'S SHARED CONTROLS: the new-session split button a project's heading and a group's both carry, the marks it wears, and the items that start a session, which its caret and both headings' menus draw.
 * The kebab the headings and the rows carry is the menu's own (`kebabButton`, menu.ts).
 */

// The chrome marks — carets, +, ⋮, ✓, × — as SVG rather than the text glyphs they used to be.
// Every one of those resolved through system font fallback, which is how ⑂ ended up rendering from a MONOSPACE face beside its neighbours (see the family and worktree marks in svg.ts).
// These render the same whatever the system has installed, take their colour from `currentColor` like the other icons, and are drawn through `strokeIcon`, which keeps their weight equal at every size.
// Chevrons, not filled triangles: the collapse-all button already says fold/unfold with a chevron, and a solid triangle would be the only filled shape in an outline icon set.
const chevronDown = (size: number): string => chevronIcon('down', size);

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

/**
 * The ways to start a session in a project, filed in `groupId` when given: one list for the caret's dropdown and the project's and the group's menus, so the three cannot drift; the dropdown opens only while the folder is there, its caret being unavailable otherwise.
 * Each is there whether or not it can be taken, saying why not: the worktree one needs a git repository, and both a folder that is still there (`projectFacts`, as drawn).
 */
export function newSessionItems(repoRoot: string, groupId?: string): MenuItem[] {
  const facts = projectFacts.get(repoRoot);
  const gone = facts?.goneReason ?? null;
  const noWorktree = gone ?? (facts?.isRepo ? null : 'Not a git repository');
  return [
    gone ? { label: 'New session', disabled: gone } : { label: 'New session', onSelect: () => void hostOf('sessions').openNewSession(repoRoot, groupId) },
    noWorktree
      ? { label: 'New worktree session…', disabled: noWorktree }
      : { label: 'New worktree session…', onSelect: () => void hostOf('sessions').openWorktreeSession(repoRoot, groupId) },
  ];
}

/**
 * A new session in one of the project's groups, each a row of a submenu: every group the project has, including one a filter left without a heading (`projectGroups` reads no filter), which is the way to start in it then.
 * Plain sessions only; the group's own menu has the worktree one.
 */
export function newSessionInGroupItem(repoRoot: string): MenuItem {
  const label = 'New session in group';
  const gone = projectFacts.get(repoRoot)?.goneReason ?? null;
  if (gone) return { label, disabled: gone };
  const groups = projectGroups(repoRoot, store.get());
  if (groups.length === 0) return { label, disabled: 'This project has no groups' };
  return { label, submenu: groups.map((group) => ({ label: group.name, onSelect: () => void hostOf('sessions').openNewSession(repoRoot, group.id) })) };
}

// A heading's new-session split button: the "+" is one-click "New session"; the caret opens a dropdown with the worktree variant too.
// The caret is on every heading, and its worktree item says when it cannot be taken.
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
  setTooltip(addCaret, 'New session options');
  addCaret.addEventListener('click', (event) => {
    event.stopPropagation();
    if (unavailable(addCaret)) return;
    const at = where();
    if (!at) return;
    openMenu(addCaret, newSessionItems(at.repoRoot, at.groupId));
  });
  split.append(add, addCaret);
  return { split, add, addCaret };
}
