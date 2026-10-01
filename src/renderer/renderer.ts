// The bundle's stylesheets come in the order of these imports: what every module draws with, then the services' and the panel tree's own, then the rules no module has taken yet, which build on all of them.
import './base.css';
import { openMenu, type MenuItem } from './menu';
import { setUnavailable, unavailable } from './unavailable';
import { hideToast, showToast } from './toast';
import { showAttentionToast } from './notifications';
import { confirmDelete, promptText } from './dialogs';
import { openSettings } from './settings';
import { markProjectGone } from './projectgone';
import { startChrome } from './chrome';
import { flash } from './flash';
import { initTree, loadLayout, startPanels, restoreTreeState, treeState, treeContextChanged, treeSessionsChanged } from './panels/tree';
import { railStatusFollowsTabs } from './panels/types/claude/index';
import { history, paneFollows } from './panels/types/claude/pane';
import {
  activateTab,
  closeTab,
  createTab,
  persistOpenTabs,
  reconcileOpenTabs,
  restoreOpenTabs,
  setTab,
  startTab,
  stopSession,
  switchWorkspaceTerminal,
  tabOf,
  type TabLaunch,
} from './panels/types/claude/terminals';
import { renderTabBar, tabBarFollowsStatuses } from './panels/types/claude/tab-bar';
import { fallBackIfEmptied, refreshSwitcher, selectProject } from './panels/types/sessions/switcher';
import { refreshStrip } from './panels/types/sessions/attention-strip';
import { applyDatePickerMinDate, filterPanelFollows, groupNameByKey, passesFilters, restoreFilter, updateFilterStatus } from './panels/types/sessions/filter';
import './styles.css';
import { store, withEntry, withMember, type AppState, type TabState, type View } from './state/app';
import { isFiltering, projName, projectGroups, searchText, sessionById, statusChanges, tabOnShow, tabWith, viewPool, visibleSessions } from './state/views';
import { setStatus } from './state/statuses';
import { applyGroupState, moveSessionToGroup } from './state/groups';
import { foldedGroups, foldedProjects, foldsWith } from './state/folds';
import { ackOnClick, applyStatus } from './statusdot';
import { newSession, untitledLabel } from './newsession';
import type { OrderMove, SessionSummary, UiState } from '../shared/types';
import {
  structuralSignature,
  buildProjectTree,
  folderName,
  entityKey,
  type ProjectTree,
  groupJumpTargets,
  type GroupJumpTarget,
  relativeTime,
  modelLabel,
  unstartableReason,
  projectGoneReason,
  sessionLabel,
} from './logic';
import { installTooltips, setTooltip } from './tooltip';
import { caretIcon, chevronIcon, folderIcon, layersIcon, NOTE_ICON, PIN_ICON, PINNED_ICON, SIBLING_ICON, strokeIcon, WORKTREE_ICON } from './svg';
import { routeTerminals } from './terminal';
import { hostOf } from './panels/types/builtin';

const container = document.getElementById('sessions')!;
const newButton = document.getElementById('new-session') as HTMLButtonElement;
const collapseToggle = document.getElementById('collapse-toggle') as HTMLButtonElement;

// The chrome marks — carets, +, ⋮, ✓, × — as SVG rather than the text glyphs they used to be.
// Every one of those resolved through system font fallback, which is how ⑂ ended up rendering from a MONOSPACE face beside its neighbours (see the family and worktree marks in svg.ts).
// These render the same whatever the system has installed, take their colour from `currentColor` like the other icons, and are drawn through `strokeIcon`, which keeps their weight equal at every size.
// Chevrons, not filled triangles: the collapse-all button already says fold/unfold with a chevron, and a solid triangle would be the only filled shape in an outline icon set.
const chevronDown = (size: number): string => chevronIcon('down', size);
const plusIcon = (size: number): string => strokeIcon(size, '<path d="M8 3.5V12.5M3.5 8H12.5" />');
// Settings as two sliders, each with its knob.
const settingsIcon = (size: number): string =>
  strokeIcon(size, '<path d="M2 4.6h8.1M13.1 4.6h.9M2 11.4h2.9M7.9 11.4h6.1" /><circle cx="11.7" cy="4.6" r="1.6" /><circle cx="6.4" cy="11.4" r="1.6" />');
