import type { UiState } from '../../../../shared/types';
import { hasTerm, withoutTerms, withoutTerm, withTerms } from '../../../../shared/query/edit';
import { parseQuery, type Term, type Vocabulary } from '../../../../shared/query/parse';
import { dateTerm, PILL_TERMS, PRESET_TERMS, type PillKey } from '../../../../shared/query/stored-filter';
import { calendar } from '../../../dialogs/calendar';
import { byId, fromMarkup } from '../../../ui/dom';
import { noFilter, store, type FilterState, type View } from '../../../state/app';
import { filterQuery } from '../../../state/filter-query';
import { queryFields } from '../../../state/query-facts';
import { followFieldScroll, queryMirror, showQueryProblems } from './query-problems';
import { queryHelpSection } from './query-help';
import { sidePopover } from '../../../ui/side-popover';
import { isFiltering } from '../../../state/views';
import { finishIcon, closeIcon, folderGoneIcon, SET_ASIDE_ICON, NOTE_ICON, PINNED_ICON, PR_ICON, SIBLING_ICON, strokeIcon, svgImage, WORKTREE_ICON } from '../../../ui/svg';
// The filter pill its pills and presets wear, shared with the history's All · Pinned.
import '../../../ui/pill.css';
import '../../../ui/popover.css';
import './filter.css';

/**
 * The sidebar's filter: the query field on a row of its own, always on screen, with the filters' toggle at its end; the filters the toggle opens beside the session list — the pills by facet, the date presets with their calendar, and the query's help folded at their foot; and, under the field, the count with Clear.
 * The query field is the filter: a pill or a preset writes its term into it and shows on while its term is there (the session-model design's decision 17), and only the finished switch stands beside it.
 * It sets the filter in the store; the list follows, and hands back the count it drew (`updateFilterStatus`), since only the list knows what matched.
 */

/** The query's row and the status line under it, built here and placed by the sidebar (index.ts); the filters open in a side popover of their own. */
const filterToggle = fromMarkup(`<button id="filter-toggle" class="icon-btn large" data-tooltip="Filter sessions" aria-label="Filter sessions" aria-expanded="false"></button>`, HTMLButtonElement);
export const queryRow = fromMarkup(`
  <div id="query-row">
    <div id="query-field"><input id="search" type="search" placeholder="Search, or is:pinned OR is:running…" aria-label="Search or filter sessions" spellcheck="false" /></div>
  </div>`);
/** The pills by facet and the dates, built once; each opening of the filters shows them, with the help built anew under them. */
const filtersContent = fromMarkup(`
  <div id="filters">
    <h3 class="filters-title">Filters</h3>
    <div class="facets">
      <span class="facet-name">Lifecycle</span>
      <span class="facet-pills">
        <button id="open-filter" type="button" class="pill" data-tooltip="Show only sessions with a tab open" aria-pressed="false"></button>
        <button id="live-filter" type="button" class="pill" data-tooltip="Show only sessions whose claude runs" aria-pressed="false"></button>
        <button id="set-aside-filter" type="button" class="pill" data-tooltip="Show only sessions set aside" aria-pressed="false"></button>
        <button id="finished-filter" type="button" class="pill" data-tooltip="Show the finished sessions in place of the rest" aria-pressed="false"></button>
      </span>
      <span class="facet-name">Links</span>
      <span class="facet-pills">
        <button id="pr-filter" type="button" class="pill" data-tooltip="Show only sessions with a PR" aria-pressed="false"></button>
      </span>
      <span class="facet-name">Relations</span>
      <span class="facet-pills">
        <button id="sibling-filter" type="button" class="pill" data-tooltip="Show only sessions with siblings" aria-pressed="false"></button>
      </span>
      <span class="facet-name">Marks</span>
      <span class="facet-pills">
        <button id="pinned-filter" type="button" class="pill" data-tooltip="Show only pinned sessions" aria-pressed="false"></button>
        <button id="note-filter" type="button" class="pill" data-tooltip="Show only sessions with a note" aria-pressed="false"></button>
      </span>
      <span class="facet-name">Place</span>
      <span class="facet-pills">
        <button id="worktree-filter" type="button" class="pill" data-tooltip="Show only worktree sessions" aria-pressed="false"></button>
        <button id="gone-filter" type="button" class="pill" data-tooltip="Show only sessions whose folder is gone" aria-pressed="false"></button>
      </span>
      <span class="facet-name">Last active</span>
      <span class="facet-pills">
        <span id="date-presets">
          <button type="button" data-range="any" class="active">Any</button>
          <button type="button" data-range="today">Today</button>
          <button type="button" data-range="7d">7d</button>
          <button type="button" data-range="30d">30d</button>
          <button type="button" data-range="custom">Custom</button>
        </span>
        <button type="button" id="date-range-label" hidden>Pick a start and end date</button>
        <span id="date-custom" hidden>
          <span id="date-range"></span>
          <span id="date-range-caption"></span>
        </span>
      </span>
    </div>
  </div>`);
