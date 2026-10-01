import AirDatepicker from 'air-datepicker';
import localeEn from 'air-datepicker/locale/en';
import 'air-datepicker/air-datepicker.css';
import type { SessionSummary, UiState } from '../../../../shared/types';
import { byId, fromMarkup } from '../../../dom';
import { datePresetRange, entityKey, sessionPasses } from '../../../logic';
import { noFilter, store, type FilterState, type View } from '../../../state/app';
import { isFiltering, searchText } from '../../../state/views';
import { closeIcon, folderGoneIcon, NOTE_ICON, PINNED_ICON, SIBLING_ICON, strokeIcon, WORKTREE_ICON } from '../../../svg';
import { setTooltip } from '../../../tooltip';
import { iconSvg } from '../../icons';
// The filter pill its pills and presets wear, shared with the history's All · Pinned.
import '../../../pill.css';
import './filter.css';

/**
 * The sidebar's filter: the header's toggle, the panel under it — the search box, the pills and the date presets with their calendar — and, under the panel, the count with Clear and the chips that stand in for a shut panel.
 * It sets the filter and the panel in the store; the list follows, and hands back the count it drew (`updateFilterStatus`), since only the list knows what matched.
 */

/** The filter's three parts, built here and placed by the sidebar (index.ts): the header's toggle, the panel under the header, and the status line under the panel. */
export const filterToggle = fromMarkup(`<button id="filter-toggle" class="icon-btn large" data-tooltip="Filter sessions" aria-label="Filter sessions" aria-expanded="false"></button>`, HTMLButtonElement);
export const filterPanel = fromMarkup(`
  <div id="filter-panel" hidden>
    <input id="search" type="search" placeholder="Search sessions…" aria-label="Search sessions" />
    <div id="filters">
      <button id="pinned-filter" data-tooltip="Show only pinned sessions" aria-label="Show only pinned sessions" aria-pressed="false"></button>
      <button id="open-filter" type="button" data-tooltip="Show only sessions with a tab open" aria-label="Show only sessions with a tab open" aria-pressed="false"></button>
      <button id="live-filter" type="button" data-tooltip="Show only live sessions" aria-label="Show only live sessions" aria-pressed="false"></button>
      <button id="worktree-filter" type="button" data-tooltip="Show only worktree sessions" aria-label="Show only worktree sessions" aria-pressed="false"></button>
      <button id="sibling-filter" type="button" data-tooltip="Show only sessions with siblings" aria-label="Show only sessions with siblings" aria-pressed="false"></button>
      <button id="note-filter" type="button" data-tooltip="Show only sessions with a note" aria-label="Show only sessions with a note" aria-pressed="false"></button>
      <button id="archived-filter" type="button" data-tooltip="Show archived sessions" aria-label="Show archived sessions" aria-pressed="false"></button>
      <button id="gone-filter" type="button" data-tooltip="Show only sessions whose folder is gone" aria-label="Show only sessions whose folder is gone" aria-pressed="false"></button>
      <div id="date-presets">
        <button type="button" data-range="any" class="active">Any</button>
        <button type="button" data-range="today">Today</button>
        <button type="button" data-range="7d">7d</button>
        <button type="button" data-range="30d">30d</button>
        <button type="button" data-range="custom">Custom</button>
      </div>
    </div>
    <button type="button" id="date-range-label" hidden>Pick a start and end date</button>
    <div id="date-custom" hidden>
      <div id="date-range"></div>
      <div id="date-range-caption"></div>
    </div>
  </div>`);
export const filterStatus = fromMarkup(`
  <div id="filter-status" hidden>
    <div id="filter-chips" hidden></div>
    <span id="filter-count"></span>
    <button id="filter-clear" type="button">Clear</button>
  </div>`);