// Dots, so it stays a kebab rather than becoming a dashed line. The radius is in px for the same reason the stroke is: three 2.6px dots whatever the button's size.
const kebabIcon = (size: number): string => {
  const r = ((1.3 * 16) / size).toFixed(2);
  return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="currentColor"><circle cx="8" cy="3.4" r="${r}" /><circle cx="8" cy="8" r="${r}" /><circle cx="8" cy="12.6" r="${r}" /></svg>`;
};
const loadingEl = document.getElementById('loading')!;
const settingsToggle = document.getElementById('settings-toggle') as HTMLButtonElement;

/** The statuses as the toasts last saw them, so only a change of state is news. */
let toastedStatuses: View<'statuses'>['statuses'] = new Map();

/**
 * A real transition into waiting/idle on a tab you're not looking at -> toast it. Never for busy, a cleared status, a no-op repeat, or the tab you're already on.
 * Start-up's read of every status toasts nothing: it lands before the tabs are restored, so no session in it has a tab yet.
 */
function toastAttention(view: View<'statuses' | 'tabs' | 'activeTab' | 'projectNames'>): void {
  const before = toastedStatuses;
  toastedStatuses = view.statuses;
  for (const [id, status] of view.statuses) {
    if ((status !== 'waiting' && status !== 'idle') || status === before.get(id)) continue;
    const tab = tabWith(id, view);
    if (!tab || tab.token === view.activeTab) continue;
    const { token } = tab;
    showAttentionToast({ status, label: sessionLabel(tab.session), project: projName(tab.session.repoRoot, view), open: () => jumpToTab(token) });
  }
}

// Jump to a tab from a toast: scope to its project if we're viewing a different one, then activate it.
function jumpToTab(token: string): void {
  const tab = tabOf(token);
  // Closed since the toast went up: there is nothing left to go to.
  if (!tab) return;
  const { activeProject } = store.get();
  if (activeProject !== null && activeProject !== tab.session.repoRoot) {
    hostOf('claude').selectProject(tab.session.repoRoot);
  }
  activateTab(token);
}

function setLoading(on: boolean): void {
  loadingEl.classList.toggle('active', on);
}

// Status dots by tip session id; rebuilt each render (a status event names a session id).
const statusDots = new Map<string, HTMLElement>();
// Row elements by entity key (the session id), reused across renders so a re-render moves nodes instead of recreating them — no flicker, no scroll jump, hover/focus kept.
const sessionRows = new Map<string, HTMLElement>();
// Every section currently rendered, so collapse-all/expand-all acts on precisely what is on screen rather than on everything that has ever existed.
let renderedSections: { projects: string[]; groups: string[] } = { projects: [], groups: [] };

/** Open a folded project or group, for a reveal or a jump, which draw the list themselves; says whether it was folded. */
function unfold(kind: 'projects' | 'groups', key: string): boolean {
  const state = store.get();
  if (!(kind === 'projects' ? foldedProjects(state) : foldedGroups(state)).has(key)) return false;
  store.set({ folds: foldsWith(state, kind, [key], false) });
  return true;
}
interface ProjectSectionEls {
  section: HTMLElement;
  heading: HTMLElement;
  caret: HTMLElement;
  count: HTMLElement;
  /** The folder in front of the name, which turns into the crossed-out folder when the project's folder is gone. */
  icon: HTMLElement;
  label: HTMLElement;
  /** Opens the jump-to-a-group menu; hidden below 2 targets, disabled while filtering. */
  groupsBtn: HTMLButtonElement;
  /** The new-session split-button's dropdown caret (present only for a project with a folder). */
  addCaret?: HTMLElement;
  /** The new-session "+" itself, disabled when the project's folder is gone. */
  addBtn?: HTMLButtonElement;
}
// What each project's group menu offers, refreshed on every render so the menu can't name a group that has since been deleted or renamed.
const jumpTargets = new Map<string, GroupJumpTarget[]>();
// Project sections by repo root, reused across renders (same reason as sessionRows).
const projectSections = new Map<string, ProjectSectionEls>();

interface GroupSectionEls {
  section: HTMLElement;
  /** The h3 itself — what a jump scrolls to and flashes. */
  heading: HTMLElement;
  caret: HTMLElement;
  label: HTMLElement;
  count: HTMLElement;
  /** The new-session split-button's dropdown caret; hidden unless the project is a git repo. */
  addCaret: HTMLElement;
  /** The new-session "+" itself, disabled when the project's folder is gone. */
  addBtn: HTMLButtonElement;
  /** Holds the member rows; the indent and its rail live on this element. */
  members: HTMLElement;
  /** Shown instead of rows when the group has no members yet. */
  empty: HTMLElement;
}
// Group sections by group id, reused across renders like the project sections above.
const groupSections = new Map<string, GroupSectionEls>();
// The session each row currently shows, by entity key (session id), so a reused row's click/pin handlers act on the live session data of the latest render.
let currentByKey = new Map<string, SessionSummary>();

function updateSidebarHighlight(view: View<'tabs' | 'activeTab'>): void {
  const shown = tabOnShow(view);
  for (const row of sessionRows.values()) {
    const id = row.dataset.sid ?? '';
    const tab = tabWith(id, view);
    row.classList.toggle('open', tab !== undefined);
    // "Has a tab" and "is running" stopped being the same thing once tabs restore cold, so the row says which: an accent bar for a live session, a muted one for a tab waiting to be resumed.
    row.classList.toggle('cold', tab?.terminalId === null);
    row.classList.toggle('active-session', shown?.session.id === id);
  }
}

/** The tabs as the list last followed them, so a change draws the list again only when what the list draws from them moved. */
let listedTabs: View<'tabs'>['tabs'] = [];

/**
 * A tab opened, started, stopped, closed or came on show: the rows' marks follow, and the list itself is drawn again only when what it draws from the tabs moved.
 * The open and live filters ask which sessions have a tab and which of those run, and a session with no transcript yet is in the list only through its tab's stand-in row.
 */
function listFollowsTabs(view: ListView): void {
  const before = listedTabs;
  listedTabs = view.tabs;
  const onDisk = new Set(view.sessions.map((s) => s.id));
  const keys = (tabs: readonly TabState[], running: boolean): string =>
    tabs
      .filter((t) => !running || t.terminalId !== null)
      .map((t) => entityKey(t.session))
      .sort()
      .join('\n');
  const standIns = (tabs: readonly TabState[]): string => structuralSignature(tabs.filter((t) => !onDisk.has(t.session.id)).map((t) => t.session));
  const { open, live } = view.filter.filters;
  const moved =
    (open && keys(before, false) !== keys(view.tabs, false)) ||
    (live && keys(before, true) !== keys(view.tabs, true)) ||
    standIns(before) !== standIns(view.tabs);
  if (moved) renderList(view);
  else updateSidebarHighlight(view);
}

/** The model to show for a session: the one it has switched to if we saw that happen, else the one that last answered. */
function modelOf(session: SessionSummary, view: View<'switchedModel'>): string {
  return view.switchedModel.get(session.id) ?? session.model;
}

/** What the rows' dots were last painted from, so a change repaints only the dots that differ. */
let paintedDots: View<'statuses' | 'acked'> = { statuses: new Map(), acked: new Set() };

/**
 * A status or a mark read changed: repaint the rows' dots that differ.
 * Not the list: it paints every dot it draws itself, and this is what keeps them current between its renders.
 */
function dotsFollowStatuses(view: View<'statuses' | 'acked'>): void {
  const ids = statusChanges(paintedDots, view);
  paintedDots = { statuses: view.statuses, acked: view.acked };
  for (const id of ids) {
    const dot = statusDots.get(id);
    if (dot) applyStatus(dot, view.statuses.get(id), view.acked.has(id));
  }
}

// --- Sidebar ---

interface FullRead {
  /** Show the loading bar while it reads. */
  showLoading?: boolean;
  /** A session whose delete just resolved, which stops being hidden in the same change as the re-read. */
  revealed?: string;
  /** Start-up's read, which also takes the project you were in and the view you left (`restoreUiState`): in the same change, so the first draw is already scoped and filtered rather than drawn for All, whole, first. */
  startUp?: StoredView;
}

/** A full read of what the list draws from main, set in one change. */
async function renderSessions({ showLoading = true, revealed, startUp }: FullRead = {}): Promise<void> {
  if (showLoading) setLoading(true);
  try {
    const [sessions, pinnedList, archivedList, statusMap, namesMap, noteMap, groupState, storedProject] = await Promise.all([
      window.claudeUi.listSessions(),
      window.claudeUi.getPinned(),
      window.claudeUi.getArchived(),
      window.claudeUi.getAllStatuses(),
      window.claudeUi.getProjectNames(),
      window.claudeUi.getNotes(),
      window.claudeUi.getGroupState(),
      startUp ? window.claudeUi.getActiveProject() : null,
    ]);
    // Seed from the RAW list (archived included — the transcript still exists), so a project whose sessions are all archived still holds a slot.
    // Writes only when a root is genuinely new, so the common case costs one read.
    // Recency order is what seeds the very first run.
    const projectOrder = await window.claudeUi.seedProjectOrder([...new Set(sessions.map((s) => s.repoRoot))]);
    store.set({
      sessions,
      statuses: new Map(Object.entries(statusMap)),
      pinned: new Set(pinnedList),
      archived: new Map(Object.entries(archivedList)),
      notes: new Map(Object.entries(noteMap)),
      groupState,
      projectNames: new Map(Object.entries(namesMap)),
      projectOrder,
      // In the same change, so a row whose files are gone never shows for a moment between no longer hiding it and the listing without it.
      ...(revealed === undefined ? {} : { pendingDeletes: withMember(store.get().pendingDeletes, revealed, false) }),
      ...(startUp ? { activeProject: storedProject, ...startUp } : {}),
    });
  } finally {
    if (showLoading) setLoading(false);
  }
}

// A disk change fired: re-read sessions; the store tells the list and the tabs only when the structure actually changed (a new/removed session, a rename, or a new branch becoming the tip).
// Statuses and pins arrive on their own channels, so we don't refetch them here.
async function refreshFromDisk(): Promise<void> {
  store.set({ sessions: await window.claudeUi.listSessions() });
}

/** Everything the list draws from the store. */
type ListView = View<
  | 'sessions'
  | 'statuses'
  | 'acked'
  | 'switchedModel'
  | 'pinned'
  | 'archived'
  | 'notes'
  | 'pendingDeletes'
  | 'groupState'
  | 'projectNames'
  | 'projectOrder'
  | 'activeProject'
  | 'tabs'
  | 'activeTab'
  | 'filter'
  | 'folds'
  | 'filterPanelOpen'
>;

/** The filter and the project the list was last drawn under, so a new one starts the list at its top. */
let followedFilter: View<'filter'>['filter'] = store.get().filter;
let followedProject: View<'activeProject'>['activeProject'] = store.get().activeProject;

/** The list follows the store. */
function listChanged(view: ListView): void {
  const reshaped = view.filter !== followedFilter || view.activeProject !== followedProject;
  followedFilter = view.filter;
  followedProject = view.activeProject;
  renderList(view);
  // A new filter or another project reshapes the list, so it starts at the top rather than at a stale scroll offset — whoever chose the project, the switcher or a new tab elsewhere dropping the list to All.
  if (reshaped) container.scrollTop = 0;
}

// --- View state that survives a restart ---
// Search, filters, folds, width and scroll are one answer to one question — put the sidebar back the way it was — so they are snapshotted, stored and restored together rather than as a setting each.

// Nothing is written until the start-up read has put the stored view back in the store (`startSavingUi`), or a save in between would write an empty sidebar straight over the real one.
let uiRestored = false;
let uiSaveTimer: number | undefined;
// The last snapshot actually sent. Renders happen for reasons that have nothing to do with the view — a transcript growing, a status dot changing — and without this each one would cost a full read-modify-write of meta.json.
let lastUiSignature = '';

/** What the start-up read puts back in the store, in its own change beside the listing: the view as it was left. */
type StoredView = Pick<AppState, 'filter' | 'folds' | 'filterPanelOpen' | 'footerExpanded'>;

function uiSnapshot(view: StoredView = store.get()): UiState {
  const { folds } = view;
  return {
    // The search as typed, not the trimmed and lowercased text it matches: what is restored has to be what was typed.
    ...view.filter,
    filterPanelOpen: view.filterPanelOpen,
    footerExpanded: view.footerExpanded,
    collapsedProjects: [...folds.projects],
    collapsedGroups: [...folds.groups],
    filterCollapsedProjects: [...folds.filterProjects],
    filterCollapsedGroups: [...folds.filterGroups],
    // Adopted into the layout tree's sizes on the first launch that has them, and not written again: the tree owns the sidebar's width now.
    sidebarWidth: null,
    scrollTop: container.scrollTop,
    panelState: treeState(),
  };
}

/**
 * Store the view, on a debounce: a watcher of the view's slices, and called by what the store does not hold — the list's scroll, and the layout tree's sizes, folds and picks.
 * Typing in the search box and dragging the scrollbar both change this state continuously, and every write is a read-modify-write of meta.json plus an audit line, so what is wanted is one write per pause rather than one per keystroke.
 */
function persistUi(): void {
  if (!uiRestored) return;
  if (uiSaveTimer !== undefined) clearTimeout(uiSaveTimer);
  uiSaveTimer = window.setTimeout(() => {
    uiSaveTimer = undefined;
    const state = uiSnapshot();
    const signature = JSON.stringify(state);
    if (signature === lastUiSignature) return;
    lastUiSignature = signature;
    window.claudeUi.setUiState(state);
  }, 400);
}

/**
 * Put the sidebar back the way it was left, and hand back what the start-up read sets in the store with the listing (`renderSessions`), and the scroll offset to apply once there is a list to scroll.
 *
 * Runs before the first render on purpose, and the view goes into the store in the same change as the listing: restoring filters afterwards would draw the full list and then visibly cut it down.
 * What is drawn straight from what was stored — the search box, the calendar, the chosen preset, the panel — is put back by the filter (`restoreFilter`), before the layout places the sidebar.
 * A deleted group's fold comes back too, and goes once the groups have been read (`forgetDeletedGroupFolds`).
 */
async function restoreUiState(): Promise<{ scrollTop: number; view: StoredView }> {
  const state = await window.claudeUi.getUiState();
  // The sidebar's width lived in localStorage, then in `sidebarWidth`; either is adopted once into the layout tree's sizes, so an existing install keeps its sidebar, and the tree owns it from here.
  restoreTreeState(state.panelState, state.sidebarWidth ?? Number(localStorage.getItem('sidebarWidth')));
  const filter = await restoreFilter(state);
  // The folds made under a filter apply only while it is on, so a filter stored off leaves them behind.
  const underFilter = isFiltering({ filter });
  const view: StoredView = {
    filter,
    folds: {
      projects: new Set(state.collapsedProjects),
      groups: new Set(state.collapsedGroups),
      filterProjects: new Set(underFilter ? state.filterCollapsedProjects : []),
      filterGroups: new Set(underFilter ? state.filterCollapsedGroups : []),
    },
    // Exactly as it was left, an active filter included. Closing the panel over a filter you have deliberately left on is a choice to keep the results and reclaim the space; a shut panel folds down to chips naming what is on, so the list never passes for the whole one.
    filterPanelOpen: state.filterPanelOpen,
    footerExpanded: state.footerExpanded,
  };
  // Seed the signature from what was just restored, so an opening render that changed nothing writes nothing.
  lastUiSignature = JSON.stringify(uiSnapshot(view));
  return { scrollTop: state.scrollTop, view };
}

/** From the start-up read on, the view in the store is the one you left, so it can be saved; anything asked for meanwhile — the layout dropping a stale split's sizes, say — is written now, if it changed anything. */
function startSavingUi(): void {
  uiRestored = true;
  persistUi();
}

/**
 * A project keeps its fold even while it has no sessions to show (same reasoning as the project order), but a DELETED group is gone for good.
 * The folds come back with the groups' first read, so the list's first draw is already the one you left; a fold of a group that is gone draws nothing meanwhile.
 */
function forgetDeletedGroupFolds({ groupState, folds }: View<'groupState' | 'folds'>): void {
  const live = new Set(groupState.groups.map((g) => g.id));
  const alive = (ids: ReadonlySet<string>): ReadonlySet<string> => new Set([...ids].filter((id) => live.has(id)));
  store.set({ folds: { ...folds, groups: alive(folds.groups), filterGroups: alive(folds.filterGroups) } });
}

// --- Session helpers ---

// Copy to the clipboard with a small confirmation toast; the OS gives no visible cue otherwise.
async function copyText(text: string, confirmation: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast(confirmation);
  } catch {
    showToast("Couldn't copy to the clipboard.");
  }
}

// Jump to a specific session from outside the list — the footer, a panel's row: scope to its project if needed, then open/focus its tab.
function jumpToSession(session: SessionSummary, launch: Pick<TabLaunch, 'prompt'> = {}): void {
  const { activeProject } = store.get();
  const sidebar = hostOf('claude');
  if (activeProject !== null && activeProject !== session.repoRoot) sidebar.selectProject(session.repoRoot);
  void openSession(session, launch);
  // Scope alone isn't enough to SEE it: the row can sit inside a collapsed group or project.
  // Reveal the same way clicking a tab does — jumping to a sibling filed in another group is exactly the case where scoping to the project still leaves the row hidden.
  sidebar.revealSession(session.id);
}

// A session's siblings (the other members of its family), most recent first. Shared by the count badge and the kebab submenu.
function siblingsOf(session: SessionSummary): SessionSummary[] {
  return store
    .get()
    .sessions.filter((s) => session.siblingIds.includes(s.id))
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

// Menu items for a sibling list; siblings often share a title, so each shows title + when.
function siblingMenuItems(siblings: SessionSummary[]): MenuItem[] {
  return siblings.map((sibling) => ({
    label: `${sessionLabel(sibling)} · ${relativeTime(sibling.lastActivity)}`,
    onSelect: () => hostOf('sessions').openSession(sibling.id),
  }));
}

// --- Group actions ------------------------------------------------------------------------------ Written through main, which hands back the whole state (state/groups.ts).

// Name a new group, create it in the project, and take the list to it.
// From a row it moves that session in at the same time, so the group is never briefly empty and the user never has to find it again to fill it; from the project heading it starts empty, to be filled from its own "+" or a row's "Move to group".
// A new group lands at the top of its project, which can be well away from the row or heading it was made from, so the jump — unfolding the project if it is folded — and its flash show where it went.
// A filter hides empty groups, so one made empty under a filter is not drawn, and the toast says where it went instead.
async function promptNewGroup(repoRoot: string, sessionId?: string): Promise<void> {
  const name = await promptText('New group', projName(repoRoot, store.get()), '', 'Create');
  if (!name?.trim()) return;
  const known = new Set(store.get().groupState.groups.map((g) => g.id));
  applyGroupState(await window.claudeUi.createGroup(name, repoRoot, sessionId));
  // The list has drawn the answer by now: the store tells as it is set.
  const group = store.get().groupState.groups.find((g) => !known.has(g.id));
  if (!group) return;
  if (renderedSections.groups.includes(group.id)) jumpToGroup(repoRoot, group.id);
  else if (isFiltering(store.get())) showToast(`Group "${group.name}" created. Empty groups are hidden while a filter is on, so it shows once you clear it.`);
}

// The four ordering moves for a group, minus any that would be a no-op here: the first group has no "up", the last no "down", and a lone group in a project has nowhere to go at all.
// So the menu never offers a move that does nothing.
function groupMoveItems(id: string): MenuItem[] {
  // Same reason as projects: filtering drops groups whose sessions all fell out, so a neighbour can be missing from the screen and the move would appear to do nothing.
  const state = store.get();
  if (isFiltering(state)) return [];
  const group = state.groupState.groups.find((g) => g.id === id);
  if (!group?.repoRoot) return [];
  const siblings = projectGroups(group.repoRoot, state);
  const at = siblings.findIndex((g) => g.id === id);
  const last = siblings.length - 1;
  if (at < 0 || last <= 0) return [];
  const item = (label: string, move: OrderMove): MenuItem => ({
    label,
    onSelect: () => void moveGroupById(id, move),
  });
  const items: MenuItem[] = [];
  if (at > 0) items.push(item('Move to top', 'top'), item('Move up', 'up'));
  if (at < last) items.push(item('Move down', 'down'), item('Move to bottom', 'bottom'));
  return items;
}

async function moveGroupById(id: string, move: OrderMove): Promise<void> {
  applyGroupState(await window.claudeUi.moveGroup(id, move));
}

async function renameGroupById(id: string): Promise<void> {
  const state = store.get();
  const group = state.groupState.groups.find((g) => g.id === id);
  if (!group) return;
  const name = await promptText('Rename group', projName(group.repoRoot ?? '', state), group.name);
  if (!name?.trim()) return;
  applyGroupState(await window.claudeUi.renameGroup(id, name));
}

// No confirmation: nothing is destroyed. The group goes and its members simply sit under the project again — unlike deleting a session, which trashes a transcript.
async function deleteGroupById(id: string): Promise<void> {
  const group = store.get().groupState.groups.find((g) => g.id === id);
  applyGroupState(await window.claudeUi.deleteGroup(id));
  if (group) showToast(`Group "${group.name}" deleted. Its sessions are back under the project.`);
}

// The "Move to group" list: the project's groups with the current one ticked, then the two ways out — back to the project, or into a group that doesn't exist yet.
function moveToGroupItems(session: SessionSummary): MenuItem[] {
  const state = store.get();
  const current = state.groupState.groupOf[entityKey(session)];
  const items: MenuItem[] = projectGroups(session.repoRoot, state).map((group) => ({
    label: group.name,
    checked: group.id === current,
    onSelect: () => void moveSessionToGroup(session, group.id),
  }));
  if (items.length > 0) items.push({ label: '', separator: true });
  items.push({ label: 'None', checked: !current, onSelect: () => void moveSessionToGroup(session, null) });
  items.push({ label: 'New group…', onSelect: () => void promptNewGroup(session.repoRoot, entityKey(session)) });
  return items;
}

// Archive/unarchive one session. Archiving puts it away, so any open tab for it closes too (unarchive leaves tabs alone). Shared by the kebab item and the archived view's row button.
async function toggleArchiveFor(key: string): Promise<void> {
  const archived = new Map(Object.entries(await window.claudeUi.toggleArchive(key)));
  // One change, told once the tabs are closed, so the list draws with them gone, as it did.
  store.batch(() => {
    store.set({ archived });
    if (archived.has(key)) {
      hostOf('sessions').closeTabs(key);
    }
  });
}

// The per-session action list — one builder, shared by the row kebab (and any future surface that offers session actions, e.g. a tab context menu).
function sessionMenuItems(session: SessionSummary): MenuItem[] {
  // Forking RUNS claude in the session's folder, so it needs that folder to be there — but the item stays in the list, dimmed and carrying the reason, rather than vanishing.
  // Everything below is bookkeeping about a session rather than a way to start one, so it stays available: cleaning up after a folder that has gone is exactly when you need it.
  const cannotRun = unstartableReason(session);
  const items: MenuItem[] = [
    cannotRun
      ? { label: 'Fork this session', disabled: cannotRun }
      : { label: 'Fork this session', onSelect: () => { void hostOf('sessions').forkSession(session.id); } },
  ];
  const siblings = siblingsOf(session);
  if (siblings.length > 0) {
    items.push({ label: `Siblings (${siblings.length})`, submenu: siblingMenuItems(siblings) });
  }
  items.push({ label: store.get().notes.has(entityKey(session)) ? 'Edit note…' : 'Add note…', onSelect: () => void editNote(session) });
  items.push({ label: 'Move to group', submenu: moveToGroupItems(session) });
  // The short id shows here rather than on the row: this is where you come looking for it, and the item both displays it and copies the full one.
  items.push({
    label: `Copy session id (${session.id.slice(0, 8)})`,
    onSelect: () => void copyText(session.id, 'Session id copied.'),
  });
  // The state changes sit below a rule, away from the navigate/copy items. Only the normal view offers them: the archived view keeps unarchive on the row and hides the kebab.
  items.push({ label: '', separator: true });
  // Stopping lives on the tab's own button, which is where the session you want to stop is: see closeOrStop.
  items.push({ label: 'Archive', onSelect: () => void toggleArchiveFor(entityKey(session)) });
  return items;
}

// Open the note editor for a session. Saving a blank note clears it (meta drops the entry), so the same dialog both writes and removes one — there is no separate delete.
async function editNote(session: SessionSummary): Promise<void> {
  const key = entityKey(session);
  const text = await promptText('Note', sessionLabel(session), store.get().notes.get(key) ?? '', 'Save', undefined, true);
  if (text === null) return; // cancelled: leave whatever was there
  store.set({ notes: new Map(Object.entries(await window.claudeUi.setNote(key, text))) });
}

// List a session's siblings in the shared popover; click one to jump to it.
function openSiblingsMenu(anchor: HTMLElement, session: SessionSummary): void {
  const siblings = siblingsOf(session);
  // The mark can briefly outlive its siblings (a delete between refreshes); nothing to list then.
  if (siblings.length === 0) return;
  openMenu(anchor, siblingMenuItems(siblings));
}

// Render from the cached session list, applying the current search filter.
// Keystrokes call this directly so filtering never re-reads disk.
// Reuses project/row nodes by key so a re-render moves elements into place instead of rebuilding the sidebar (no flicker, scroll stays put).
function renderList(view: ListView): void {
  const scroll = container.scrollTop;
  statusDots.clear();

  // Include new sessions not yet written to disk (from their open tabs) so they appear in the list immediately, in the right project; they reconcile to the real entry once created.
  const all = visibleSessions(view);
  currentByKey = new Map(all.map((s) => [entityKey(s), s]));
  const { activeProject } = view;

  const groupNames = searchText(view) ? groupNameByKey(view) : undefined;
  const filtered = all.filter((s) => passesFilters(s, view, groupNames));
  // Project scope applies everywhere, the archived view included.
  // It used to be exempt, from when archived was a rarely-visited global bin — but the scope is an explicit statement of what you are looking at, and one view quietly overriding it reads as a leak.
  // Switch to All to find an archived session whose project you have forgotten.
  const inScope = (list: SessionSummary[]): SessionSummary[] => (activeProject ? list.filter((s) => s.repoRoot === activeProject) : list);
  const scoped = inScope(filtered);
  // The total is the set the matches were taken from: the same project scope and the same view, archived or not, before the other filters. So the count only ever compares a set with part of itself, and in the normal view the total is the number the switcher shows.
  updateFilterStatus(scoped.length, inScope(viewPool(all, view.filter.filters.archived, view)).length, view);

  if (scoped.length === 0) {
    clearList();
    const message = document.createElement('div');
    message.className = 'empty-message';
    message.textContent = all.length === 0 ? 'No sessions found in ~/.claude/projects.' : 'No matches.';
    container.append(message);
    // Nothing on screen to fold away: this early return would otherwise leave the toggle live with the previous render's sections.
    renderedSections = { projects: [], groups: [] };
    updateCollapseToggle(view);
    return;
  }
  container.querySelector(':scope > .empty-message')?.remove();

  // One section per repo, each holding its groups and then the sessions in no group.
  // Every ordering rule (groups first, pins floated inside their own section) lives in the pure builder.
  // While filtering, groups whose sessions all fell out are dropped rather than left as empty headings.
  const tree = buildProjectTree(scoped, view.groupState, view.pinned, isFiltering(view), view.projectOrder);
  renderedSections = {
    projects: tree.map((p) => p.repoRoot),
    groups: tree.flatMap((p) => p.groups.map((g) => g.group.id)),
  };
  reconcileProjectSections(tree, view);
  pruneRows(new Set(scoped.map((s) => entityKey(s))));

  container.scrollTop = scroll;
  updateSidebarHighlight(view);
  updateCollapseToggle(view);
  syncStickyOffset();
}

// Chevrons stacked in the direction things will move: up to fold everything away, down to open it again. Ink centred on 8,8 like the row icons, so the glyph sits square in its button.
const COLLAPSE_ALL_ICON = strokeIcon(14, '<path d="M4 7.25L8 3.75L12 7.25" /><path d="M4 12.25L8 8.75L12 12.25" />');
const EXPAND_ALL_ICON = strokeIcon(14, '<path d="M4 3.75L8 7.25L12 3.75" /><path d="M4 8.75L8 12.25L12 8.75" />');

// What the button folds depends on the view.
// In All it folds the project sections (keyed on projects alone: with every project shut its groups are out of sight anyway, which is why a group toggling on its own needs no refresh call).
// In a single-project view folding the one project you asked to look at is pointless, so it folds THAT project's groups instead.
function collapseScope(view: View<'activeProject' | 'filter' | 'folds'>): { kind: 'projects' | 'groups'; ids: string[]; collapsed: ReadonlySet<string> } {
  return view.activeProject === null
    ? { kind: 'projects', ids: renderedSections.projects, collapsed: foldedProjects(view) }
    : { kind: 'groups', ids: renderedSections.groups, collapsed: foldedGroups(view) };
}

// Everything in scope folded away already? Then the button offers the way back instead.
function allSectionsCollapsed(view: View<'activeProject' | 'filter' | 'folds'>): boolean {
  const { ids, collapsed } = collapseScope(view);
  return ids.length > 0 && ids.every((id) => collapsed.has(id));
}

function updateCollapseToggle(view: View<'activeProject' | 'filter' | 'folds'>): void {
  // Filtering forces every section open (so matches inside a collapsed one are visible), which leaves this nothing to act on.
  collapseToggle.disabled = isFiltering(view) || collapseScope(view).ids.length === 0;
  const label = allSectionsCollapsed(view) ? 'Expand all' : 'Collapse all';
  collapseToggle.innerHTML = allSectionsCollapsed(view) ? EXPAND_ALL_ICON : COLLAPSE_ALL_ICON;
  setTooltip(collapseToggle, label);
  collapseToggle.setAttribute('aria-label', label);
}

// Collapsing takes the groups with it, so expanding a project afterwards shows its group headings rather than dumping every row back at once — two levels of overview instead of one.
collapseToggle.addEventListener('click', () => {
  const state = store.get();
  const { kind, ids } = collapseScope(state);
  const expanding = allSectionsCollapsed(state);
  let folds = foldsWith(state, kind, ids, !expanding);
  // In the All view a project's groups fold along with it, so expanding one afterwards shows its group headings rather than dumping every row back. In a project view the groups ARE the scope already.
  if (state.activeProject === null) {
    const next = { ...state, folds };
    folds = expanding ? foldsWith(next, 'groups', foldedGroups(next), false) : foldsWith(next, 'groups', renderedSections.groups, true);
  }
  store.set({ folds });
  renderList(store.get());
});


// Reset to a blank list: drop every cached node so the next non-empty render rebuilds fresh.
function clearList(): void {
  container.replaceChildren();
  sessionRows.clear();
  projectSections.clear();
  groupSections.clear();
  statusDots.clear();
}

// Bring the project sections in line with `desired`: drop gone ones, create missing ones, and order both the sections and their rows via appendChild (which moves an existing node into place).
// Inside a project the group sections come first, then the rows belonging to no group.
function reconcileProjectSections(desired: ProjectTree[], view: RowView & View<'projectNames' | 'activeProject' | 'folds'>): void {
  const { activeProject } = view;
  const wanted = new Set(desired.map((p) => p.repoRoot));
  for (const [repoRoot, els] of projectSections) {
    if (!wanted.has(repoRoot)) {
      els.section.remove();
      projectSections.delete(repoRoot);
    }
  }
  const wantedGroups = new Set(desired.flatMap((p) => p.groups.map((g) => g.group.id)));
  for (const [id, els] of groupSections) {
    if (!wantedGroups.has(id)) {
      els.section.remove();
      groupSections.delete(id);
    }
  }
  for (const project of desired) {
    let els = projectSections.get(project.repoRoot);
    if (!els) {
      els = createProjectSection(project.repoRoot, project.repoRoot);
      projectSections.set(project.repoRoot, els);
    }
    // While filtering, force projects open so matches inside a collapsed one are visible; the stored collapse state is left untouched, so it returns when the filter clears.
    const collapsed = activeProject === null && foldedProjects(view).has(project.repoRoot);
    els.section.classList.toggle('collapsed', collapsed);
    // A project view can't collapse its one project, so it shows no caret and no clickable styling.
    els.section.classList.toggle('no-collapse', activeProject !== null);
    els.caret.hidden = activeProject !== null;
    els.caret.innerHTML = caretIcon(collapsed, 10);
    els.count.textContent = String(project.count);
    els.label.textContent = projName(project.repoRoot, view); // keep the heading current (e.g. after a rename)
    // Below 2 targets there is nowhere to jump, and the heading is already carrying six controls at a 320px sidebar — so the button is absent rather than dimmed.
    // Filtering forces every section open and reshuffles what is on screen, which leaves the jump nothing to act on: disabled there, like collapse-all, since a control vanishing as you type reads worse than one plainly unavailable.
    const targets = groupJumpTargets(project, view.statuses, view.acked);
    jumpTargets.set(project.repoRoot, targets);
    els.groupsBtn.hidden = targets.length < 2;
    els.groupsBtn.disabled = isFiltering(view);
    if (els.addCaret) els.addCaret.hidden = !project.isRepo; // worktree option only for git repos
    // Nothing can be started in a folder that is not there. Disabled rather than hidden: the project still has sessions to read, and a control that vanishes explains nothing — the tooltip does.
    const rootGone = !project.rootExists;
    const goneReason = rootGone ? projectGoneReason(project.repoRoot) : null;
    if (els.addBtn) setUnavailable(els.addBtn, goneReason, 'New session in this project');
    if (els.addCaret) setUnavailable(els.addCaret, goneReason, 'New session options');
    markProjectGone(project.repoRoot, rootGone, els.label, els.icon, 14, els.label, folderIcon(14));
    for (const { group, sessions } of project.groups) {
      const groupEls = groupSections.get(group.id) ?? createGroupSection(group.id);
      groupSections.set(group.id, groupEls);
      const groupCollapsed = foldedGroups(view).has(group.id);
      groupEls.section.classList.toggle('collapsed', groupCollapsed);
      groupEls.caret.innerHTML = caretIcon(groupCollapsed, 10);
      groupEls.label.textContent = group.name;
      groupEls.count.textContent = String(sessions.length);
      groupEls.addCaret.hidden = !project.isRepo; // worktree option only for git repos
      // A group starts its sessions in the project's folder, so it is gated by the same fact.
      setUnavailable(groupEls.addBtn, goneReason, 'New session in this group');
      setUnavailable(groupEls.addCaret, goneReason, 'New session options');
      groupEls.empty.hidden = sessions.length > 0;
      // Both ways to fill it, or only the move where the project's folder is gone and nothing can be started.
      // A control is named the way its tooltip names it ("Session options") rather than drawn as a glyph in text, which rendered in whatever the UI font offered; "+" is plain ASCII, so it is named as itself.
      groupEls.empty.textContent = rootGone
        ? "Empty — move a session here from any session's options."
        : "Empty — start a session with the + above, or move one here from any session's options.";
      for (const session of sessions) {
        const row = getOrCreateRow(entityKey(session));
        updateRow(row, session, view);
        row.classList.remove('after-groups'); // rows are reused: it may have been a loose row before
        groupEls.members.appendChild(row);
      }
      els.section.appendChild(groupEls.section);
    }
    // Ungrouped sessions sit directly under the project heading, at full width — there is no "Ungrouped" heading, so the indent alone says whether a row is in a group.
    let first = true;
    for (const session of project.loose) {
      const row = getOrCreateRow(entityKey(session));
      updateRow(row, session, view);
      // Extra breathing room between the last group and the loose rows, but not when there are no groups at all (then this is just the project's first row).
      row.classList.toggle('after-groups', first && project.groups.length > 0);
      first = false;
      els.section.appendChild(row);
    }
    container.appendChild(els.section);
  }
}

// Remove rows whose entity is no longer shown (deleted, or filtered out by search).
function pruneRows(wanted: Set<string>): void {
  for (const [key, row] of sessionRows) {
    if (!wanted.has(key)) {
      row.remove();
      sessionRows.delete(key);
    }
  }
}

settingsToggle.addEventListener('click', () => void openSettings());

// The ordering moves for a project, minus any that would do nothing — same rule as a group's.
// The order spans every project ever seen, so the ends are the ends of THAT list, not of what's on screen (a filter or an all-archived project can hide neighbours without changing where this one sits).
function projectMoveItems(repoRoot: string): MenuItem[] {
  const state = store.get();
  const { activeProject, projectOrder } = state;
  // All view only: a project view renders a single heading, so there is nothing to order against.
  if (activeProject !== null) return [];
  // Not while filtering either: a hidden neighbour makes the move land where you can't see it, so "Move up" past a filtered-out project looks like a button that did nothing.
  if (isFiltering(state)) return [];
  const at = projectOrder.indexOf(repoRoot);
  const last = projectOrder.length - 1;
  if (at < 0 || last <= 0) return [];
  const item = (label: string, move: OrderMove): MenuItem => ({
    label,
    onSelect: () => void moveProjectBy(repoRoot, move),
  });
  const items: MenuItem[] = [];
  if (at > 0) items.push(item('Move to top', 'top'), item('Move up', 'up'));
  if (at < last) items.push(item('Move down', 'down'), item('Move to bottom', 'bottom'));
  return items;
}

// The list, the strip and the tab bar place projects by the order, so all three follow the store together rather than the bar at the next unrelated redraw.
async function moveProjectBy(repoRoot: string, move: OrderMove): Promise<void> {
  store.set({ projectOrder: await window.claudeUi.moveProject(repoRoot, move) });
}

async function renameProject(repoRoot: string): Promise<void> {
  const name = await promptText('Rename project', repoRoot, projName(repoRoot, store.get()));
  if (name === null) return;
  // Typing the folder name back clears the override rather than storing a redundant one.
  const canonical = name.trim() === folderName(repoRoot) ? '' : name;
  store.set({ projectNames: new Map(Object.entries(await window.claudeUi.setProjectName(repoRoot, canonical))) });
}

// Reveal a session's row in the sidebar (expanding its project if collapsed), so clicking a tab scrolls to where it lives and shows which project it belongs to.
function revealSessionInSidebar(session: SessionSummary): void {
  // Its group can be collapsed too, and then the row is hidden even with the project open.
  const groupId = store.get().groupState.groupOf[entityKey(session)];
  if (groupId && unfold('groups', groupId)) renderList(store.get());
  if (unfold('projects', session.repoRoot)) renderList(store.get());
  const row = sessionRows.get(entityKey(session));
  if (!row) return;
  // Scroll only the sidebar list (scrollIntoView would also scroll the page and shift the whole app).
  // Land the row clear of EVERYTHING pinned above it: the project heading always, plus its group's heading when the row sits in a group — that one is sticky too, and a fixed offset for the project heading alone left the row half-hidden behind it.
  const groupHeading = groupId ? groupSections.get(groupId)?.heading : undefined;
  const pinned = stickyOffset + (groupHeading?.getBoundingClientRect().height ?? 0);
  container.scrollTop +=
    row.getBoundingClientRect().top - container.getBoundingClientRect().top - pinned - REVEAL_GAP;
}

/** A little air between a revealed row and the headings pinned above it, so it doesn't sit flush. */
const REVEAL_GAP = 6;

// Scroll the (All-view) session list to a project's heading — used by the project name in the tab bar, so it links to where that project's sessions live.
function revealProjectInSidebar(repoRoot: string): void {
  if (unfold('projects', repoRoot)) renderList(store.get());
  const els = projectSections.get(repoRoot);
  if (!els) return;
  container.scrollTop += els.section.getBoundingClientRect().top - container.getBoundingClientRect().top;
  // Flashed as a group's heading is after a jump, so the tab bar's project and group labels do the same thing at their own level.
  flash(els.heading);
}

// The group headings pin below the project heading, so their sticky offset is its height.
// Measured rather than assumed: it moves with the type scale, and both this and the jump offset read the same element so they cannot drift apart.
// Skipped when unchanged, so a render doesn't thrash layout.
let stickyOffset = 0;
function syncStickyOffset(): void {
  const first = projectSections.values().next().value;
  if (!first) return;
  const height = Math.round(first.heading.getBoundingClientRect().height);
  if (!height || height === stickyOffset) return;
  stickyOffset = height;
  document.documentElement.style.setProperty('--project-heading-height', `${height}px`);
}

// Jump to one of a project's groups (or to where its ungrouped sessions start).
// Expands the target if it is folded — otherwise the jump lands on a heading with nothing under it — and lands it just below the project heading, whose height is MEASURED rather than assumed: it changes with the type scale, and a stale constant would tuck the target under the sticky heading.
function jumpToGroup(repoRoot: string, groupId: string | null): void {
  const els = projectSections.get(repoRoot);
  if (!els) return;
  if (unfold('projects', repoRoot)) renderList(store.get());
  if (groupId !== null && unfold('groups', groupId)) renderList(store.get());

  // A group jumps to its heading; the ungrouped remainder has none, so it jumps to its first row — which is the one carrying .after-groups, the class that marks where the loose rows begin.
  const target: HTMLElement | null | undefined =
    groupId !== null
      ? groupSections.get(groupId)?.heading
      : els.section.querySelector<HTMLElement>(':scope > .session.after-groups') ??
        els.section.querySelector<HTMLElement>(':scope > .session');
  if (!target) return;

  const offset = els.heading.getBoundingClientRect().height;
  container.scrollTop += target.getBoundingClientRect().top - container.getBoundingClientRect().top - offset;
  flash(target);
}

/**
 * The parts every collapsible section heading has: a caret, an icon, an ellipsizing label and a count
 * pill. The project's and the group's differ in tag, icon, and what is appended after these.
 */
function buildHeading(
  tag: 'h2' | 'h3',
  iconHtml: string,
): { heading: HTMLElement; caret: HTMLElement; icon: HTMLElement; label: HTMLElement; count: HTMLElement } {
  const heading = document.createElement(tag);
  heading.className = 'section-heading';
  const caret = document.createElement('span');
  caret.className = 'caret';
  const icon = document.createElement('span');
  icon.className = 'heading-icon';
  icon.innerHTML = iconHtml;
  const label = document.createElement('span');
  label.className = 'label';
  const count = document.createElement('span');
  count.className = 'heading-count';
  return { heading, caret, icon, label, count };
}

/**
 * Fold or unfold a section: remember it, hide the rows, turn the caret; saving follows the folds.
 * Both toggles deliberately skip renderList — no flicker, no scroll jump.
 */
function toggleFold(section: HTMLElement, caret: HTMLElement, kind: 'projects' | 'groups', key: string): void {
  const state = store.get();
  const collapsed = !(kind === 'projects' ? foldedProjects(state) : foldedGroups(state)).has(key);
  // The list reads the folds without being told of them, so this draws nothing but the section.
  store.set({ folds: foldsWith(state, kind, [key], collapsed) });
  section.classList.toggle('collapsed', collapsed);
  caret.innerHTML = caretIcon(collapsed, 10);
}

// Build a project section once; its contents (name, count, caret, rows) are drawn by reconcileProjectSections, on this render and every later one.
function createProjectSection(name: string, folderCwd?: string): ProjectSectionEls {
  const section = document.createElement('section');
  section.className = 'project';

  const { heading, caret, icon, label, count } = buildHeading('h2', folderIcon(14));
  setTooltip(label, name); // full path on hover
  // Jump straight to one of this project's groups instead of scrolling for it.
  // The heading is position:sticky, so this trigger is on screen the whole time you scroll the project — which is what makes a menu enough here, rather than a panel that would cost a line of height per project.
  // reconcileProjectSections hides it below 2 targets and disables it while filtering.
  const groupsBtn = document.createElement('button');
  groupsBtn.className = 'icon-btn project-groups';
  groupsBtn.innerHTML = layersIcon(14);
  groupsBtn.hidden = true;
  setTooltip(groupsBtn, 'Jump to a group');
  groupsBtn.addEventListener('click', (event) => {
    event.stopPropagation(); // don't collapse the project
    const targets = jumpTargets.get(name) ?? [];
    const items: MenuItem[] = [];
    for (const t of targets) {
      // A rule before the ungrouped entry: it is a different KIND of target, not another group.
      if (t.groupId === null && items.length > 0) items.push({ label: '', separator: true });
      items.push({
        label: t.name,
        count: t.count,
        badge: t.badge,
        muted: t.groupId === null,
        onSelect: () => jumpToGroup(name, t.groupId),
      });
    }
    openMenu(groupsBtn, items);
  });
  heading.append(caret, icon, label, count, groupsBtn);
  let addCaret: HTMLElement | undefined;
  let addBtn: HTMLButtonElement | undefined;
  if (folderCwd) {
    // Split button: the "+" is one-click "New session"; the caret opens a dropdown with worktree options. reconcileProjectSections shows the caret only for git repos.
    const split = document.createElement('div');
    split.className = 'split-button';
    const add = document.createElement('button');
    add.className = 'icon-btn composite project-add';
    add.innerHTML = plusIcon(12);
    setTooltip(add, 'New session in this project');
    add.addEventListener('click', (event) => {
      event.stopPropagation();
      if (unavailable(add)) return; // aria-disabled still delivers the click, which is the trade for a tooltip that works
      void hostOf('sessions').openNewSession(folderCwd);
    });
    const caret = document.createElement('button');
    caret.className = 'icon-btn composite project-add-caret';
    caret.innerHTML = chevronDown(9);
    caret.hidden = true;
    setTooltip(caret, 'New session options');
    caret.addEventListener('click', (event) => {
      event.stopPropagation();
      if (unavailable(caret)) return;
      openMenu(caret, [
        { label: 'New session', onSelect: () => void hostOf('sessions').openNewSession(folderCwd) },
        { label: 'New worktree session…', onSelect: () => void hostOf('sessions').openWorktreeSession(folderCwd) },
      ]);
    });
    split.append(add, caret);
    heading.append(split);
    addCaret = caret;
    addBtn = add;
  }
  // Project options (rename now, hide later); stopPropagation so it doesn't toggle collapse.
  const kebab = document.createElement('button');
  kebab.className = 'icon-btn project-kebab';
  kebab.innerHTML = kebabIcon(14);
  setTooltip(kebab, 'Project options');
  kebab.addEventListener('click', (event) => {
    event.stopPropagation();
    const moves = projectMoveItems(name);
    openMenu(kebab, [
      ...moves,
      ...(moves.length > 0 ? [{ label: '', separator: true }] : []),
      { label: 'Rename…', onSelect: () => void renameProject(name) },
      { label: 'Copy path', onSelect: () => void copyText(name, 'Path copied.') },
      { label: '', separator: true },
      { label: 'New group…', onSelect: () => void promptNewGroup(name) },
    ]);
  });
  heading.append(kebab);
  // Toggle in place (CSS hides the rows) so the sidebar doesn't rebuild and flicker.
  // Keep the clicked heading anchored: a sticky heading otherwise snaps between stuck and natural position as its rows appear/disappear, which reads as a jump.
  heading.addEventListener('click', () => {
    // Not collapsible in a single-project view: hiding the one project you're looking at leaves an empty sidebar. The heading is a title there, and updateProjectSection drops its caret to say so.
    const state = store.get();
    if (state.activeProject !== null) return;
    const before = heading.getBoundingClientRect().top;
    toggleFold(section, caret, 'projects', name);
    container.scrollTop += heading.getBoundingClientRect().top - before;
    // No render here, so the header button has to be refreshed by hand — otherwise it still reads "Expand all" after one project reopens.
    updateCollapseToggle(state);
  });
  section.appendChild(heading);

  return { section, heading, caret, count, icon, label, groupsBtn, addCaret, addBtn };
}

// Build a group's sub-section once: a heading (lighter than the project's — no divider, not sticky) over an indented well that holds its rows. Contents are updated on later renders.
function createGroupSection(id: string): GroupSectionEls {
  const section = document.createElement('section');
  section.className = 'group';

  const { heading, caret, icon, label, count } = buildHeading('h3', layersIcon(13));
  // Start a session already in this group — the group's answer to the project heading's split button, and the same two parts: "+" starts one straight away, the caret offers the worktree variant.
  // reconcileProjectSections shows the caret only when the project is a git repo.
  const split = document.createElement('div');
  split.className = 'split-button';
  const add = document.createElement('button');
  add.className = 'icon-btn composite group-add';
  add.innerHTML = plusIcon(14);
  setTooltip(add, 'New session in this group');
  add.addEventListener('click', (event) => {
    event.stopPropagation();
    if (unavailable(add)) return;
    const group = store.get().groupState.groups.find((g) => g.id === id);
    if (group?.repoRoot) void hostOf('sessions').openNewSession(group.repoRoot, id);
  });
  const addCaret = document.createElement('button');
  addCaret.className = 'icon-btn composite group-add-caret';
  addCaret.innerHTML = chevronDown(9);
  addCaret.hidden = true;
  setTooltip(addCaret, 'New session options');
  addCaret.addEventListener('click', (event) => {
    event.stopPropagation();
    if (unavailable(addCaret)) return;
    const repoRoot = store.get().groupState.groups.find((g) => g.id === id)?.repoRoot;
    if (!repoRoot) return;
    openMenu(addCaret, [
      { label: 'New session', onSelect: () => void hostOf('sessions').openNewSession(repoRoot, id) },
      { label: 'New worktree session…', onSelect: () => void hostOf('sessions').openWorktreeSession(repoRoot, id) },
    ]);
  });
  split.append(add, addCaret);
  // Group options, same shape as the project heading's kebab; stopPropagation so it doesn't collapse.
  const kebab = document.createElement('button');
  kebab.className = 'icon-btn group-kebab';
  kebab.innerHTML = kebabIcon(14);
  setTooltip(kebab, 'Group options');
  kebab.addEventListener('click', (event) => {
    event.stopPropagation();
    const moves = groupMoveItems(id);
    openMenu(kebab, [
      ...moves,
      ...(moves.length > 0 ? [{ label: '', separator: true }] : []),
      { label: 'Rename…', onSelect: () => void renameGroupById(id) },
      { label: 'Delete group', onSelect: () => void deleteGroupById(id) },
    ]);
  });
  heading.append(caret, icon, label, count, split, kebab);
  heading.addEventListener('click', () => {
    toggleFold(section, caret, 'groups', id);
  });

  // The rows live in their own element so the indent and its rail wrap the whole group, which is what shows where a group ends without needing to read the next heading.
  const members = document.createElement('div');
  members.className = 'group-members';
  const empty = document.createElement('div');
  empty.className = 'group-empty'; // its text depends on the project's folder, so reconcileProjectSections writes it
  members.append(empty);

  section.append(heading, members);
  return { section, heading, caret, label, count, addCaret, addBtn: add, members, empty };
}

function getOrCreateRow(key: string): HTMLElement {
  const existing = sessionRows.get(key);
  if (existing) return existing;
  const row = createSessionRow(key);
  sessionRows.set(key, row);
  return row;
}

// Take it back out of the box. Archiving has no row icon — it is a kebab item (text) in the normal view; only unarchiving, the archived view's primary action, stays a button on the row.
// Redrawn from its 24-unit original at two-thirds scale, onto the 16-unit grid the helper draws on.
const UNARCHIVE_ICON = strokeIcon(14, '<path d="M.67 2.67v4h4" /><path d="M2.34 10a6 6 0 1 0 1.42-6.24L.67 6.67" />');

interface RowEls {
  dot: HTMLElement;
  title: HTMLElement;
  badge: HTMLElement;
  siblingsBadge: HTMLElement;
  noteBadge: HTMLElement;
  noteSep: HTMLElement;
  meta: HTMLElement;
  metaText: HTMLElement;
  pin: HTMLButtonElement;
  unarchiveBtn: HTMLButtonElement;
  deleteBtn: HTMLButtonElement;
  kebab: HTMLButtonElement;
}
// Each row's child elements, cached so updateRow reads them directly instead of re-querying the DOM every render (same idea as the session summary cache, applied to rendering).
const rowEls = new WeakMap<HTMLElement, RowEls>();

// Build a row once. Its click/pin handlers read the live session from `currentByKey` by the entity key (the session id), so a reused row stays correct across re-renders.
function createSessionRow(key: string): HTMLElement {
  const item = document.createElement('article');
  item.className = 'session';
  item.dataset.key = key;

  const dot = document.createElement('span');
  // Click the dot to toggle "read": mute a done/waiting session without opening or replying to it.
  ackOnClick(dot, () => currentByKey.get(key)?.id ?? null);
  const content = document.createElement('div');
  content.className = 'session-content';
  const title = document.createElement('p');
  title.className = 'session-title';
  const badge = document.createElement('span');
  badge.className = 'worktree-badge';
  badge.hidden = true;
  // A family member's mark: the fork icon plus a count of its siblings, which opens a list of them to jump into. Shown only when session.isSibling (set in updateRow).
  const siblingsBadge = document.createElement('span');
  siblingsBadge.className = 'sibling-badge';
  siblingsBadge.hidden = true;
  siblingsBadge.addEventListener('click', (event) => {
    event.stopPropagation();
    const session = currentByKey.get(key);
    if (session) openSiblingsMenu(siblingsBadge, session);
  });
  // Time and model, plus the note mark riding along at the end of that text.
  // The mark lives HERE rather than beside the title because a sibling box next to a text block has to have its alignment guessed; inside the text row it just centres.
  // The meta is short and single-line, so nothing can clip the mark off the way a two-line title clamp would.
  const meta = document.createElement('p');
  meta.className = 'session-meta';
  const metaText = document.createElement('span');
  metaText.className = 'meta-text';
  // The badges used to take a line of their own between title and meta.
  // They ride the meta's line now: the meta takes the remaining width (and still stacks by itself if it must), the marks keep their intrinsic size at the right.
  // A note's mark, clickable straight into the editor — if you can see there's a note, the natural move is to read it, and the tooltip only previews the first line.
  const noteBadge = document.createElement('span');
  noteBadge.className = 'note-badge';
  noteBadge.hidden = true;
  noteBadge.innerHTML = NOTE_ICON;
  noteBadge.addEventListener('click', (event) => {
    event.stopPropagation();
    const session = currentByKey.get(key);
    if (session) void editNote(session);
  });

  // A separator before the mark, matching the " · " already between time and model. Hidden with the mark, so a row without a note doesn't end in a dangling dot.
  const noteSep = document.createElement('span');
  noteSep.className = 'meta-sep';
  noteSep.textContent = '·';
  noteSep.hidden = true;
  meta.append(metaText, noteSep, noteBadge);

  const subline = document.createElement('div');
  subline.className = 'session-subline';
  subline.append(meta, badge, siblingsBadge);
  content.append(title, subline);

  const pin = document.createElement('button');
  pin.className = 'icon-btn pin';
  pin.addEventListener('click', (event) => {
    event.stopPropagation();
    if (pin.disabled) return;
    // Disabling it is the pending cue: .pin:disabled dims. (There was a 'loading' class here with no CSS behind it, so it painted nothing.)
    pin.disabled = true;
    void window.claudeUi.togglePin(key).then((ids) => {
      store.set({ pinned: new Set(ids) });
      // The row's redraw re-enables it; this is for an answer that changed nothing, which tells nobody.
      pin.disabled = false;
    });
  });

  // Unarchive lives on the row because it is what the archived view is for; archiving a live session is a kebab item instead (shown/hidden in updateRow), so a normal row carries only pin + kebab.
  const unarchiveBtn = document.createElement('button');
  unarchiveBtn.className = 'icon-btn unarchive-btn';
  unarchiveBtn.hidden = true;
  unarchiveBtn.innerHTML = UNARCHIVE_ICON;
  setTooltip(unarchiveBtn, 'Unarchive');
  unarchiveBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    void toggleArchiveFor(key);
  });

  // Delete lives only in the archived view (shown/hidden in updateRow); trash-based + confirmed.
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'icon-btn delete-btn';
  setTooltip(deleteBtn, 'Delete session');
  deleteBtn.hidden = true;
  deleteBtn.innerHTML = strokeIcon(14, '<path d="M3 4.5h10" /><path d="M6.5 4.5V3h3v1.5" /><path d="M4.8 4.5l.5 8h5.4l.5-8" />');
  const confirmAndDelete = async (): Promise<void> => {
    const session = currentByKey.get(key);
    const title = session ? sessionLabel(session) : key.slice(0, 8);
    if (!(await confirmDelete(title))) return;
    // Hide it right away so deletion feels instant; trashing files (slow under WSL) and the meta purge run in the background.
    // It stays hidden via pendingDeletes until its files are gone from disk (see renderSessions), so a concurrent delete's re-read can't resurrect it.
    // Only this entity's file goes (entity key = session id); siblings are separate entities.
    store.set({ pendingDeletes: withMember(store.get().pendingDeletes, key, true) });
    try {
      // Guard against a delete that never settles (e.g. a hung OS-trash call): after 30s treat it as failed so the row can't stay hidden forever within a session.
      await Promise.race([
        window.claudeUi.deleteSession(key),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('delete timed out')), 30_000)),
      ]);
    } catch {
      showToast(`Couldn't delete "${title}". It's still here.`);
    } finally {
      // Stop hiding once this delete resolves: on success the re-read finds it gone; on failure the file is still on disk, so the row reappears.
      await renderSessions({ showLoading: false, revealed: key });
    }
  };
  deleteBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    void confirmAndDelete();
  });

  // Per-session actions menu: fork this session, and (for a family member) list its siblings.
  const kebab = document.createElement('button');
  kebab.className = 'icon-btn session-kebab';
  kebab.innerHTML = kebabIcon(14);
  setTooltip(kebab, 'Session options');
  kebab.addEventListener('click', (event) => {
    event.stopPropagation();
    const session = currentByKey.get(key);
    if (session) openMenu(kebab, sessionMenuItems(session));
  });

  item.append(dot, content, pin, unarchiveBtn, deleteBtn, kebab);
  rowEls.set(item, { dot, title, badge, siblingsBadge, noteBadge, noteSep, meta, metaText, pin, unarchiveBtn, deleteBtn, kebab });
  item.addEventListener('click', () => {
    // Archived sessions are inert: manage them (unarchive/delete), don't resume them.
    if (store.get().filter.filters.archived) return;
    const session = currentByKey.get(key);
    if (!session) return;
    // A session whose folder is gone cannot run anywhere. The row says so in its tooltip, and this answers the click for anyone who tries it anyway rather than opening a tab that could only fail.
    const reason = unstartableReason(session);
    if (reason) {
      showToast(reason);
      return;
    }
    hostOf('sessions').openTab(session.id);
  });
  return item;
}

// Refresh a reused row's content for the tip it now shows.
/** What a row draws from the store besides the session it shows. */
type RowView = View<'statuses' | 'acked' | 'switchedModel' | 'pinned' | 'archived' | 'notes' | 'filter'>;

function updateRow(row: HTMLElement, session: SessionSummary, view: RowView): void {
  row.dataset.sid = session.id;
  const els = rowEls.get(row)!;
  const archivedView = view.filter.filters.archived;

  applyStatus(els.dot, view.statuses.get(session.id), view.acked.has(session.id));
  statusDots.set(session.id, els.dot);

  els.title.textContent = sessionLabel(session, '(no prompt yet)');
  // A session that cannot run says why on the row itself, rather than only when you try it: the tooltip is the one place with room for the folder's path.
  const unstartable = unstartableReason(session);
  row.classList.toggle('unstartable', unstartable !== null);
  setTooltip(els.title, unstartable ?? (sessionLabel(session, '') || null));

  els.badge.hidden = !session.worktree;
  if (session.worktree) {
    // Icon only — the word "worktree" cost a badge-width of room and the branch icon plus its tooltip already say it. Being wordless, the pill carries its own aria-label.
    const wtIcon = document.createElement('span');
    wtIcon.className = 'badge-icon';
    wtIcon.innerHTML = WORKTREE_ICON;
    els.badge.replaceChildren(wtIcon);
    setTooltip(els.badge, `Linked git worktree: ${session.worktree}`);
    els.badge.setAttribute('aria-label', `Linked git worktree: ${session.worktree}`);
  }

  const note = view.notes.get(entityKey(session));
  els.noteBadge.hidden = !note;
  els.noteSep.hidden = !note;
  // Tooltips are one line, so preview the start rather than dumping a long note into it. The tooltip wraps and keeps line breaks now, so it can show a real chunk of the note.
  if (note) setTooltip(els.noteBadge, note.length > 400 ? `${note.slice(0, 400)}…` : note);

  els.siblingsBadge.hidden = !session.isSibling;
  if (session.isSibling) {
    const count = session.siblingIds.length;
    const sibIcon = document.createElement('span');
    sibIcon.className = 'badge-icon';
    sibIcon.innerHTML = SIBLING_ICON;
    const sibCount = document.createElement('span');
    sibCount.className = 'badge-text';
    sibCount.textContent = String(count);
    els.siblingsBadge.replaceChildren(sibIcon, sibCount);
    const label = count === 1 ? '1 sibling' : `${count} siblings`;
    setTooltip(els.siblingsBadge, `${label} in this session's family — click to list them`);
  }

  if (archivedView) {
    const ts = view.archived.get(entityKey(session));
    els.metaText.textContent = ts ? `archived ${relativeTime(new Date(ts).toISOString())}` : 'archived';
  } else {
    const model = modelLabel(modelOf(session, view));
    const when = relativeTime(session.lastActivity);
    els.metaText.textContent = model ? `${when} · ${model}` : when;
  }

  // The archived view is a management view: no pinning, and delete replaces it there.
  const isPinned = view.pinned.has(entityKey(session));
  els.pin.innerHTML = isPinned ? PINNED_ICON : PIN_ICON;
  setTooltip(els.pin, isPinned ? 'Unpin' : 'Pin');
  els.pin.disabled = false;
  els.pin.hidden = archivedView;

  // Unarchive and delete are the archived view's two actions and appear nowhere else.
  els.unarchiveBtn.hidden = !archivedView;
  els.deleteBtn.hidden = !archivedView;
  // The kebab (fork, groups, archive) is a normal-view affordance; the archived view is manage-only.
  els.kebab.hidden = archivedView;
}