export const filterStatus = fromMarkup(`
  <div id="filter-status" hidden>
    <span id="filter-count"></span>
    <span class="filter-actions">
      <button id="filter-clear" type="button">Clear</button>
      <button id="filter-clear-close" type="button">Clear and close</button>
    </span>
  </div>`);

const pinnedFilter = byId(filtersContent, 'pinned-filter', HTMLButtonElement);
const openFilter = byId(filtersContent, 'open-filter', HTMLButtonElement);
const liveFilter = byId(filtersContent, 'live-filter', HTMLButtonElement);
const setAsideFilter = byId(filtersContent, 'set-aside-filter', HTMLButtonElement);
const worktreeFilter = byId(filtersContent, 'worktree-filter', HTMLButtonElement);
const siblingFilter = byId(filtersContent, 'sibling-filter', HTMLButtonElement);
const prFilter = byId(filtersContent, 'pr-filter', HTMLButtonElement);
const noteFilter = byId(filtersContent, 'note-filter', HTMLButtonElement);
const finishedFilter = byId(filtersContent, 'finished-filter', HTMLButtonElement);
const goneFilter = byId(filtersContent, 'gone-filter', HTMLButtonElement);
const datePresets = byId(filtersContent, 'date-presets');
const dateCustom = byId(filtersContent, 'date-custom');
const dateRangeLabel = byId(filtersContent, 'date-range-label'); // persistent line under presets
const dateRangeCaption = byId(filtersContent, 'date-range-caption'); // same text, inside calendar
const pad2 = (n: number): string => String(n).padStart(2, '0');
// Inline range calendar, the app's own (calendar.ts): click the header to zoom out to a months grid, then a years grid, arrows paging through.
// Capped at today: sessions are never in the future.
let suppressPickerSelect = false;
const datePicker = calendar(byId(filtersContent, 'date-range'), {
  range: true,
  maxDate: new Date(),
  onSelect: () => {
    if (!suppressPickerSelect) onCustomDateChange();
  },
});
const searchInput = byId(queryRow, 'search', HTMLInputElement);
byId(queryRow, 'query-field').append(queryMirror);
queryRow.append(filterToggle);
/** The filters, beside the panel the list is in, wherever the layout puts it; whether they are open is the store's, for Clear and close beside the count. */
const filters = sidePopover('filters-card', 'Filters', (open) => store.set({ filterPanelOpen: open }));
/** A value pressed in the help, ANDed with the query as a pill's term is. */
const addTerm = (term: string): void => setQuery(withTerms(store.get().filter.query, [term], vocabulary()));
/** What the filters show: the pills and the dates as they stand, and the help built from the fields as they stand now, folded as it was last left. */
const filtersShown = (): Node[] => [filtersContent, queryHelpSection(store.get().queryHelpOpen, (open) => store.set({ queryHelpOpen: open }), addTerm)];
filterToggle.addEventListener('click', () => filters.toggle(filterToggle, queryRow.closest<HTMLElement>('.panel-group') ?? queryRow, filtersShown));

/** Shut the filters, as the review does when it sets the filter aside. */
export function closeFilters(): void {
  filters.close();
}
searchInput.addEventListener('scroll', () => followFieldScroll(searchInput));
const SEARCH_CLEAR_SIZE = 12;
searchInput.style.setProperty('--search-clear', svgImage(closeIcon(SEARCH_CLEAR_SIZE)));
searchInput.style.setProperty('--search-clear-size', `${SEARCH_CLEAR_SIZE}px`);
const filterCount = byId(filterStatus, 'filter-count');
const filterClear = byId(filterStatus, 'filter-clear', HTMLButtonElement);
const filterClearClose = byId(filterStatus, 'filter-clear-close', HTMLButtonElement);

