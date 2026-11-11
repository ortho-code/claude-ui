import { DEFAULT_STRENGTH } from '../status/looks';
import type { Settings, UiState } from '../types';

/**
 * What the app does before anyone has chosen otherwise: nothing added to the launch line, what was running when it closed brought back at launch marked as needing you, without starting, so it costs no process until you open it, PR status asked of GitHub, a stopped tab's button closing it, Undo starting claude again in a tab it brings back whose claude the close or the finish ended, a running claude asked to leave and its tab closed when its session is set aside, a session set aside tomorrow, in a week or whenever, back at 09:00, times and dates in the system's language, and a dot showing claude waiting or working over a needs-you mark, the mark over claude ready, every dot drawn in its look of before looks could be set, every needs-you category and type as the app ships it, and a PR approved when GitHub says so.
 * Under the settings file (shared/config/settings.ts); meta's `settings` falls back to the launch flags here.
 */
export function defaultSettings(): Settings {
  return { launchFlags: '', runningSessionsAtLaunch: 'cold', prStatus: true, leaveButton: 'stop-close', undoRunning: 'start', setAsideRunning: 'stop-close', setAside: ['tomorrow', 'in 1w', 'whenever'], setAsideTime: '09:00', locale: '', strength: [...DEFAULT_STRENGTH], looks: {}, needsYou: {}, approvals: {} };
}

/**
 * An unfiltered, unfolded sidebar at its default width: what a first run gets, and what any field missing from the stored object falls back to.
 * Main's (src/main/window/ui-state.ts reads the stored state over it); shared so that the window's checks start from the same first run rather than a copy of it.
 */
export function defaultUi(): UiState {
  return {
    search: '',
    filters: { pinned: false, open: false, live: false, setAside: false, worktree: false, gone: false, siblings: false, prs: false, noted: false, finished: false },
    datePreset: 'any',
    dateFrom: null,
    dateTo: null,
    filterPanelOpen: false,
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