// --- Tabs ---

/**
 * Open a session's tab, starting it when it is not running.
 * A first prompt is for a session that is NOT running, which starts with it — a resumed one included; one that is running is only brought into view, since typing into a live session is never the app's to do.
 */
async function openSession(session: SessionSummary, launch: Pick<TabLaunch, 'prompt'> = {}): Promise<void> {
  const existing = tabWith(session.id);
  if (existing) {
    if (existing.terminalId === null && launch.prompt) {
      activateTab(existing.token, false);
      await startTab(existing.token, launch);
      return;
    }
    activateTab(existing.token);
    return;
  }
  await createTab(session, launch);
}

// Land where a new tab will be visible: stay in its own project, else drop the scope to All.
// Only the scope: the new tab, which its caller creates next, is the one that comes on show.
function ensureProjectVisible(repoRoot: string): void {
  const { activeProject } = store.get();
  if (activeProject !== null && repoRoot !== activeProject) {
    store.set({ activeProject: null });
    window.claudeUi.setActiveProject(null);
  }
}

// Start a brand-new claude session in `cwd`, under an id this app mints; the sidebar row is that same session, filled in once claude writes its transcript.
// A panel's row starting one passes a name and a first prompt, and mints the id itself, so it can remember the session before the tab exists.
async function openNewSession(cwd: string, joinGroupId?: string, launch: Pick<TabLaunch, 'name' | 'prompt'> = {}, id: string = crypto.randomUUID()): Promise<void> {
  const session = newSession(id, { cwd, repoRoot: cwd, title: launch.name || untitledLabel(cwd) });
  // Filed BEFORE the tab exists, so the row's first paint is already inside the group. An ordinary membership write: the id is the session's real one, so there is nothing to correct afterwards.
  if (joinGroupId) await moveSessionToGroup(session, joinGroupId);
  ensureProjectVisible(session.repoRoot);
  await createTab(session, { name: launch.name || undefined, prompt: launch.prompt || undefined });
}

