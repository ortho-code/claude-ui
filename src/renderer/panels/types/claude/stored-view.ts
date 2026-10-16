import type { UiState } from '../../../../shared/types';
import type { StoredView } from '../../../state/app';

/**
 * The terminal area's part of the view kept for the next launch — the tab bar's fold — in the shape `UiState` stores it, and putting it back.
 * The window's saving (view-saving.ts) composes it with the sidebar's part (sessions/stored-view.ts) and the layout tree's, so `meta.json` keeps the one shape it has.
 */

/** The terminal area's fields of the stored view, as they are now. */
export function terminalAreaSnapshot(view: Pick<StoredView, 'tabBarExpanded'>): Pick<UiState, 'tabBarExpanded'> {
  return { tabBarExpanded: view.tabBarExpanded };
}

/** The terminal area's fields as they were stored, for the start-up read to set in the store with the rest of the view. */
export function restoreTerminalArea(state: UiState): Pick<StoredView, 'tabBarExpanded'> {
  return { tabBarExpanded: state.tabBarExpanded };
}
