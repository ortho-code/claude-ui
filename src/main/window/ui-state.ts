import type { EditorUi, HistoryUi, UiState } from '../../shared/types';
import { isDiffView } from '../../shared/diff/picks';
import type { PanelState } from '../../shared/panels';
import { defaultUi } from '../../shared/config/defaults';
import { queryFromStoredFilter } from '../../shared/query/stored-filter';

/**
 * The layout tree's state, entry by entry: what is not the right shape is dropped, and the rest kept.
 * Only the containers are checked, not whether an id is still in the layout file — that file changes under the app, and the tree ignores state for an id it does not have.
 * The first slice's `{ width }` is not carried: it had one user and a week of life, and the tree starts that side from the file's size.
 */
/** The Editor's part, field by field, each one missing or of the wrong kind taking its default. */
function normalizeEditor(raw: unknown, bool: (value: unknown, fallback: boolean) => boolean): EditorUi {
  const base = defaultUi().editor;
  const editor = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    docked: bool(editor.docked, base.docked),
    view: isDiffView(editor.view) ? editor.view : base.view,
    ignoreWs: bool(editor.ignoreWs, base.ignoreWs),
    changesOnly: bool(editor.changesOnly, base.changesOnly),
  };
}

/** The history's part, field by field, as the Editor's is. */
function normalizeHistory(raw: unknown, bool: (value: unknown, fallback: boolean) => boolean, px: (value: unknown) => number | null): HistoryUi {
  const history = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { docked: bool(history.docked, defaultUi().history.docked), width: px(history.width) };
}

function normalizePanelState(raw: unknown, px: (value: unknown) => number | null, strings: (value: unknown) => string[]): PanelState {
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const state = record(raw);
  const sizes: PanelState['sizes'] = {};
  for (const [split, children] of Object.entries(record(state.sizes))) {
    const kept = Object.entries(record(children)).flatMap(([child, size]) => {
      const value = px(size);
      return value === null ? [] : [[child, value] as const];
    });
    if (kept.length > 0) sizes[split] = Object.fromEntries(kept);
  }
  const active = Object.fromEntries(Object.entries(record(state.active)).filter((pair): pair is [string, string] => typeof pair[1] === 'string'));
  return { sizes, collapsed: strings(state.collapsed), active };
}

/**
 * Fill in a stored UiState field by field, defaulting anything absent or of the wrong type.
 *
 * Applied on READ and on WRITE, deliberately.
 * On read it means a meta.json from before this existed, or one a newer build wrote with fields this one has never heard of, still produces a usable sidebar.
 * On write it means the renderer cannot put something in the file that the next launch would choke on — this is the one structure the UI hands over wholesale rather than a value at a time.
 */
export function normalizeUi(raw: unknown): UiState {
  const base = defaultUi();
  if (!raw || typeof raw !== 'object') return base;
  const ui = raw as Record<string, unknown>;
  const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  // A width of 0 would collapse a pane to nothing with no way to drag it back, so anything non-positive is treated as "never set" and takes the default.
  const px = (value: unknown): number | null => (typeof value === 'number' && value > 0 ? value : null);
  const filters = (ui.filters && typeof ui.filters === 'object' ? ui.filters : {}) as Record<string, unknown>;
  return {
    // A file from before the query field keeps its filter, its search, pills and dates written as the query (`queryFromStoredFilter`); the next write drops the old fields.
    query: typeof ui.query === 'string' ? ui.query : queryFromStoredFilter(ui),
    // Stored as `filters.finished` before the query field, and as `filters.archived` before the act was called Finished.
    finished: bool(ui.finished, bool(filters.finished, bool(filters.archived, base.finished))),
    filterPanelOpen: bool(ui.filterPanelOpen, base.filterPanelOpen),
    tabBarExpanded: bool(ui.tabBarExpanded, base.tabBarExpanded),
    editor: normalizeEditor(ui.editor, bool),
    history: normalizeHistory(ui.history, bool, px),
    collapsedProjects: strings(ui.collapsedProjects),
    collapsedGroups: strings(ui.collapsedGroups),
    filterCollapsedProjects: strings(ui.filterCollapsedProjects),
    filterCollapsedGroups: strings(ui.filterCollapsedGroups),
    sidebarWidth: px(ui.sidebarWidth),
    scrollTop: typeof ui.scrollTop === 'number' && Number.isFinite(ui.scrollTop) ? Math.max(0, ui.scrollTop) : 0,
    panelState: normalizePanelState(ui.panelState, px, strings),
  };
}
