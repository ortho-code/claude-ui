import { defaultUi } from '../../shared/defaults';
import type { PanelData } from '../../shared/panels';
import type { GroupState, SessionSummary, UiState } from '../../shared/types';
import { sameRow, structuralSignature } from '../logic';
import { createStore } from './store';

/**
 * The window's shared state (docs/architecture.md § The store): what more than one surface draws, or what a surface draws and another changes.
 * A slice holds a value that is replaced, never changed in place, since a change in place tells nobody.
 */
export interface AppState {
  /** Every session the listing read from disk, the tips of families included, as main lists them. */
  sessions: SessionSummary[];
  /** Session id -> its status as its hooks last reported it (busy, idle, waiting, …); a session with none is absent. */
  statuses: ReadonlyMap<string, string>;
  /** Sessions whose dot you marked read: dimmed, not pulsing. In memory only, so a restart lights everything again; any status event clears a session's mark. */
  acked: ReadonlySet<string>;
  /**
   * Session id -> the model it switched to while the app was watching.
   * A transcript records which model ANSWERED, never which one was chosen, so `/model` leaves no trace in it until the next reply — and the row went on naming the old model in between.
   * `PostModelSwitch` is the only place that answer exists at the moment it becomes true, so it is kept here and preferred over the transcript's.
   * In memory only: it can never be staler than what is on disk (every switch in this app's sessions lands here), and after a restart the transcript's own last answer is the right source again.
   */
  switchedModel: ReadonlyMap<string, string>;
  /** Pinned sessions, by entity key: floated to the top of their section in the list. */
  pinned: ReadonlySet<string>;
  /** Archived sessions, by entity key -> when they were archived (epoch ms): out of the normal view, and all the archived view holds. */
  archived: ReadonlyMap<string, number>;
  /** Entity key -> its note; a session without one is absent, since a blank note deletes it. */
  notes: ReadonlyMap<string, string>;
  /** Sessions whose delete is in flight: hidden from the list until that delete resolves, so a concurrent delete's re-read can't briefly resurrect them. */
  pendingDeletes: ReadonlySet<string>;
  /**
   * Every group and who is in one, as main hands it back whole after every change.
   * A session started inside a group is filed under its real id before claude has even spawned — the app mints that id — so there is no transient membership to hold anywhere: what is drawn is what meta says, always.
   */
  groupState: GroupState;
  /** Repo root -> the name you gave the project; a project without one is called after its folder. */
  projectNames: ReadonlyMap<string, string>;
  /**
   * Every project ever seen, in the order you set: the list, the switcher, the strip and the tab bar all place projects by it.
   * Seeded from the recency order the list already had, so switching it on changed nothing on screen; from then on it only moves when you move it.
   */
  projectOrder: readonly string[];
  /** The project you are looking at, or null for All: the list, the switcher, the tab bar, the pane and the panels' context all honour it. Written through to main by whoever changes it. */
  activeProject: string | null;
  /** The open tabs, in the bar's order, which is yours: the tab bar, the rows' marks, the strip, the open and live filters and the pane all draw them. */
  tabs: readonly TabState[];
  /** The tab on show, by its token, or null for none: the tab bar, the rows, the pane, the history and the panels' context all follow it. */
  activeTab: string | null;
  /**
   * Each panel's own data as last read, by entry key: the sessions its rows started (main's `panel-data/`), which a row marks and goes back to.
   * Read the first time a panel asks, and kept current by main's pushes after every write, a forgotten session's included (panels/links.ts).
   */
  panelData: ReadonlyMap<string, PanelData>;
  /** The sidebar's filter as it is set: the list, its count and chips, and the folds in play all follow it, and it is kept for the next launch. */
  filter: FilterState;
  /** The list's folded sections, kept for the next launch; the list folds what it has drawn in place as they change, without drawing it again. */
  folds: Folds;
  /** Whether the filter panel is open, kept for the next launch: shut over a filter, it leaves a row of chips naming what is on. */
  filterPanelOpen: boolean;
  /** Whether the attention strip shows its rows or only its line, kept for the next launch. */
  footerExpanded: boolean;
}

