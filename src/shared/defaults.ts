import type { Settings, UiState } from './types';

/**
 * What the app does before anyone has chosen otherwise: nothing added to the launch line.
 * Under both settings files (shared/settings.ts), and what meta's `settings` falls back to.
 */
export function defaultSettings(): Settings {
  return { launchFlags: '' };
}

/**
 * An unfiltered, unfolded sidebar at its default width: what a first run gets, and what any field missing from the stored object falls back to.
 * Main's (meta.ts reads the stored state over it); shared so that the window's checks start from the same first run rather than a copy of it.
 */
export function defaultUi(): UiState {
  return {
    search: '',
    filters: { pinned: false, open: false, live: false, worktree: false, gone: false, siblings: false, noted: false, archived: false },
    datePreset: 'any',
    dateFrom: null,
    dateTo: null,
    filterPanelOpen: false,
    stripExpanded: true,
    collapsedProjects: [],
    collapsedGroups: [],
    filterCollapsedProjects: [],
    filterCollapsedGroups: [],
    sidebarWidth: null,
    scrollTop: 0,
    panelState: { sizes: {}, collapsed: [], active: {} },
  };
}