const pinnedFilter = byId(filterPanel, 'pinned-filter', HTMLButtonElement);
const openFilter = byId(filterPanel, 'open-filter', HTMLButtonElement);
const liveFilter = byId(filterPanel, 'live-filter', HTMLButtonElement);
const worktreeFilter = byId(filterPanel, 'worktree-filter', HTMLButtonElement);
const siblingFilter = byId(filterPanel, 'sibling-filter', HTMLButtonElement);
const noteFilter = byId(filterPanel, 'note-filter', HTMLButtonElement);
const archivedFilter = byId(filterPanel, 'archived-filter', HTMLButtonElement);
const goneFilter = byId(filterPanel, 'gone-filter', HTMLButtonElement);
const datePresets = byId(filterPanel, 'date-presets');
const dateCustom = byId(filterPanel, 'date-custom');
const dateRangeLabel = byId(filterPanel, 'date-range-label'); // persistent line under presets
const dateRangeCaption = byId(filterPanel, 'date-range-caption'); // same text, inside calendar
const pad2 = (n: number): string => String(n).padStart(2, '0');
// Inline range calendar.
// Custom-rendered month/year views (click the header to zoom out to a months grid, then a years grid, arrows paging through) and no native <select>, so it behaves under WSLg.
// Capped at today: sessions are never in the future.
let suppressPickerSelect = false;
const datePicker = new AirDatepicker(byId(filterPanel, 'date-range'), {
  inline: true,
  range: true,
  locale: localeEn,
  maxDate: new Date(),
  onSelect: () => {
    if (!suppressPickerSelect) onCustomDateChange();
  },
});
const searchInput = byId(filterPanel, 'search', HTMLInputElement);
const filterCount = byId(filterStatus, 'filter-count');
const filterChips = byId(filterStatus, 'filter-chips');
const filterClear = byId(filterStatus, 'filter-clear', HTMLButtonElement);

// The filter toggle's mark: a funnel, not the magnifier it used to be. A magnifier promises a search box, which clears when it closes; what this opens is filters, which stay on.
const filterIcon = (size: number): string => strokeIcon(size, '<path d="M2.5 2.5h11L9.2 7.9v4.4l-2.4 1.2V7.9z" />');

// The open filter's mark: a window with a title bar — "this one has a tab". Deliberately a SHAPE where running is a DOT, so the pair reads as two different questions rather than two intensities.
const OPEN_ICON = strokeIcon(13, '<rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1.4" /><path d="M2.6 6.4h10.8" />');

// The running filter's mark: a filled dot inside a ring — the same "live" language the status dots speak, rather than a play triangle, which would read as "start these".
const LIVE_ICON = strokeIcon(13, '<circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2.2" fill="currentColor" stroke="none" />');

// The archived filter's mark: a lidded box. Ink spans the full 16-unit box horizontally and 3..13 vertically, centred on (8,8) like the rest, so it sits square beside the star and the branch.
const ARCHIVE_ICON = strokeIcon(13, '<path d="M2.5 3.2h11v3h-11z" /><path d="M3.6 6.2v6.6h8.8V6.2" /><path d="M6.4 9h3.2" />');

// Session key -> its group's NAME, so typing a group name reaches its sessions.
// Built ONCE per filter pass and handed in: passesFilters runs per session, so building it there would be one pass over the membership map per row.
export function groupNameByKey({ groupState }: View<'groupState'>): Map<string, string> {
  const byId = new Map(groupState.groups.map((g) => [g.id, g.name]));
  const out = new Map<string, string>();
  for (const [key, id] of Object.entries(groupState.groupOf)) {
    const name = byId.get(id);
    if (name) out.set(key, name);
  }
  return out;
}

// Adapt the current filter state to the pure predicate.
export function passesFilters(session: SessionSummary, view: View<'pinned' | 'archived' | 'notes' | 'pendingDeletes' | 'tabs' | 'filter'>, groupNames?: ReadonlyMap<string, string>): boolean {
  const { filters, dateFrom, dateTo } = view.filter;
  return sessionPasses(session, {
    groupNames,
    text: searchText(view),
    pinnedOnly: filters.pinned,
    openOnly: filters.open,
    open: filters.open ? new Set(view.tabs.map((t) => entityKey(t.session))) : undefined,
    liveOnly: filters.live,
    // Built per call rather than hoisted: cheap next to the tab count, and it must reflect the tabs as they are right now, since starting or stopping one changes what this filter shows.
    live: filters.live
      ? new Set(view.tabs.filter((t) => t.terminalId !== null).map((t) => entityKey(t.session)))
      : undefined,
    worktreeOnly: filters.worktree,
    goneOnly: filters.gone,
    siblingOnly: filters.siblings,
    notedOnly: filters.noted,
    archivedOnly: filters.archived,
    dateFrom,
    dateTo,
    pinned: view.pinned,
    archived: view.archived,
    notes: view.notes,
    pendingDeletes: view.pendingDeletes,
  });
}

// The custom-range calendar is an inline popover; its open state is independent of the active preset, so a picked range stays applied while the calendar is dismissed.
let datePopoverOpen = false;
function setDatePopover(open: boolean): void {
  datePopoverOpen = open;
  dateCustom.hidden = !open;
}