/** The sections folded away: projects by repo root, groups by their own id. */
export interface Folds {
  projects: ReadonlySet<string>;
  groups: ReadonlySet<string>;
  /**
   * The same two, for while a filter is on — and a separate pair rather than a flag, because they answer a different question.
   *
   * Filtering opens the whole tree, so that a match inside something you had folded away is not hidden from you.
   * Folding from there is a way THROUGH the results — shut a project you have already looked at — rather than a statement about how you like the sidebar arranged.
   * So these last exactly as long as the filter, and leave the folds you made without a filter untouched underneath.
   *
   * They are stored all the same: the filter itself is restored on the next launch, and coming back to the same results without the same view is precisely what remembering the view is for.
   */
  filterProjects: ReadonlySet<string>;
  filterGroups: ReadonlySet<string>;
}

/**
 * The filter, in the shape it is stored in, so the two cannot come apart: the search as typed, the pills, and the date window its preset or the calendar gave (a rolling preset's window is worked out when it is chosen).
 */
export type FilterState = Pick<UiState, 'search' | 'filters' | 'datePreset' | 'dateFrom' | 'dateTo'>;

/** No filter at all: what a first run has, and what Clear goes back to. */
export function noFilter(): FilterState {
  const { search, filters, datePreset, dateFrom, dateTo } = defaultUi();
  return { search, filters, datePreset, dateFrom, dateTo };
}

/** What the start-up read puts back in the store, in its own change beside the listing: the view as it was left. */
export type StoredView = Pick<AppState, 'filter' | 'folds' | 'filterPanelOpen' | 'footerExpanded'>;

/** A tab's data, as the surfaces draw it; its terminal — the xterm and its element — is the terminal area's own, under the same token. */
export interface TabState {
  /**
   * Names this TAB for the status hook, which echoes it back.
   * The tab's session id would not do: `/clear` ends the session and starts another in the same terminal, and this is what says the two belong to the same tab.
   */
  token: string;
  session: SessionSummary;
  /**
   * The running process, or null when the tab is COLD — built and listed, with no claude behind it.
   * Restored tabs start cold and spawn on activation; a null id is why nothing routes to them and why their input is dropped rather than sent nowhere.
   */
  terminalId: number | null;
  /** Guards against a second start while the first is still awaiting its terminal id. */
  starting: boolean;
  /**
   * Spawned, but nothing has come out of the pty yet — the window where the pane would otherwise be black.
   * MEASURED at 2.3-3.4s for a claude start, which is far too long to show nothing.
   * Cleared by the first byte of output, deliberately rather than by anything claude-specific: whether claude draws on the alternate screen buffer depends on its renderer (`"tui": "fullscreen"` does, the default does not), so there is no one "the TUI is up" marker to wait for, and a signal that depends on how claude renders would break the moment it changed.
   */
  booting: boolean;
  /** Set while a user-initiated stop is in flight, so its exit cools the tab instead of closing it. */
  stopping: boolean;
  /**
   * Why the last attempt to start this tab was refused, shown in place of the pane until it is tried again.
   * A refusal is not an exit: the tab never had a process, so nothing arrives on the terminal to explain itself.
   */
  failure: string | null;
}

/** `map` with `key` set to `value`, or without it for `undefined`: a copy when that changes anything, the same map when it does not, so nobody is told for nothing. */
export function withEntry<K, V>(map: ReadonlyMap<K, V>, key: K, value: V | undefined): ReadonlyMap<K, V> {
  if (value === undefined ? !map.has(key) : map.get(key) === value) return map;
  const next = new Map(map);
  if (value === undefined) next.delete(key);
  else next.set(key, value);
  return next;
}

/** `set` with `key` in it or not: a copy when that changes anything, the same set when it does not. */
export function withMember<T>(set: ReadonlySet<T>, key: T, member: boolean): ReadonlySet<T> {
  if (set.has(key) === member) return set;
  const next = new Set(set);
  if (member) next.add(key);
  else next.delete(key);
  return next;
}