/** Go to a session a panel's row started, as a jump from the attention strip does; one whose folder is gone says so, as its row in the list would. */
function openLinkedSession(id: string, launch: Pick<TabLaunch, 'prompt'> = {}): void {
  const session = sessionById(id);
  if (!session) return;
  const reason = unstartableReason(session);
  if (reason) {
    showToast(reason);
    return;
  }
  jumpToSession(session, launch);
}

// Start a new session in a fresh git worktree of `repoRoot`: `claude -w [name]`.
// Prompts for an optional name (blank -> claude auto-names).
// Like openNewSession, the tab carries the session's real id from the start; the worktree badge is the only optimistic part, and it reconciles on the next refresh.
async function openWorktreeSession(repoRoot: string, joinGroupId?: string): Promise<void> {
  // claude's `-w` name must be a slug (letters/digits/dots/underscores/dashes); turn the free-text label into one. A blank slug means auto-name, which can't collide.
  const slugify = (value: string): string => value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const label = await promptText(
    'New worktree session',
    `Worktree of "${projName(repoRoot, store.get())}"`,
    '',
    'Create',
    // Validate in the dialog so a duplicate name is caught without closing it — claude -w would otherwise silently switch to the existing worktree instead of creating one.
    async (value) => {
      const s = slugify(value);
      return s && (await window.claudeUi.worktreeExists(repoRoot, s))
        ? `A worktree named "${s}" already exists in this project.`
        : null;
    },
  );
  if (label === null) return;
  const friendly = label.trim();
  // Pass the label as `--name` so the session still displays what was typed.
  const slug = slugify(friendly);
  const session = newSession(crypto.randomUUID(), {
    cwd: repoRoot,
    repoRoot,
    isRepo: true,
    // Show the worktree badge right away (optimistic); it reconciles to the real name on refresh.
    worktree: slug || 'new worktree',
    // The name you typed becomes the title (it's also what --name sets); the badge already says it's a worktree, so no prefix. Blank name falls back to a plain new-session label.
    title: friendly || untitledLabel(repoRoot),
  });
  // Same as openNewSession: filed before the tab exists, so the row never appears loose.
  if (joinGroupId) await moveSessionToGroup(session, joinGroupId);
  ensureProjectVisible(session.repoRoot);
  await createTab(session, { name: friendly || undefined, worktree: slug });
}

