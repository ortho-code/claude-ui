import type { UiState } from '../../../../shared/types';
import { store, type StoredView, type View } from '../../../state/app';
import { isFiltering } from '../../../state/views';
import { restoreFilter } from './filter';
import { container } from './drawn';

/**
 * The sidebar's part of the view kept for the next launch — the filter, the folds, the panel, the strip and the list's scroll — in the shape `UiState` stores it, and putting it back.
 * The window's saving (view-saving.ts) composes it with the layout tree's part, so `meta.json` keeps the one shape it has.
 */

/** The sidebar's fields of the stored view, as they are now. */
export function sidebarSnapshot(view: StoredView = store.get()): Omit<UiState, 'sidebarWidth' | 'panelState'> {
  const { folds } = view;
  return {
    // The search as typed, not the trimmed and lowercased text it matches: what is restored has to be what was typed.
    ...view.filter,
    filterPanelOpen: view.filterPanelOpen,
    footerExpanded: view.footerExpanded,
    collapsedProjects: [...folds.projects],
    collapsedGroups: [...folds.groups],
    filterCollapsedProjects: [...folds.filterProjects],
    filterCollapsedGroups: [...folds.filterGroups],
    scrollTop: container.scrollTop,
  };
}

/**
 * Put the sidebar back as it was stored: the filter's controls now (`restoreFilter`), and hand back the view the start-up read sets in the store with the listing, and the scroll to apply once there is a list to scroll.
 * A deleted group's fold comes back too, and goes once the groups have been read (`forgetDeletedGroupFolds`).
 */
export async function restoreSidebar(state: UiState): Promise<{ scrollTop: number; view: StoredView }> {
  const filter = await restoreFilter(state);
  // The folds made under a filter apply only while it is on, so a filter stored off leaves them behind.
  const underFilter = isFiltering({ filter });
  const view: StoredView = {
    filter,
    folds: {
      projects: new Set(state.collapsedProjects),
      groups: new Set(state.collapsedGroups),
      filterProjects: new Set(underFilter ? state.filterCollapsedProjects : []),
      filterGroups: new Set(underFilter ? state.filterCollapsedGroups : []),
    },
    // Exactly as it was left, an active filter included.
    // Closing the panel over a filter you have deliberately left on is a choice to keep the results and reclaim the space; a shut panel folds down to chips naming what is on, so the list never passes for the whole one.
    filterPanelOpen: state.filterPanelOpen,
    footerExpanded: state.footerExpanded,
  };
  return { scrollTop: state.scrollTop, view };
}

/** Put the list back where it was scrolled, once start-up has drawn the rows there are to scroll (`restoreSidebar` hands the offset back for that). */
export function restoreListScroll(scrollTop: number): void {
  container.scrollTop = scrollTop;
}

/** Call `persist` on every scroll of the list: the store does not hold the scroll, so nothing else tells the saving it moved. */
export function followListScroll(persist: () => void): void {
  container.addEventListener('scroll', persist);
}

/**
 * A project keeps its fold even while it has no sessions to show (same reasoning as the project order), but a DELETED group is gone for good.
 * The folds come back with the groups' first read, so the list's first draw is already the one you left; a fold of a group that is gone draws nothing meanwhile.
 */
export function forgetDeletedGroupFolds({ groupState, folds }: View<'groupState' | 'folds'>): void {
  const live = new Set(groupState.groups.map((g) => g.id));
  const alive = (ids: ReadonlySet<string>): ReadonlySet<string> => new Set([...ids].filter((id) => live.has(id)));
  store.set({ folds: { ...folds, groups: alive(folds.groups), filterGroups: alive(folds.filterGroups) } });
}
