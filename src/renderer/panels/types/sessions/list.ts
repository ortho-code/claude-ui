import type { OrderMove, SessionSummary } from '../../../../shared/types';
// Its rows are the card and its headings the section heading a list panel draws too.
import { listCard, sectionHeading, setFolded } from '../../../card';
import { confirmDelete, promptText } from '../../../dialogs';
import { flash } from '../../../flash';
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
} from '../../../logic';
import { openMenu, type MenuItem } from '../../../menu';
import { markProjectGone } from '../../../projectgone';
import { store, withMember, type StoredView, type TabState, type View } from '../../../state/app';
import { foldedGroups, foldedProjects, foldsWith } from '../../../state/folds';
import { applyGroupState, moveSessionToGroup } from '../../../state/groups';
import { isFiltering, projName, projectGroups, searchText, statusChanges, tabOnShow, tabWith, viewPool, visibleSessions } from '../../../state/views';
import { ackOnClick, applyStatus } from '../../../statusdot';
import { chevronIcon, folderIcon, layersIcon, NOTE_ICON, PIN_ICON, PINNED_ICON, SIBLING_ICON, strokeIcon, WORKTREE_ICON } from '../../../svg';
import { showToast } from '../../../toast';
import { setTooltip } from '../../../tooltip';
import { setUnavailable, unavailable } from '../../../unavailable';
import { hostOf } from '../builtin';
import { groupNameByKey, passesFilters, updateFilterStatus } from './filter';
// The sidebar's markup, which holds the list's elements: built before this module reads them.
import './index';
import './list.css';

/**
 * The sidebar's session list: a section per project holding its groups and then its loose rows, each row a session's card with its marks and controls; the menus and actions on rows and headings; the folds and collapse-all; and the reveals and jumps other surfaces ask for.
 * It follows the store (`listChanged`, `listFollowsTabs`, `dotsFollowStatuses`, registered by `watchList` in the sidebar's repaints, watch.ts), and reads what it draws from main in one change (`renderSessions`), which start-up and a row's delete both ask for.
 */

export const container = document.getElementById('sessions')!;
const collapseToggle = document.getElementById('collapse-toggle') as HTMLButtonElement;