// Fork an existing session: `claude --session-id <new> --resume <parent> --fork-session` copies its transcript into a new session in the same cwd.
// The fork's id is minted here like any other new session — claude honours it even while resuming — so the fork is a row of its own from the first paint, not one that arrives later.
async function forkSession(parent: SessionSummary): Promise<void> {
  const parentTitle = sessionLabel(parent, 'session');
  // Forks copy the parent's title, so offer a fresh name up front (via claude's --name). Cancel aborts the fork; keeping/clearing the field just inherits the parent title.
  const name = await promptText('Create fork', `Fork from "${parentTitle}"`, parentTitle, 'Fork');
  if (name === null) return;
  const trimmed = name.trim();
  const session = newSession(crypto.randomUUID(), {
    cwd: parent.cwd,
    repoRoot: parent.repoRoot,
    isRepo: parent.isRepo,
    worktree: parent.worktree,
    title: trimmed || parentTitle,
    // Mark it a family member right away (we know its parent is a sibling), so the row shows the sibling mark immediately instead of waiting for claude to write the transcript.
    // It reconciles to the real row once that file lands and grouping runs on the next refresh.
    isSibling: true,
    siblingIds: [parent.id],
  });
  ensureProjectVisible(session.repoRoot);
  // A fork continues its parent's work, so it belongs wherever the parent was filed — and it shows there immediately, like a new session started from the group's "+".
  const parentGroup = store.get().groupState.groupOf[entityKey(parent)];
  if (parentGroup) await moveSessionToGroup(session, parentGroup);
  await createTab(session, { resumeFrom: parent.id, fork: true, name: trimmed || undefined });
}