/**
 * Set the filter: the list, its count and its chips follow the store.
 * A filter that ends takes the folds made under it (`Folds`), in the same change: they have served their purpose. Every way a filter ends comes here — the last character deleted, a preset back to Any, a chip's ×, Clear.
 */
function putFilter(next: FilterState): void {
  const { folds } = store.get();
  store.set({ filter: next, ...(isFiltering({ filter: next }) ? {} : { folds: { ...folds, filterProjects: new Set(), filterGroups: new Set() } }) });
}

/** Change part of the filter. */
function setFilter(patch: Partial<FilterState>): void {
  putFilter({ ...store.get().filter, ...patch });
}

/** Turn one pill on or off. */
function setPill(key: FilterPill['key'], on: boolean): void {
  const { filters } = store.get().filter;
  setFilter({ filters: { ...filters, [key]: on } });
}

/** A date preset's [from, to] window, in epoch ms, null for unbounded on that side: a rolling preset's from now, Custom's from the calendar's selection. */
function dateWindow(preset: string): Pick<FilterState, 'datePreset' | 'dateFrom' | 'dateTo'> {
  if (preset === 'custom') return { datePreset: preset, ...customDates() };
  const range = datePresetRange(preset, Date.now());
  return { datePreset: preset, dateFrom: range.from, dateTo: range.to };
}

/** Show a preset as the one chosen. */
function drawDatePreset(preset: string): void {
  // The persistent range line shows only while Custom is the active preset (open or closed calendar).
  dateRangeLabel.hidden = preset !== 'custom';
  for (const chip of datePresets.querySelectorAll('button')) {
    chip.classList.toggle('active', chip.dataset.range === preset);
  }
  // Custom just selects the mode; the range bar is the one control that opens the calendar.
  if (preset !== 'custom') setDatePopover(false);
}

function applyDatePreset(preset: string): void {
  drawDatePreset(preset);
  setFilter(dateWindow(preset));
}

/** The calendar's range as whole days, which the range line and the calendar's caption name as it changes. */
function customDates(): Pick<FilterState, 'dateFrom' | 'dateTo'> {
  const [from, to] = datePicker.selectedDates.slice().sort((a, b) => a.getTime() - b.getTime());
  updateDateRangeLabel(from, to);
  return { dateFrom: from ? new Date(from).setHours(0, 0, 0, 0) : null, dateTo: to ? new Date(to).setHours(23, 59, 59, 999) : null };
}