// The filter toggle's mark: a funnel, not the magnifier it used to be.
// A magnifier promises a search box, which clears when it closes; what this opens is filters, which stay on.
const filterIcon = (size: number): string => strokeIcon(size, '<path d="M2.5 2.5h11L9.2 7.9v4.4l-2.4 1.2V7.9z" />');

// The open filter's mark: a window with a title bar — "this one has a tab".
// Deliberately a SHAPE where running is a DOT, so the pair reads as two different questions rather than two intensities.
const OPEN_ICON = strokeIcon(13, '<rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1.4" /><path d="M2.6 6.4h10.8" />');

// The running filter's mark: a filled dot inside a ring — the same "live" language the status dots speak, rather than a play triangle, which would read as "start these".
const LIVE_ICON = strokeIcon(13, '<circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2.2" fill="currentColor" stroke="none" />');

// The finished filter's mark: the lidded box finishing wears everywhere (`finishIcon`).
const FINISH_ICON = finishIcon(13);

/** The fields the query field reads, as they stand. */
const vocabulary = (): Vocabulary => queryFields(store.get()).fields;

/** A term a date preset or the calendar wrote, which a new choice of date replaces. */
const isDateTerm = (term: Term): boolean => term.field === 'active' && !term.negated;

// The custom-range calendar is an inline popover; its open state is independent of the active preset, so a picked range stays applied while the calendar is dismissed.
let datePopoverOpen = false;
function setDatePopover(open: boolean): void {
  datePopoverOpen = open;
  dateCustom.hidden = !open;
}

/**
 * Set the filter: the list and its count follow the store.
 * Any change of the filter takes the folds made under it (`Folds`), in the same change: new results can sit in a section folded for the old ones, and a filter that ends has no use for them at all.
 * Every change you make to the filter comes here — a character typed or deleted, a pill, a preset, the calendar, Clear, Clear and close; the launch restores the filter directly, with the folds stored beside it.
 */
function putFilter(next: FilterState): void {
  const { folds } = store.get();
  store.set({ filter: next, folds: { ...folds, filterProjects: new Set(), filterGroups: new Set() } });
}

/** Change part of the filter. */
function setFilter(patch: Partial<FilterState>): void {
  putFilter({ ...store.get().filter, ...patch });
}

/** Write a query a control made into the field and the filter, so the field always shows what filters; Custom stays chosen only as long as the control that set it says so. */
function setQuery(query: string): void {
  customChosen = false;
  searchInput.value = query;
  setFilter({ query });
}

/** Turn one pill on or off: its term added to the query, or taken out of it. */
function setPill(key: PillKey, on: boolean): void {
  const { query } = store.get().filter;
  setQuery(on ? withTerms(query, [PILL_TERMS[key]], vocabulary()) : withoutTerm(query, PILL_TERMS[key], vocabulary()));
}

/** The query with its date terms, those a preset or the calendar wrote, replaced by `terms`. */
function withDates(query: string, terms: readonly string[]): string {
  return withTerms(withoutTerms(query, isDateTerm, vocabulary()), terms, vocabulary());
}

/** Custom was chosen with no range picked yet, so it stays lit while the query has no date of its own. */
let customChosen = false;

/**
 * Which preset the query says: the one whose term it holds, Custom for days the calendar wrote or while Custom waits for a range, Any for no date; null for a date term no preset writes, such as one typed by hand, or a query of several parts; undefined while the query does not read, which leaves the presets as they are.
 */
function presetOf(query: string): string | null | undefined {
  const parsed = parseQuery(query, vocabulary());
  if (parsed.problems.length > 0) return undefined;
  if (parsed.parts.length !== 1) return null;
  const dates = (parsed.parts[0] ?? []).filter(isDateTerm).map((term) => query.slice(term.from, term.to).toLowerCase());
  if (dates.length === 0) return customChosen ? 'custom' : 'any';
  const preset = (Object.keys(PRESET_TERMS) as (keyof typeof PRESET_TERMS)[]).find((key) => dates.length === 1 && dates[0] === PRESET_TERMS[key]);
  if (preset) return preset;
  return dates.every((date) => /^active:(>=|<=)\d{4}-\d{2}-\d{2}$/.test(date)) ? 'custom' : null;
}

