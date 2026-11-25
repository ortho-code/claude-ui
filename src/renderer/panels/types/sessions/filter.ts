import type { UiState } from '../../../../shared/types';
import { hasTerm, withoutTerms, withoutTerm, withTerms } from '../../../../shared/query/edit';
import { parseQuery, type Term, type Vocabulary } from '../../../../shared/query/parse';
import { dateTerm, PILL_TERMS, PRESET_TERMS, type PillKey } from '../../../../shared/query/stored-filter';
import { calendar } from '../../../dialogs/calendar';
import { byId, fromMarkup } from '../../../ui/dom';
import { noFilter, store, type FilterState, type View } from '../../../state/app';
import { filterQuery } from '../../../state/filter-query';
import { queryFields } from '../../../state/query-facts';
import { followFieldScroll, queryMirror, queryProblemList, showQueryProblems } from './query-problems';
import { isFiltering } from '../../../state/views';
import { finishIcon, closeIcon, folderGoneIcon, SET_ASIDE_ICON, NOTE_ICON, PINNED_ICON, PR_ICON, SIBLING_ICON, strokeIcon, svgImage, WORKTREE_ICON } from '../../../ui/svg';
import { setTooltip } from '../../../ui/tooltip';
import { iconSvg } from '../../icons';
// The filter pill its pills and presets wear, shared with the history's All · Pinned.
import '../../../ui/pill.css';
import '../../../ui/popover.css';
import './filter.css';

/**
 * The sidebar's filter: the header's toggle, the panel under it — the query field, the pills and the date presets with their calendar — and, under the panel, the count with Clear and the chips that stand in for a shut panel.
 * The query field is the filter: a pill or a preset writes its term into it and shows on while its term is there (the session-model design's decision 17), and only the finished switch stands beside it.
 * It sets the filter and the panel in the store; the list follows, and hands back the count it drew (`updateFilterStatus`), since only the list knows what matched.
 */

/** The filter's three parts, built here and placed by the sidebar (index.ts): the header's toggle, the panel under the header, and the status line under the panel. */
export const filterToggle = fromMarkup(`<button id="filter-toggle" class="icon-btn large" data-tooltip="Filter sessions" aria-label="Filter sessions" aria-expanded="false"></button>`, HTMLButtonElement);
export const filterPanel = fromMarkup(`
  <div id="filter-panel" hidden>
    <div id="query-wrap"><input id="search" type="search" placeholder="Search, or is:pinned OR is:running…" aria-label="Search or filter sessions" spellcheck="false" /></div>
    <div id="filters">
      <button id="pinned-filter" data-tooltip="Show only pinned sessions" aria-label="Show only pinned sessions" aria-pressed="false"></button>
      <button id="open-filter" type="button" data-tooltip="Show only sessions with a tab open" aria-label="Show only sessions with a tab open" aria-pressed="false"></button>
      <button id="live-filter" type="button" data-tooltip="Show only live sessions" aria-label="Show only live sessions" aria-pressed="false"></button>
      <button id="set-aside-filter" type="button" data-tooltip="Show only sessions set aside" aria-label="Show only sessions set aside" aria-pressed="false"></button>
      <button id="worktree-filter" type="button" data-tooltip="Show only worktree sessions" aria-label="Show only worktree sessions" aria-pressed="false"></button>
      <button id="sibling-filter" type="button" data-tooltip="Show only sessions with siblings" aria-label="Show only sessions with siblings" aria-pressed="false"></button>
      <button id="pr-filter" type="button" data-tooltip="Show only sessions with a PR" aria-label="Show only sessions with a PR" aria-pressed="false"></button>
      <button id="note-filter" type="button" data-tooltip="Show only sessions with a note" aria-label="Show only sessions with a note" aria-pressed="false"></button>
      <button id="finished-filter" type="button" data-tooltip="Show finished sessions" aria-label="Show finished sessions" aria-pressed="false"></button>
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
    <div id="date-custom" class="popover attach-top" hidden>
      <div id="date-range"></div>
      <div id="date-range-caption"></div>
    </div>
  </div>`);
export const filterStatus = fromMarkup(`
  <div id="filter-status" hidden>
    <div id="filter-chips" hidden></div>
    <span id="filter-count"></span>
    <span class="filter-actions">
      <button id="filter-clear" type="button">Clear</button>
      <button id="filter-clear-close" type="button">Clear and close</button>
    </span>
  </div>`);

