import type { Settings, UiState } from './types';

/**
 * What the app does before anyone has chosen otherwise: nothing added to the launch line, what was running when it closed brought back at launch marked as needing you, without starting, so it costs no process until you open it, PR status asked of GitHub, a stopped tab's button closing it, a session set aside tomorrow, in a week or whenever, back at 09:00, and times and dates in the system's language.
 * Under the settings file (shared/settings.ts); meta's `settings` falls back to the launch flags here.
 */
export function defaultSettings(): Settings {
  return { launchFlags: '', runningSessionsAtLaunch: 'cold', prStatus: true, leaveButton: 'stop-close', setAside: ['tomorrow', 'in 1w', 'whenever'], setAsideTime: '09:00', locale: '' };
}

/**
 * An unfiltered, unfolded sidebar at its default width: what a first run gets, and what any field missing from the stored object falls back to.
 * Main's (meta.ts reads the stored state over it); shared so that the window's checks start from the same first run rather than a copy of it.
 */
export function defaultUi(): UiState {
  return {
    search: '',
    filters: { pinned: false, open: false, live: false, setAside: false, worktree: false, gone: false, siblings: false, prs: false, noted: false, finished: false },
    datePreset: 'any',
    dateFrom: null,
    dateTo: null,
    filterPanelOpen: false,
    stripExpanded: true,
    stripHiddenProjects: [],
    tabBarExpanded: true,
    collapsedProjects: [],
    collapsedGroups: [],
    filterCollapsedProjects: [],
    filterCollapsedGroups: [],
    sidebarWidth: null,
    scrollTop: 0,
    panelState: { sizes: {}, collapsed: [], active: {} },
  };
}
