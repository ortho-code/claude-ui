import { setFolded } from '../../../card';
import { fromMarkup } from '../../../dom';
import { store, type View } from '../../../state/app';
import { foldedGroups, foldedProjects, foldsWith } from '../../../state/folds';
import { isFiltering } from '../../../state/views';
import { strokeIcon } from '../../../svg';
import { setTooltip } from '../../../tooltip';
import { groupSections, projectSections, renderedSections } from './drawn';
import './folding.css';

/**
 * THE SESSION LIST'S FOLDS: a heading's fold, the reveals' unfold, collapse-all, and the sections on screen folded as the folds say, for each draw and for each change of the folds (`foldsFollow`, which the list registers in `watchList`).
 * Every fold is a write of the store's `folds`, and only `applyFolds` draws one, so nothing that folds needs to draw the list.
 */

/** Collapse-all, built here and placed by the sidebar (index.ts) in its header. */
export const collapseToggle = fromMarkup(`<button id="collapse-toggle" class="icon-btn large" data-tooltip="Collapse all" aria-label="Collapse all"></button>`, HTMLButtonElement);

/**
 * Open a folded project or group, for a reveal or a jump, which then measure where it is.
 * The folds' watcher opens it as it is told (`foldsFollow`), so neither may run inside a batch, which would tell it only afterwards.
 */
export function unfold(kind: 'projects' | 'groups', key: string): void {
  const state = store.get();
  if ((kind === 'projects' ? foldedProjects(state) : foldedGroups(state)).has(key)) store.set({ folds: foldsWith(state, kind, [key], false) });
}

/**
 * Fold or unfold a section: the folds' watcher hides its rows and turns its caret in place (`foldsFollow`), and saving follows the folds.
 * Neither heading's click draws the list — no flicker, no scroll jump.
 */
export function toggleFold(kind: 'projects' | 'groups', key: string): void {
  const state = store.get();
  const collapsed = !(kind === 'projects' ? foldedProjects(state) : foldedGroups(state)).has(key);
  store.set({ folds: foldsWith(state, kind, [key], collapsed) });
}

/** Fold or open every section on screen as the folds in play say: for each draw, and for each change of the folds (`foldsFollow`). */
export function applyFolds(view: View<'folds' | 'filter' | 'activeProject'>): void {
  const { activeProject } = view;
  for (const [repoRoot, els] of projectSections) {
    // While filtering, force projects open so matches inside a collapsed one are visible; the stored collapse state is left untouched, so it returns when the filter clears.
    const collapsed = activeProject === null && foldedProjects(view).has(repoRoot);
    els.section.classList.toggle('collapsed', collapsed);
    // A project view can't collapse its one project, so it shows no caret and no clickable styling.
    els.section.classList.toggle('no-collapse', activeProject !== null);
    els.caret.hidden = activeProject !== null;
    setFolded(els.caret, collapsed);
  }
  for (const [id, els] of groupSections) {
    const collapsed = foldedGroups(view).has(id);
    els.section.classList.toggle('collapsed', collapsed);
    setFolded(els.caret, collapsed);
  }
}

/**
 * The folds changed: every section on screen folds or opens in place (`applyFolds`), and collapse-all says what it will do now.
 * Not the list: a fold hides rows that are already drawn, and drawing them all again would cost a heading's click its stillness.
 */
export function foldsFollow(view: View<'folds' | 'filter' | 'activeProject'>): void {
  applyFolds(view);
  updateCollapseToggle(view);
}

// Chevrons stacked in the direction things will move: up to fold everything away, down to open it again. Ink centred on 8,8 like the row icons, so the glyph sits square in its button.
const COLLAPSE_ALL_ICON = strokeIcon(14, '<path d="M4 7.25L8 3.75L12 7.25" /><path d="M4 12.25L8 8.75L12 12.25" />');
const EXPAND_ALL_ICON = strokeIcon(14, '<path d="M4 3.75L8 7.25L12 3.75" /><path d="M4 8.75L8 12.25L12 8.75" />');

// What the button folds depends on the view.
// In All it folds the project sections (keyed on projects alone: with every project shut its groups are out of sight anyway).
// In a single-project view folding the one project you asked to look at is pointless, so it folds THAT project's groups instead.
function collapseScope(view: View<'activeProject' | 'filter' | 'folds'>): { kind: 'projects' | 'groups'; ids: string[]; collapsed: ReadonlySet<string> } {
  return view.activeProject === null
    ? { kind: 'projects', ids: renderedSections.projects, collapsed: foldedProjects(view) }
    : { kind: 'groups', ids: renderedSections.groups, collapsed: foldedGroups(view) };
}

// Everything in scope folded away already? Then the button offers the way back instead.
function allSectionsCollapsed(view: View<'activeProject' | 'filter' | 'folds'>): boolean {
  const { ids, collapsed } = collapseScope(view);
  return ids.length > 0 && ids.every((id) => collapsed.has(id));
}

export function updateCollapseToggle(view: View<'activeProject' | 'filter' | 'folds'>): void {
  // Filtering forces every section open (so matches inside a collapsed one are visible), which leaves this nothing to act on.
  // Disabled rather than hidden, since a control vanishing as you type reads worse than one plainly unavailable.
  collapseToggle.disabled = isFiltering(view) || collapseScope(view).ids.length === 0;
  const label = allSectionsCollapsed(view) ? 'Expand all' : 'Collapse all';
  collapseToggle.innerHTML = allSectionsCollapsed(view) ? EXPAND_ALL_ICON : COLLAPSE_ALL_ICON;
  setTooltip(collapseToggle, label);
  collapseToggle.setAttribute('aria-label', label);
}

// Collapsing takes the groups with it, so expanding a project afterwards shows its group headings rather than dumping every row back at once — two levels of overview instead of one.
collapseToggle.addEventListener('click', () => {
  const state = store.get();
  const { kind, ids } = collapseScope(state);
  const expanding = allSectionsCollapsed(state);
  let folds = foldsWith(state, kind, ids, !expanding);
  // In the All view a project's groups fold along with it, so expanding one afterwards shows its group headings rather than dumping every row back. In a project view the groups ARE the scope already.
  if (state.activeProject === null) {
    const next = { ...state, folds };
    folds = expanding ? foldsWith(next, 'groups', foldedGroups(next), false) : foldsWith(next, 'groups', renderedSections.groups, true);
  }
  store.set({ folds });
});