// --- Wiring ---

// Output and exits reach a tab through the sink it bound when it started (terminal.ts routes them by terminal id, for tabs and panels alike).
routeTerminals();

// --- What the store tells ---
// Subscribed before start-up sets anything, and told in this order.

// What the switcher's projects are made of changed, and the project on show may have none left: first, so everything after draws All rather than the empty project.
// The tabs are among them: a session with no transcript yet is in its project only through its tab.
store.watch(['sessions', 'archived', 'pendingDeletes', 'tabs'], fallBackIfEmptied, { reads: ['activeProject'] });

// The listing moved: the open tabs adopt their sessions' fresh summaries, before the list draws them, and the calendar's first day is the oldest session's.
store.watch(['sessions'], reconcileOpenTabs, { reads: ['tabs'] });
store.watch(['sessions'], applyDatePickerMinDate);

// Something the list draws changed — the listing, a model switch, a pin, the archive, a note, a delete in flight, the groups, a project's name or place, the project on show, the filter — and the list follows, with the filter's count and chips it draws.
// The list paints every dot it draws, but a status change repaints only the dots, below.
store.watch(
  ['sessions', 'switchedModel', 'pinned', 'archived', 'notes', 'pendingDeletes', 'groupState', 'projectNames', 'projectOrder', 'activeProject', 'filter'],
  listChanged,
  // The folds are read, never told: a heading's click folds in place without drawing the list, and whoever else folds draws it.
  { reads: ['statuses', 'acked', 'tabs', 'activeTab', 'folds', 'filterPanelOpen'] },
);

