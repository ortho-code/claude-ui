import type { UiState } from '../../shared/types';
import type { PanelState } from '../../shared/panels';
import { defaultUi } from '../../shared/config/defaults';

/**
 * The layout tree's state, entry by entry: what is not the right shape is dropped, and the rest kept.
 * Only the containers are checked, not whether an id is still in the layout file — that file changes under the app, and the tree ignores state for an id it does not have.
 * The first slice's `{ width }` is not carried: it had one user and a week of life, and the tree starts that side from the file's size.
 */
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

/** The filters stored under another key before their word changed: `live` as `running`, `setAside` as `later`, `finished` as `archived`. */
const FILTERS_BEFORE: Partial<Record<keyof UiState['filters'], string>> = { live: 'running', setAside: 'later', finished: 'archived' };

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
  const ms = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  // A width of 0 would collapse a pane to nothing with no way to drag it back, so anything non-positive is treated as "never set" and takes the default.
  const px = (value: unknown): number | null => (typeof value === 'number' && value > 0 ? value : null);
  const filters = (ui.filters ?? {}) as Record<string, unknown>;
  return {
    search: typeof ui.search === 'string' ? ui.search : base.search,
    filters: Object.fromEntries(
      // A key the file does not have takes its default, so a filter added later reads as it would on a first run, and one that is gone, such as `paused`, is dropped.
      // A filter whose word changed reads its old key as its fallback, so an existing file keeps the toggle rather than silently clearing it.
      (Object.keys(base.filters) as (keyof UiState['filters'])[]).map((key) => {
        const old = FILTERS_BEFORE[key];
        return [key, bool(filters[key], old === undefined ? base.filters[key] : bool(filters[old], base.filters[key]))];
      }),
    ) as UiState['filters'],
    datePreset: typeof ui.datePreset === 'string' ? ui.datePreset : base.datePreset,
    dateFrom: ms(ui.dateFrom),
    dateTo: ms(ui.dateTo),
    filterPanelOpen: bool(ui.filterPanelOpen, base.filterPanelOpen),
    tabBarExpanded: bool(ui.tabBarExpanded, base.tabBarExpanded),
    collapsedProjects: strings(ui.collapsedProjects),
    collapsedGroups: strings(ui.collapsedGroups),
    filterCollapsedProjects: strings(ui.filterCollapsedProjects),
    filterCollapsedGroups: strings(ui.filterCollapsedGroups),
    sidebarWidth: px(ui.sidebarWidth),
    scrollTop: typeof ui.scrollTop === 'number' && Number.isFinite(ui.scrollTop) ? Math.max(0, ui.scrollTop) : 0,
    panelState: normalizePanelState(ui.panelState, px, strings),
  };
}