/** The slices a repaint is handed: the ones it is told about and the ones it reads. */
export type View<K extends keyof AppState> = Readonly<Pick<AppState, K>>;

const signatures = new WeakMap<SessionSummary[], string>();

/**
 * Whether two listings draw the same rows: their structural signature (`AFFECTS_ROW` in logic.ts), computed once per listing.
 * The sessions slice tells its readers only when this says no, so a transcript merely growing — its `lastActivity` moving — repaints nothing, for every reader alike, while `get` still has the newest listing.
 */
function sameRows(a: SessionSummary[], b: SessionSummary[]): boolean {
  const of = (sessions: SessionSummary[]): string => {
    let signature = signatures.get(sessions);
    if (signature === undefined) {
      signature = structuralSignature(sessions);
      signatures.set(sessions, signature);
    }
    return signature;
  };
  return of(a) === of(b);
}

/** Whether two maps hold the same entries: a map read afresh from main is a new object even when nothing in it moved. */
function sameEntries<K, V>(a: ReadonlyMap<K, V>, b: ReadonlyMap<K, V>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value || !b.has(key)) return false;
  return true;
}

/** Whether two sets hold the same members, for the same reason. */
function sameMembers<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const member of a) if (!b.has(member)) return false;
  return true;
}

/** Whether two lists hold the same items in the same order. */
function sameOrder<T>(a: readonly T[], b: readonly T[]): boolean {
  return a === b || (a.length === b.length && a.every((item, i) => item === b[i]));
}

/**
 * Whether two answers from main hold the same data, compared as the JSON they crossed as.
 * Whole rather than field by field, so a field added to the answer cannot be missed; the same data in another key order only tells for nothing.
 */
function sameData<T>(a: T, b: T): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** Whether two fold states fold the same sections. */
function sameFolds(a: Folds, b: Folds): boolean {
  return a === b || (sameMembers(a.projects, b.projects) && sameMembers(a.groups, b.groups) && sameMembers(a.filterProjects, b.filterProjects) && sameMembers(a.filterGroups, b.filterGroups));
}

/**
 * Whether two lists draw the same tabs: the same tabs in the same order, each in the same state, with a session that draws the same row (`sameRow`, which a tab shows less of).
 * Every field of a tab but its session is compared as it is, so one added later cannot be missed; a fresh read adopted into every open tab tells nobody unless something a tab shows moved.
 */
function sameTabs(a: readonly TabState[], b: readonly TabState[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((tab, i) => {
    const other = b[i]!;
    return tab === other || (Object.keys(tab) as (keyof TabState)[]).every((key) => (key === 'session' ? sameRow(tab.session, other.session) : tab[key] === other[key]));
  });
}

export const store = createStore<AppState>(
  {
    sessions: [],
    statuses: new Map(),
    acked: new Set(),
    switchedModel: new Map(),
    pinned: new Set(),
    archived: new Map(),
    notes: new Map(),
    pendingDeletes: new Set(),
    groupState: { groups: [], groupOf: {} },
    projectNames: new Map(),
    projectOrder: [],
    activeProject: null,
    tabs: [],
    activeTab: null,
    panelData: new Map(),
    filter: noFilter(),
    folds: { projects: new Set(), groups: new Set(), filterProjects: new Set(), filterGroups: new Set() },
    filterPanelOpen: defaultUi().filterPanelOpen,
    footerExpanded: defaultUi().footerExpanded,
  },
  {
    sessions: sameRows,
    statuses: sameEntries,
    pinned: sameMembers,
    archived: sameEntries,
    notes: sameEntries,
    pendingDeletes: sameMembers,
    groupState: sameData,
    projectNames: sameEntries,
    projectOrder: sameOrder,
    tabs: sameTabs,
    panelData: sameEntries,
    filter: sameData,
    folds: sameFolds,
  },
);