// The chrome marks — carets, +, ⋮, ✓, × — as SVG rather than the text glyphs they used to be.
// Every one of those resolved through system font fallback, which is how ⑂ ended up rendering from a MONOSPACE face beside its neighbours (see the family and worktree marks in svg.ts).
// These render the same whatever the system has installed, take their colour from `currentColor` like the other icons, and are drawn through `strokeIcon`, which keeps their weight equal at every size.
// Chevrons, not filled triangles: the collapse-all button already says fold/unfold with a chevron, and a solid triangle would be the only filled shape in an outline icon set.
const chevronDown = (size: number): string => chevronIcon('down', size);
const plusIcon = (size: number): string => strokeIcon(size, '<path d="M8 3.5V12.5M3.5 8H12.5" />');
// Dots, so it stays a kebab rather than becoming a dashed line. The radius is in px for the same reason the stroke is: three 2.6px dots whatever the button's size.
const kebabIcon = (size: number): string => {
  const r = ((1.3 * 16) / size).toFixed(2);
  return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="currentColor"><circle cx="8" cy="3.4" r="${r}" /><circle cx="8" cy="8" r="${r}" /><circle cx="8" cy="12.6" r="${r}" /></svg>`;
};
const loadingEl = document.getElementById('loading')!;

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

/**
 * A tab opened, started, stopped, closed or came on show: the rows' marks follow, and the list itself is drawn again only when what it draws from the tabs moved since it last followed them (`before`).
 * The open and live filters ask which sessions have a tab and which of those run, and a session with no transcript yet is in the list only through its tab's stand-in row.
 */
function listFollowsTabs(view: ListView, { tabs: before }: View<'tabs'>): void {
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

/**
 * A status or a mark read changed: repaint the rows' dots that differ from what they were last painted from (`before`).
 * Not the list: it paints every dot it draws itself, and this is what keeps them current between its renders.
 */
function dotsFollowStatuses(view: View<'statuses' | 'acked'>, before: View<'statuses' | 'acked'>): void {
  const ids = statusChanges(before, view);
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

/**
 * A full read of what the list draws from main, set in one change.
 * Start-up's is written whole: nothing can have written those slices before the first draw but a status event from a claude a crashed launch left running, and leaving its statuses out for that one event would cost every other session's, which only this read has.
 * Any later one is written as of when it asked (`readAt`), so a status, a pin or a listing that landed while it was out is not put back to what it read.
 */
export async function renderSessions({ showLoading = true, revealed, startUp }: FullRead = {}): Promise<void> {
  if (showLoading) setLoading(true);
  try {
    const readAt = store.stamp();
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
    store.batch(() => {
      store.set(
        {
          sessions,
          statuses: new Map(Object.entries(statusMap)),
          pinned: new Set(pinnedList),
          archived: new Map(Object.entries(archivedList)),
          notes: new Map(Object.entries(noteMap)),
          groupState,
          projectNames: new Map(Object.entries(namesMap)),
          projectOrder,
          ...(startUp ? { activeProject: storedProject, ...startUp } : {}),
        },
        startUp ? undefined : { readAt },
      );
      // In the same change, so a row whose files are gone never shows for a moment between no longer hiding it and the listing without it.
      // Whatever listing that is: one that landed while this read was out was asked after the delete too, which is why this one was left out.
      if (revealed !== undefined) store.set({ pendingDeletes: withMember(store.get().pendingDeletes, revealed, false) });
    });
  } finally {
    if (showLoading) setLoading(false);
  }
}

/** What draws the list again: the listing, a model switch, a pin, the archive, a note, a delete in flight, the groups, a project's name or place, the project on show, the filter. */
const LIST_TOLD = ['sessions', 'switchedModel', 'pinned', 'archived', 'notes', 'pendingDeletes', 'groupState', 'projectNames', 'projectOrder', 'activeProject', 'filter'] as const;
/** The tabs, which have a watcher of their own (`listFollowsTabs`), since most of a tab's changes move only the rows' marks. */
const LIST_TABS = ['tabs', 'activeTab'] as const;
/**
 * What the list reads and is never told of: a status change repaints only the dots (`dotsFollowStatuses`); the folds, since a heading's click folds in place without drawing the list, and whoever else folds draws it; and whether the filter panel is open.
 */
const LIST_QUIET = ['statuses', 'acked', 'folds', 'filterPanelOpen'] as const;

/** Everything the list draws from the store. */
type ListView = View<(typeof LIST_TOLD)[number] | (typeof LIST_TABS)[number] | (typeof LIST_QUIET)[number]>;

/** The list's watchers, registered in the sidebar's repaints (watch.ts), each slice named once above. */
export function watchList(): void {
  store.watch(LIST_TOLD, listChanged, { reads: [...LIST_TABS, ...LIST_QUIET] });
  store.watch(LIST_TABS, listFollowsTabs, { reads: [...LIST_TOLD, ...LIST_QUIET] });
  store.watch(['statuses', 'acked'], dotsFollowStatuses);
}

/** The list follows the store, with the filter's count and chips it draws. */
function listChanged(view: ListView, before: View<'filter' | 'activeProject'>): void {
  const reshaped = view.filter !== before.filter || view.activeProject !== before.activeProject;
  renderList(view);
  // A new filter or another project reshapes the list, so it starts at the top rather than at a stale scroll offset — whoever chose the project, the switcher or a new tab elsewhere dropping the list to All.
  if (reshaped) container.scrollTop = 0;
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
    setFolded(els.caret, collapsed);
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
      setFolded(groupEls.caret, groupCollapsed);
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
export function revealSessionInSidebar(session: SessionSummary): void {
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
export function revealProjectInSidebar(repoRoot: string): void {
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
export function jumpToGroup(repoRoot: string, groupId: string | null): void {
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
 * Fold or unfold a section: remember it, hide the rows, turn the caret; saving follows the folds.
 * Both toggles deliberately skip renderList — no flicker, no scroll jump.
 */
function toggleFold(section: HTMLElement, caret: HTMLElement, kind: 'projects' | 'groups', key: string): void {
  const state = store.get();
  const collapsed = !(kind === 'projects' ? foldedProjects(state) : foldedGroups(state)).has(key);
  // The list reads the folds without being told of them, so this draws nothing but the section.
  store.set({ folds: foldsWith(state, kind, [key], collapsed) });
  section.classList.toggle('collapsed', collapsed);
  setFolded(caret, collapsed);
}

// Build a project section once; its contents (name, count, caret, rows) are drawn by reconcileProjectSections, on this render and every later one.
function createProjectSection(name: string, folderCwd?: string): ProjectSectionEls {
  const section = document.createElement('section');
  section.className = 'project';

  const { heading, caret, icon, label, count } = sectionHeading('project', folderIcon(14));
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
  heading.append(groupsBtn);
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

  const { heading, caret, label, count } = sectionHeading('bar', layersIcon(13));
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
  heading.append(split, kebab);
  heading.addEventListener('click', () => {
    toggleFold(section, caret, 'groups', id);
  });

  // The rows live in their own element so the indent and its rail wrap the whole group, which is what shows where a group ends without needing to read the next heading.
  const members = document.createElement('div');
  members.className = 'group-members';
  const empty = document.createElement('div');
  empty.className = 'section-empty'; // its text depends on the project's folder, so reconcileProjectSections writes it
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
  const { card: item, content, title, meta } = listCard('session');
  item.dataset.key = key;

  const dot = document.createElement('span');
  // Click the dot to toggle "read": mute a done/waiting session without opening or replying to it.
  ackOnClick(dot, () => currentByKey.get(key)?.id ?? null);
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
  // The card's meta line holds the time and model, plus the note mark riding along at the end of that text.
  // The mark lives HERE rather than beside the title because a sibling box next to a text block has to have its alignment guessed; inside the text row it just centres.
  // The meta is short and single-line, so nothing can clip the mark off the way a two-line title clamp would.
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
  content.append(subline);

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

  item.prepend(dot);
  item.append(pin, unarchiveBtn, deleteBtn, kebab);
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