// A tab opened, started, stopped, closed or came on show: the rows' marks, and the list itself when what it draws from the tabs moved.
store.watch(['tabs', 'activeTab'], listFollowsTabs, {
  reads: ['sessions', 'statuses', 'acked', 'switchedModel', 'pinned', 'archived', 'notes', 'pendingDeletes', 'groupState', 'projectNames', 'projectOrder', 'activeProject', 'filter', 'folds', 'filterPanelOpen'],
});

// The filter panel opened or shut: it follows, with the chips that stand in for it while it is shut.
store.watch(['filterPanelOpen'], filterPanelFollows, { reads: ['filter'] });

// A status or a mark read changed: the rows' dots that differ.
store.watch(['statuses', 'acked'], dotsFollowStatuses);

// A tab not on show turned waiting or finished: a toast says so.
store.watch(['statuses'], toastAttention, { reads: ['tabs', 'activeTab', 'projectNames'] });

// The tab bar clusters its tabs by group, places its projects by the order under their names, and shows the project on show's tabs, as the list does: it follows the same changes, and every change to a tab or to which one is on show.
store.watch(['groupState', 'projectNames', 'projectOrder', 'activeProject', 'tabs', 'activeTab'], renderTabBar, { reads: ['sessions', 'statuses', 'acked'] });
// And a status or a mark read of one of its tabs' sessions.
store.watch(['statuses', 'acked'], tabBarFollowsStatuses, { reads: ['sessions', 'groupState', 'projectNames', 'projectOrder', 'activeProject', 'tabs', 'activeTab'] });