/** Show a preset as the one chosen, or none for null. */
function drawDatePreset(preset: string | null): void {
  // The persistent range line shows only while Custom is the active preset (open or closed calendar).
  dateRangeLabel.hidden = preset !== 'custom';
  for (const chip of datePresets.querySelectorAll('button')) {
    chip.classList.toggle('active', chip.dataset.range === preset);
  }
  // Custom just selects the mode; the range bar is the one control that opens the calendar.
  if (preset !== 'custom') setDatePopover(false);
}

/** A preset pressed: its term in place of the query's dates; Custom writes the calendar's range, if one is picked. */
function applyDatePreset(preset: string): void {
  drawDatePreset(preset);
  if (preset === 'custom') {
    const range = customTerms();
    if (range.length > 0) setQuery(withDates(store.get().filter.query, range));
    customChosen = true;
    drawDatePreset('custom');
    return;
  }
  setQuery(withDates(store.get().filter.query, preset in PRESET_TERMS ? [PRESET_TERMS[preset as keyof typeof PRESET_TERMS]] : []));
}

/** The calendar's range as the query's terms, by whole days, which the range line and the calendar's caption name as it changes. */
function customTerms(): string[] {
  const [from, to] = datePicker.selectedDates.slice().sort((a, b) => a.getTime() - b.getTime());
  updateDateRangeLabel(from, to);
  return [...(from ? [`active:>=${dateTerm(from.getTime())}`] : []), ...(to ? [`active:<=${dateTerm(to.getTime())}`] : [])];
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

/** The oldest last activity the calendar was last bounded to, null for none, or undefined before it was bounded at all. */
let boundTo: number | null | undefined;

/**
 * Bound the calendar to the oldest session's day (its latest day is today, set when it is built), whenever the listing changes, and silently, so no date counts as picked.
 * Only when that day moved: the calendar draws itself again on every update, and a listing changes far more often than its oldest session.
 */
export function applyDatePickerMinDate(view: View<'sessions'>): void {
  const earliest = view.sessions.reduce<number | null>((min, s) => {
    const t = Date.parse(s.lastActivity);
    return min === null || t < min ? t : min;
  }, null);
  if (earliest === boundTo) return;
  boundTo = earliest;
  datePicker.update({ minDate: earliest !== null ? new Date(earliest) : false }, { silent: true });
}

// Make an active filter obvious: show "N of M" with a clear button and flag the active controls.
export function updateFilterStatus(matches: number, total: number, view: View<'filter' | 'filterPanelOpen'>): void {
  const filtering = isFiltering(view);
  const { query, finished } = view.filter;
  filterStatus.hidden = !filtering;
  searchInput.classList.toggle('active', query.trim() !== '');
  showQueryProblems(searchInput, filterQuery(store.get()).problems);
  for (const pill of FILTER_PILLS) {
    const on = pill.key === 'finished' ? finished : hasTerm(query, PILL_TERMS[pill.key], vocabulary());
    pill.button.classList.toggle('active', on);
    pill.button.setAttribute('aria-pressed', String(on));
  }
  const preset = presetOf(query);
  if (preset !== undefined) drawDatePreset(preset);
  // The toggle carries the accent when any filter is on, the finished switch included, which the field does not show.
  filterToggle.classList.toggle('active', filtering);
  // The finished view counts against the finished set, and says so, since that total is not the number the switcher shows.
  if (filtering) filterCount.textContent = `Showing ${matches} of ${total}${finished ? ' finished' : ''}`;
  drawClearClose(view.filterPanelOpen);
}

/** Clear and close shows only while the filters are open: shut, there is nothing to close, and Clear does it all. */
function drawClearClose(open: boolean): void {
  filterClearClose.hidden = !open;
}

/** Empty the calendar without its own change applying it: whoever clears it says what the filter is now. */
function clearCalendar(): void {
  suppressPickerSelect = true;
  datePicker.clear();
  suppressPickerSelect = false;
}

function clearFilter(): void {
  customChosen = false;
  clearCalendar();
  drawDatePreset('any');
  searchInput.value = '';
  putFilter(noFilter());
}

/**
 * The filters opened or shut: Clear and close follows.
 * A watcher the sidebar registers (watch.ts), as it does `applyDatePickerMinDate`.
 */
export function filtersFollow(view: View<'filterPanelOpen'>): void {
  drawClearClose(view.filterPanelOpen);
}

/** The days the date terms the calendar writes name (`active:>=` and `active:<=` a date), as its range: what Custom shows picked. */
function datesOf(query: string): Date[] {
  return [...query.matchAll(/\bactive:(?:>=|<=)(\d{4})-(\d{2})-(\d{2})\b/g)].map((found) => new Date(Number(found[1]), Number(found[2]) - 1, Number(found[3])));
}

/**
 * Put the filter's controls back as they were left — the query field and the calendar's range from the query's days — and hand back the filter they make, which the start-up read sets in the store with the listing.
 * The panel starts shut: it is not kept, since the field shows the query without it.
 */
export async function restoreFilter(state: UiState): Promise<FilterState> {
  searchInput.value = state.query;
  const picked = datesOf(state.query);
  if (picked.length > 0) {
    // Flagged rather than the picker's own `silent`, so the calendar still repaints — this only needs onSelect not to set the filter mid-restore.
    suppressPickerSelect = true;
    await datePicker.selectDate(picked);
    suppressPickerSelect = false;
    updateDateRangeLabel(...(picked.slice().sort((a, b) => a.getTime() - b.getTime()) as [Date?, Date?]));
  }
  return { query: state.query, finished: state.finished };
}

searchInput.addEventListener('input', () => {
  customChosen = false;
  setFilter({ query: searchInput.value });
});
filterClear.addEventListener('click', clearFilter);
// Closing alone keeps the filter (decided 2026-09-23); this is the one press that ends it and shuts the filters together.
filterClearClose.addEventListener('click', () => {
  clearFilter();
  filters.close();
});

/**
 * The filter pills, once: each one's button, its mark, its words and the term it writes, or the finished switch.
 * Everything that asks about the pills as a set reads this: how they are drawn and wired, and which are on.
 */
interface FilterPill {
  button: HTMLButtonElement;
  icon: string;
  words: string;
  key: PillKey | 'finished';
}
const FILTER_PILLS: FilterPill[] = [
  { button: openFilter, icon: OPEN_ICON, words: 'Working', key: 'open' },
  { button: liveFilter, icon: LIVE_ICON, words: 'Running', key: 'live' },
  { button: setAsideFilter, icon: SET_ASIDE_ICON, words: 'Set aside', key: 'setAside' },
  { button: finishedFilter, icon: FINISH_ICON, words: 'Finished', key: 'finished' },
  { button: prFilter, icon: PR_ICON, words: 'PR', key: 'prs' },
  { button: siblingFilter, icon: SIBLING_ICON, words: 'Siblings', key: 'siblings' },
  { button: pinnedFilter, icon: PINNED_ICON, words: 'Pinned', key: 'pinned' },
  { button: noteFilter, icon: NOTE_ICON, words: 'Noted', key: 'noted' },
  { button: worktreeFilter, icon: WORKTREE_ICON, words: 'Worktree', key: 'worktree' },
  { button: goneFilter, icon: folderGoneIcon(13), words: 'Folder gone', key: 'gone' },
];

// Each pill shows the same mark the rows use, from the one definition — a glyph would render at a different weight beside them — and its words, which its tooltip says in full.
for (const pill of FILTER_PILLS) {
  pill.button.innerHTML = pill.icon;
  pill.button.append(pill.words);
  // A pill writes its term or takes it out; the finished switch flips the set in view; the list follows, from its top.
  const { key } = pill;
  pill.button.addEventListener('click', () => {
    const { query, finished } = store.get().filter;
    if (key === 'finished') setFilter({ finished: !finished });
    else setPill(key, !hasTerm(query, PILL_TERMS[key], vocabulary()));
  });
}
// The header's toggle draws its mark through the same helper as the rest, rather than inline in the sidebar's markup.
filterToggle.innerHTML = filterIcon(14);
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
  setQuery(withDates(store.get().filter.query, customTerms()));
  customChosen = true;
  drawDatePreset('custom');
}