const pinnedFilter = byId(filterPanel, 'pinned-filter', HTMLButtonElement);
const openFilter = byId(filterPanel, 'open-filter', HTMLButtonElement);
const liveFilter = byId(filterPanel, 'live-filter', HTMLButtonElement);
const setAsideFilter = byId(filterPanel, 'set-aside-filter', HTMLButtonElement);
const worktreeFilter = byId(filterPanel, 'worktree-filter', HTMLButtonElement);
const siblingFilter = byId(filterPanel, 'sibling-filter', HTMLButtonElement);
const prFilter = byId(filterPanel, 'pr-filter', HTMLButtonElement);
const noteFilter = byId(filterPanel, 'note-filter', HTMLButtonElement);
const finishedFilter = byId(filterPanel, 'finished-filter', HTMLButtonElement);
const goneFilter = byId(filterPanel, 'gone-filter', HTMLButtonElement);
const datePresets = byId(filterPanel, 'date-presets');
const dateCustom = byId(filterPanel, 'date-custom');
const dateRangeLabel = byId(filterPanel, 'date-range-label'); // persistent line under presets
const dateRangeCaption = byId(filterPanel, 'date-range-caption'); // same text, inside calendar
const pad2 = (n: number): string => String(n).padStart(2, '0');
// Inline range calendar, the app's own (calendar.ts): click the header to zoom out to a months grid, then a years grid, arrows paging through.
// Capped at today: sessions are never in the future.
let suppressPickerSelect = false;
const datePicker = calendar(byId(filterPanel, 'date-range'), {
  range: true,
  maxDate: new Date(),
  onSelect: () => {
    if (!suppressPickerSelect) onCustomDateChange();
  },
});
const searchInput = byId(filterPanel, 'search', HTMLInputElement);
const queryWrap = byId(filterPanel, 'query-wrap');
queryWrap.append(queryMirror);
queryWrap.after(queryProblemList);
searchInput.addEventListener('scroll', () => followFieldScroll(searchInput));
const SEARCH_CLEAR_SIZE = 12;
searchInput.style.setProperty('--search-clear', svgImage(closeIcon(SEARCH_CLEAR_SIZE)));
searchInput.style.setProperty('--search-clear-size', `${SEARCH_CLEAR_SIZE}px`);
const filterCount = byId(filterStatus, 'filter-count');
const filterChips = byId(filterStatus, 'filter-chips');
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
 * Set the filter: the list, its count and its chips follow the store.
 * Any change of the filter takes the folds made under it (`Folds`), in the same change: new results can sit in a section folded for the old ones, and a filter that ends has no use for them at all.
 * Every change you make to the filter comes here — a character typed or deleted, a pill, a preset, the calendar, a chip's ×, Clear, Clear and close; the launch restores the filter directly, with the folds stored beside it.
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
  // The toggle carries the accent when any filter is on, beside the status line under the panel, so an active filter is visible even with the panel closed.
  filterToggle.classList.toggle('active', filtering);
  // The finished view counts against the finished set, and says so, since that total is not the number the switcher shows.
  if (filtering) filterCount.textContent = `Showing ${matches} of ${total}${finished ? ' finished' : ''}`;
  updateFilterChips(view);
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

// --- What is on, while the panel is shut ---
// Closing the panel over a filter keeps the filter, so the panel folds down to a row of what is on rather than disappearing: each term of the query, the finished switch, each with its own ×.
// A filter that is on is never out of sight, which is the whole point; the count and Clear on the line below stay as they are with the panel open.

// What the chips were last built from, so the row is rebuilt only when that changes: renders happen constantly, and rebuilding each time would drop the hover and focus from under the pointer.
let lastChipsSignature = '';
let lastChipsVocabulary: Vocabulary | null = null;

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

/**
 * A chip per term of a query of one part: a pill's term with the pill's mark, a date with the clock, any other as its words; × takes that term out.
 * A query of several parts, or one that does not read, is one chip of its whole text, since a term of one part is not a filter on its own; × empties it.
 */
function queryChips(query: string): HTMLElement[] {
  const parsed = parseQuery(query, vocabulary());
  const text = query.trim();
  if (text === '') return [];
  const [part] = parsed.parts;
  if (parsed.problems.length > 0) {
    const chip = filterChip(iconSvg('search', 13), text, `Does not read: ${parsed.problems.map((problem) => problem.message).join(' ')}`, () => setQuery(''));
    chip.classList.add('has-problems');
    return [chip];
  }
  if (parsed.parts.length !== 1 || part === undefined) return [filterChip(iconSvg('search', 13), text, `Query: ${text}`, () => setQuery(''))];
  return part.map((term) => {
    const said = query.slice(term.from, term.to);
    const remove = (): void => setQuery(withoutTerms(store.get().filter.query, (each) => each.from === term.from, vocabulary()));
    const pill = FILTER_PILLS.find((each) => each.key !== 'finished' && hasTerm(said, PILL_TERMS[each.key], vocabulary()));
    if (pill) return filterChip(pill.icon, '', pill.button.getAttribute('aria-label') ?? said, remove);
    if (isDateTerm(term)) {
      // A preset's term says what the preset's button says, so the chip reads the same words as the control that set it.
      const preset = (Object.keys(PRESET_TERMS) as (keyof typeof PRESET_TERMS)[]).find((key) => PRESET_TERMS[key] === said.toLowerCase());
      const words = preset === undefined ? said : (datePresets.querySelector(`[data-range="${preset}"]`)?.textContent ?? said);
      return filterChip(iconSvg('clock', 13), words, `Last active: ${words}`, remove);
    }
    return filterChip(iconSvg('search', 13), said, `Search: ${said}`, remove);
  });
}