// Show the picked range in day-month-year, in both the persistent line and the in-calendar caption.
function updateDateRangeLabel(from?: Date, to?: Date): void {
  const dmy = (d: Date): string => `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
  let text: string;
  if (from && to) text = `${dmy(from)} – ${dmy(to)}`;
  else if (from) text = `${dmy(from)} – …`;
  else text = 'Pick a start and end date';
  dateRangeLabel.textContent = text;
  dateRangeCaption.textContent = text;
}

// Bound the picker to real data: min = the oldest session's date (max stays today, set at construction). Runs whenever the session set changes; silent so it doesn't fire onSelect.
export function applyDatePickerMinDate(view: View<'sessions'>): void {
  const earliest = view.sessions.reduce<number | null>((min, s) => {
    const t = Date.parse(s.lastActivity);
    return min === null || t < min ? t : min;
  }, null);
  datePicker.update({ minDate: earliest !== null ? new Date(earliest) : false }, { silent: true });
}

// Make an active filter obvious: show "N of M" with a clear button and flag the active controls.
export function updateFilterStatus(matches: number, total: number, view: View<'filter' | 'filterPanelOpen'>): void {
  const filtering = isFiltering(view);
  const { filters } = view.filter;
  filterStatus.hidden = !filtering;
  searchInput.classList.toggle('active', searchText(view).length > 0);
  for (const pill of FILTER_PILLS) {
    pill.button.classList.toggle('active', filters[pill.key]);
    pill.button.setAttribute('aria-pressed', String(filters[pill.key]));
  }
  // The toggle carries the accent when any filter is on, beside the status line under the panel, so an active filter is visible even with the panel closed.
  filterToggle.classList.toggle('active', filtering);
  // The archived view counts against the archived set, and says so, since that total is not the number the switcher shows.
  if (filtering) filterCount.textContent = `Showing ${matches} of ${total}${filters.archived ? ' archived' : ''}`;
  updateFilterChips(view);
}

function clearSearch(): void {
  searchInput.value = '';
  setFilter({ search: '' });
}

/** Empty the calendar without its own change applying it: whoever clears it says what the filter is now. */
function clearCalendar(): void {
  suppressPickerSelect = true;
  datePicker.clear();
  suppressPickerSelect = false;
}

function clearDateFilter(): void {
  clearCalendar();
  applyDatePreset('any');
}

function clearFilter(): void {
  searchInput.value = '';
  clearCalendar();
  drawDatePreset('any');
  putFilter(noFilter());
}

// --- What is on, while the panel is shut ---
// Closing the panel over a filter keeps the filter, so the panel folds down to a row of what is on rather than disappearing: the search text, each pill that is on, the date range, each with its own ×.
// A filter that is on is never out of sight, which is the whole point; the count and Clear on the line below stay as they are with the panel open.

// What the chips were last built from, so the row is rebuilt only when that changes: renders happen constantly, and rebuilding each time would drop the hover and focus from under the pointer.
let lastChipsSignature = '';

function filterChip(icon: string, text: string, label: string, remove: () => void): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'filter-chip';
  chip.innerHTML = icon;
  if (text) {
    const words = document.createElement('span');
    words.className = 'filter-chip-text';
    words.textContent = text;
    chip.append(words);
  }
  setTooltip(chip, label);
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'filter-chip-remove';
  x.innerHTML = closeIcon(10);
  x.setAttribute('aria-label', `Remove: ${label}`);
  // The list, its count and the chips follow the filter's change.
  x.addEventListener('click', remove);
  chip.append(x);
  return chip;
}

function updateFilterChips(view: View<'filter' | 'filterPanelOpen'>): void {
  const show = isFiltering(view) && !view.filterPanelOpen;
  filterChips.hidden = !show;
  filterStatus.classList.toggle('collapsed', show);
  if (!show) {
    lastChipsSignature = '';
    return;
  }
  const { datePreset, filters } = view.filter;
  const search = view.filter.search.trim();
  const text = searchText(view);
  const pills = FILTER_PILLS.filter((pill) => filters[pill.key]);
  // The date chip says what the preset button says, or the picked range for Custom, so it reads the same words as the control that set it.
  const dateText =
    datePreset === 'any'
      ? ''
      : datePreset === 'custom'
        ? dateRangeLabel.textContent
        : (datePresets.querySelector(`[data-range="${datePreset}"]`)?.textContent ?? datePreset);
  const signature = JSON.stringify([text ? search : '', pills.map((pill) => pill.button.id), dateText]);
  if (signature === lastChipsSignature) return;
  lastChipsSignature = signature;
  const chips: HTMLElement[] = [];
  if (text) chips.push(filterChip(iconSvg('search', 13), search, `Search: ${search}`, clearSearch));
  for (const pill of pills) chips.push(filterChip(pill.icon, '', pill.button.getAttribute('aria-label') ?? '', () => setPill(pill.key, false)));
  if (dateText) chips.push(filterChip(iconSvg('clock', 13), dateText, `Last active: ${dateText}`, clearDateFilter));
  filterChips.replaceChildren(...chips);
}

/** Show or hide the filter panel. Split out because the restore draws it from what was stored, before the view is in the store, and must not touch focus: at startup the terminal wants it. */
function drawFilterPanel(open: boolean): void {
  filterPanel.hidden = !open;
  filterToggle.setAttribute('aria-expanded', String(open));
}

/** The panel opened or shut: it follows, with the chips that stand in for it while it is shut. A watcher the sidebar registers (watch.ts), as it does `applyDatePickerMinDate`. */
export function filterPanelFollows(view: View<'filterPanelOpen' | 'filter'>): void {
  drawFilterPanel(view.filterPanelOpen);
  updateFilterChips(view);
}

/** Open or shut the panel from a click: the toggle, or the row of chips that stands in for it. */
function toggleFilterPanel(open: boolean): void {
  store.set({ filterPanelOpen: open });
  // Opening hands focus to the search box; closing drops focus so the ring doesn't linger.
  if (open) searchInput.focus();
  else filterToggle.blur();
}

/**
 * Put the filter's controls back as they were left — the search box, the calendar's range, the chosen preset, the panel — and hand back the filter they make, which the start-up read sets in the store with the listing.
 * Before the view is in the store, so the panel is drawn from what was stored (`drawFilterPanel`) rather than followed.
 */
export async function restoreFilter(state: UiState): Promise<FilterState> {
  searchInput.value = state.search;
  // Only a CUSTOM range is restored as stored. The rolling presets are worked out again from the current moment, which is the whole point of "last 7 days" still meaning the last 7 days.
  if (state.datePreset === 'custom') {
    const picked = [state.dateFrom, state.dateTo].filter((ms): ms is number => ms !== null).map((ms) => new Date(ms));
    if (picked.length > 0) {
      // Awaited, because the window below reads the range back OUT of the picker: the selection has to have landed first.
      // Flagged rather than the picker's own `silent`, so the calendar still repaints — this only needs onSelect not to set the filter mid-restore.
      suppressPickerSelect = true;
      await datePicker.selectDate(picked);
      suppressPickerSelect = false;
    }
  }
  drawDatePreset(state.datePreset);
  drawFilterPanel(state.filterPanelOpen);
  return { search: state.search, filters: state.filters, ...dateWindow(state.datePreset) };
}

searchInput.addEventListener('input', () => setFilter({ search: searchInput.value }));
filterClear.addEventListener('click', clearFilter);

/**
 * The filter pills, once, in the order they sit in the panel: each one's button, its mark and the flag it sets.
 * Everything that asks about the pills as a set reads this — how they are drawn and wired, which chips stand in for a shut panel — so the chips cannot fall out of step with the panel.
 * The predicate (`passesFilters`) still names each flag, because it maps each to a criterion of its own.
 */
interface FilterPill {
  button: HTMLButtonElement;
  icon: string;
  key: keyof FilterState['filters'];
}
const FILTER_PILLS: FilterPill[] = [
  { button: pinnedFilter, icon: PINNED_ICON, key: 'pinned' },
  { button: openFilter, icon: OPEN_ICON, key: 'open' },
  { button: liveFilter, icon: LIVE_ICON, key: 'live' },
  { button: worktreeFilter, icon: WORKTREE_ICON, key: 'worktree' },
  { button: siblingFilter, icon: SIBLING_ICON, key: 'siblings' },
  { button: noteFilter, icon: NOTE_ICON, key: 'noted' },
  { button: archivedFilter, icon: ARCHIVE_ICON, key: 'archived' },
  { button: goneFilter, icon: folderGoneIcon(13), key: 'gone' },
];

// Each pill shows the same mark the rows use, from the one definition — a glyph would render at a different weight beside them.
// Icon-only: the words cost the panel an extra line at a 320px sidebar, and every pill carries a tooltip and an aria-label (see panels/types/sessions/index.ts) for what it means.
for (const pill of FILTER_PILLS) {
  pill.button.innerHTML = pill.icon;
  // Every filter pill does the same thing: flip its flag; the list follows, from its top.
  pill.button.addEventListener('click', () => setPill(pill.key, !store.get().filter.filters[pill.key]));
}
// The header's toggle draws its mark through the same helper as the rest, rather than inline in the sidebar's markup.
filterToggle.innerHTML = filterIcon(14);
filterToggle.addEventListener('click', () => toggleFilterPanel(!store.get().filterPanelOpen));
// The row of chips stands in for the shut panel, so a press anywhere on it but a × or Clear opens the panel again.
filterStatus.addEventListener('click', (event) => {
  if (!store.get().filterPanelOpen && !(event.target as HTMLElement).closest('button')) toggleFilterPanel(true);
});
datePresets.addEventListener('click', (event) => {
  const preset = (event.target as HTMLElement).dataset.range;
  if (preset) applyDatePreset(preset);
});
// Dismiss the calendar on an outside press or Escape; the picked range stays applied.
// Uses mousedown, not click, so it fires before air-datepicker re-renders on a view switch (a click handler would see the just-clicked nav element already detached and wrongly treat it as an outside click).
// The presets row, the range line, and the calendar itself keep it open (each has its own toggle handler).
document.addEventListener('mousedown', (event) => {
  if (!datePopoverOpen) return;
  const target = event.target as Node;
  if (dateCustom.contains(target) || datePresets.contains(target) || dateRangeLabel.contains(target)) {
    return;
  }
  setDatePopover(false);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && datePopoverOpen) setDatePopover(false);
});
// The persistent range line reopens (toggles) the calendar.
dateRangeLabel.addEventListener('click', () => setDatePopover(!datePopoverOpen));
function onCustomDateChange(): void {
  setFilter(customDates());
}
