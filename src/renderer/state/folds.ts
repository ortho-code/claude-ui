import { store, type Folds, type View } from './app';
import { isFiltering } from './views';

/**
 * The folds both of the sidebar's surfaces write: the session list's headings, collapse-all and reveals, and the switcher opening a project as it is chosen.
 * Which of the two pairs in `Folds` is in play is decided here, once, so a read and a write can never take different pairs.
 */

/** The fold sets in play right now: the transient pair while filtering, the stored pair otherwise (`Folds`). Every read and every write goes through these, so the two can never be mixed up. */
export function foldedProjects(view: View<'filter' | 'folds'> = store.get()): ReadonlySet<string> {
  return isFiltering(view) ? view.folds.filterProjects : view.folds.projects;
}
export function foldedGroups(view: View<'filter' | 'folds'> = store.get()): ReadonlySet<string> {
  return isFiltering(view) ? view.folds.filterGroups : view.folds.groups;
}

/** The folds with `keys` of one kind folded, or opened, in the pair in play. */
export function foldsWith(view: View<'filter' | 'folds'>, kind: 'projects' | 'groups', keys: Iterable<string>, folded: boolean): Folds {
  const field: keyof Folds = !isFiltering(view) ? kind : kind === 'projects' ? 'filterProjects' : 'filterGroups';
  const next = new Set(view.folds[field]);
  for (const key of keys) {
    if (folded) next.add(key);
    else next.delete(key);
  }
  return { ...view.folds, [field]: next };
}