// The switcher counts every project's sessions, rolls up their statuses and names the project on show; the sidebar's rail icon says what its badge says.
// A session with no transcript yet is in its project only through its tab, so the tabs are among what it counts.
store.watch(['sessions', 'statuses', 'acked', 'archived', 'pendingDeletes', 'projectNames', 'projectOrder', 'activeProject', 'tabs'], refreshSwitcher);

// The strip lists what runs, in the bar's order, each row with a stop button in the tab's state, under a line badged with the switcher's roll-up; it shows those rows or folds to its line as you left it.
store.watch(['sessions', 'statuses', 'acked', 'archived', 'pendingDeletes', 'groupState', 'projectNames', 'projectOrder', 'tabs', 'footerExpanded'], refreshStrip);

// The terminal area's rail icon waits while a tab on show waits for you.
store.watch(['activeProject', 'tabs', 'statuses', 'acked'], railStatusFollowsTabs);

// The pane shows the tab on show, or says why there is none, which turns on the listing and the project on show too.
store.watch(['sessions', 'activeProject', 'tabs', 'activeTab'], paneFollows);

// The view you are leaving behind — the filter, the folds, the panel, the strip — is kept for the next launch; the snapshot is compared before it is written, so a change that ends where it began costs nothing.
store.watch(['filter', 'folds', 'filterPanelOpen', 'footerExpanded'], () => persistUi());

// The panels run where you are: in the tab on show's folder, or without one in the project's root, or in nothing in the All view.
store.watch(['activeProject', 'activeTab'], treeContextChanged);

// A panel's rows mark the sessions they started — each one's title, status dot, mark read, and whether it runs — so the panels hear of every change to those, and to which sessions a panel's rows started (its data, panels/links.ts).
store.watch(['sessions', 'statuses', 'acked', 'tabs', 'panelData'], treeSessionsChanged);

window.claudeUi.onSessionStatus((id, status, tabToken) => {
  // A tab's session can be REPLACED under it: `/clear` ends the session and starts a fresh one in the same terminal, under an id Claude Code chooses rather than one the app passed as `--session-id`.
  // The token is what ties the two together — without this the tab would keep pointing at the session that just ended, and resuming it later would reopen the wrong history.
  const owner = tabToken ? tabOf(tabToken) : undefined;
  if (owner && owner.session.id !== id) {
    const previous = owner.session;
    const replaced = previous.id;
    // A CLEARED SESSION IS A NEW SESSION, so it starts from the same blank the "+" button does rather than from its predecessor's row.
    // Carrying the old object forward was the app's own half of the copied-title problem: it kept the title, the first message and the sibling marks of a conversation this session does not have.
    // The folder is all that genuinely survives — it is the same terminal, in the same place.
    // Everything that draws the tab follows: the bar names the new session, its stand-in row is the open one, and the history on show follows it, since a cleared session has a transcript of its own.
    setTab(owner.token, {
      session: newSession(id, {
        cwd: previous.cwd,
        repoRoot: previous.repoRoot,
        isRepo: previous.isRepo,
        worktree: previous.worktree,
        title: untitledLabel(previous.cwd),
      }),
    });
    // The stand-in is ours to choose; the TITLE on disk is not, and is left alone.
    // Claude Code copies the cleared session's name into the new transcript, where nothing distinguishes it from a name somebody chose — so a named session goes on showing that name, exactly as `claude --resume` lists it. Overriding it would mean this app and the CLI disagreeing about what a session is called.
    // The pairing is recorded because nothing else can observe it: neither transcript points at the other, and the connection exists only in this moment.
    void window.claudeUi.recordClear(replaced, id, previous.title);
    persistOpenTabs();
    // A group says where this WORK lives, and clearing a session does not move the work — so the replacement joins the group its predecessor was in, rather than the tab visibly dropping out of its section.
    // The predecessor keeps its own membership: it is still a real session, and still that group's history.
    // Only the group carries over. A pin and a note are about one CONVERSATION, and that conversation still has its own row to hold them.
    const group = store.get().groupState.groupOf[replaced];
    if (group) void window.claudeUi.moveSessionToGroup(id, group).then(applyGroupState);
  }
  // What claude just did is in the transcript, and the history of the session on show reads it.
  if (tabOnShow(store.get())?.session.id === id) void history.refresh();
  // 'start' reports which session a tab is running, not a state it is in — and it fires mid-session on clear and compact, where setting a status would wipe a live one.
  // The one SessionStart that does mean a state (a compaction ending) reaches us as 'idle', not as this.
  if (status === 'start') return;
  setStatus(id, status);
  // A new session's title isn't on disk immediately; re-read on its status events until it is (this also replaces the tab's own stand-in row with the real one).
  if (tabWith(id) && !store.get().sessions.some((s) => s.id === id)) void refreshFromDisk();
});

window.claudeUi.onSessionModel((id, model) => {
  store.set({ switchedModel: withEntry(store.get().switchedModel, id, model) });
});

// The sidebar keeps itself current: a transcript created or changed on disk re-renders it.
// So does the history on show, which reads only what was added.
window.claudeUi.onSessionsChanged(() => {
  void refreshFromDisk();
  void history.refresh();
});

// Without the CLI every tab would open on "command not found", which reads as this app being broken rather than as a missing prerequisite. Say which one, and stay on screen until dismissed.
window.claudeUi.onClaudeMissing(() => {
  showToast('The claude CLI was not found on your PATH. Install it and restart claude-ui.', true);
});

async function pickFolderAndOpen(): Promise<void> {
  // Show an active state while the folder picker is open (it has no persistent menu of its own), matching how the other header buttons look while their panel/menu is up.
  newButton.classList.add('active');
  try {
    const dir = await window.claudeUi.pickFolder();
    if (dir) void hostOf('sessions').openNewSession(dir);
  } finally {
    newButton.classList.remove('active');
  }
}
newButton.addEventListener('click', () => void pickFolderAndOpen());
// The header's Settings icon comes from here too, rather than inline in the sidebar's markup, so it is drawn through the same helper as the rest.
settingsToggle.innerHTML = settingsIcon(14);
// Where the list was scrolled to is remembered, so a scroll of your own is a change to remember too.
container.addEventListener('scroll', persistUi);

// The window's own title bar, where the app draws its chrome (chrome.ts).
void startChrome();

installTooltips();
// The window's layout, drawn now so the first paint is already the window: the default layout until the file has been read, which the start-up below does before it draws a single row.
initTree({
  where: () => {
    const state = store.get();
    const tab = tabOnShow(state);
    return { tab: tab ? { cwd: tab.session.cwd, repoRoot: tab.session.repoRoot, id: tab.session.id } : null, project: state.activeProject };
  },
  showToast,
  hideToast,
  persist: persistUi,
  // The asks the terminal area answers.
  openSession: (id, prompt) => openLinkedSession(id, { prompt }),
  openTab: (id) => {
    const session = sessionById(id);
    if (session) void openSession(session);
  },
  openNewSession: (cwd, groupId, launch, id) => openNewSession(cwd, groupId, launch, id),
  openWorktreeSession: (repoRoot, groupId) => openWorktreeSession(repoRoot, groupId),
  forkSession: async (id) => {
    const session = sessionById(id);
    if (session) await forkSession(session);
  },
  stopSession: (id) => {
    const tab = tabWith(id);
    if (tab) stopSession(tab.token);
  },
  closeTabs: (id) => {
    for (const tab of store.get().tabs) if (entityKey(tab.session) === id) closeTab(tab.token);
  },
  showProject: (repoRoot) => switchWorkspaceTerminal(repoRoot),
  // The asks the session list answers.
  selectProject: (repoRoot) => selectProject(repoRoot),
  revealSession: (id) => {
    const session = sessionById(id);
    if (session) revealSessionInSidebar(session);
  },
  revealProject: (repoRoot) => revealProjectInSidebar(repoRoot),
  revealGroup: (repoRoot, groupId) => jumpToGroup(repoRoot, groupId),
});
// Restore the last-active project and open tabs, then scope the tab bar + terminal to that project.
void (async () => {
  void window.claudeUi.getHistoryPins().then((pins) => history.setPins(pins));
  // Before the first render: restoring filters afterwards would draw the whole list and then visibly cut it down.
  const { scrollTop, view } = await restoreUiState();
  // Before the rows and the tabs too: placing the layout moves the sidebar and the terminal area into it, and a move is cheapest, and invisible, while they are still empty.
  await loadLayout();
  // With the project you were in and the view you left, which scope and filter the first draw.
  await renderSessions({ startUp: view });
  forgetDeletedGroupFolds(store.get());
  startSavingUi();
  await restoreOpenTabs();
  // Again, now that the tabs exist. Two filters — open, and running — are questions about the TABS, and the render above happened while there were none, so a restored "open" filter would otherwise show an empty list next to a full tab bar. It also puts the open marker on the rows, which used to wait for the next render for its own reasons.
  renderList(store.get());
  // Last, because there is nothing to scroll until the rows are on screen. Later renders carry the offset along themselves.
  container.scrollTop = scrollTop;
  switchWorkspaceTerminal(store.get().activeProject);
  // After the tabs, so a panel's first run is in the restored tab's folder rather than once for the project and again for the tab.
  startPanels();
})();
paneFollows(store.get());