function updateFilterChips(view: View<'filter' | 'filterPanelOpen'>): void {
  const show = isFiltering(view) && !view.filterPanelOpen;
  // A shut panel leaves nothing to close, so Clear does it all there.
  filterClearClose.hidden = !view.filterPanelOpen;
  filterChips.hidden = !show;
  filterStatus.classList.toggle('collapsed', show);
  if (!show) {
    lastChipsSignature = '';
    return;
  }
  const { query, finished } = view.filter;
  const signature = JSON.stringify([query, finished]);
  // The fields too, since a query can start or stop reading when the needs-you types change.
  if (signature === lastChipsSignature && vocabulary() === lastChipsVocabulary) return;
  lastChipsSignature = signature;
  lastChipsVocabulary = vocabulary();
  const chips = queryChips(query);
  if (finished) chips.push(filterChip(FINISH_ICON, '', finishedFilter.getAttribute('aria-label') ?? '', () => setFilter({ finished: false })));
  filterChips.replaceChildren(...chips);
}

/**
 * Show or hide the filter panel.
 * Split out because the restore draws it from what was stored, before the view is in the store, and must not touch focus: at startup the terminal wants it.
 */
function drawFilterPanel(open: boolean): void {
  filterPanel.hidden = !open;
  filterToggle.setAttribute('aria-expanded', String(open));
}

/**
 * The panel opened or shut: it follows, with the chips that stand in for it while it is shut.
 * A watcher the sidebar registers (watch.ts), as it does `applyDatePickerMinDate`.
 */
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

/** The days the date terms the calendar writes name (`active:>=` and `active:<=` a date), as its range: what Custom shows picked. */
function datesOf(query: string): Date[] {
  return [...query.matchAll(/\bactive:(?:>=|<=)(\d{4})-(\d{2})-(\d{2})\b/g)].map((found) => new Date(Number(found[1]), Number(found[2]) - 1, Number(found[3])));
}

/**
 * Put the filter's controls back as they were left — the query field, the calendar's range from the query's days, the panel — and hand back the filter they make, which the start-up read sets in the store with the listing.
 * Before the view is in the store, so the panel is drawn from what was stored (`drawFilterPanel`) rather than followed.
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
  drawFilterPanel(state.filterPanelOpen);
  return { query: state.query, finished: state.finished };
}

searchInput.addEventListener('input', () => {
  customChosen = false;
  setFilter({ query: searchInput.value });
});
filterClear.addEventListener('click', clearFilter);
// Closing alone keeps the filter (decided 2026-09-23); this is the one press that ends it and shuts the panel together.
filterClearClose.addEventListener('click', () => {
  clearFilter();
  toggleFilterPanel(false);
});

/**
 * The filter pills, once, in the order they sit in the panel: each one's button, its mark and the term it writes, or the finished switch.
 * Everything that asks about the pills as a set reads this — how they are drawn and wired, which chips stand in for a shut panel — so the chips cannot fall out of step with the panel.
 */
interface FilterPill {
  button: HTMLButtonElement;
  icon: string;
  key: PillKey | 'finished';
}
const FILTER_PILLS: FilterPill[] = [
  { button: pinnedFilter, icon: PINNED_ICON, key: 'pinned' },
  { button: openFilter, icon: OPEN_ICON, key: 'open' },
  { button: liveFilter, icon: LIVE_ICON, key: 'live' },
  { button: setAsideFilter, icon: SET_ASIDE_ICON, key: 'setAside' },
  { button: worktreeFilter, icon: WORKTREE_ICON, key: 'worktree' },
  { button: siblingFilter, icon: SIBLING_ICON, key: 'siblings' },
  { button: prFilter, icon: PR_ICON, key: 'prs' },
  { button: noteFilter, icon: NOTE_ICON, key: 'noted' },
  { button: finishedFilter, icon: FINISH_ICON, key: 'finished' },
  { button: goneFilter, icon: folderGoneIcon(13), key: 'gone' },
];

// Each pill shows the same mark the rows use, from the one definition — a glyph would render at a different weight beside them.
// Icon-only: the words cost the panel an extra line at a 320px sidebar, and every pill carries a tooltip and an aria-label (see panels/types/sessions/index.ts) for what it means.
for (const pill of FILTER_PILLS) {
  pill.button.innerHTML = pill.icon;
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
  setQuery(withDates(store.get().filter.query, customTerms()));
  customChosen = true;
  drawDatePreset('custom');
}
