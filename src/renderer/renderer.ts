import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CanvasAddon } from '@xterm/addon-canvas';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { ClaudeUiApi, OrderMove, GroupState, SessionGroup, SessionSummary, UiState } from '../shared/types';
import {
  sessionsByKey,
  structuralSignature,
  buildProjectTree,
  folderName,
  displayName,
  entityKey,
  reorderWithinGroup,
  type ProjectTree,
  groupJumpTargets,
  type GroupJumpTarget,
  relativeTime,
  modelLabel,
  sessionPasses,
  datePresetRange,
  projectsForSwitcher,
  hasVisibleOutput,
  type NudgeStatus,
  type SwitcherModel,
} from './logic';
import { installTooltips, setTooltip } from './tooltip';
import AirDatepicker from 'air-datepicker';
import localeEn from 'air-datepicker/locale/en';
import Sortable from 'sortablejs';

declare global {
  interface Window {
    claudeUi: ClaudeUiApi;
  }
}

const container = document.getElementById('sessions')!;
const newButton = document.getElementById('new-session') as HTMLButtonElement;
const pinnedFilter = document.getElementById('pinned-filter') as HTMLButtonElement;
const openFilter = document.getElementById('open-filter') as HTMLButtonElement;
const runningFilter = document.getElementById('running-filter') as HTMLButtonElement;
const worktreeFilter = document.getElementById('worktree-filter') as HTMLButtonElement;
const siblingFilter = document.getElementById('sibling-filter') as HTMLButtonElement;
const noteFilter = document.getElementById('note-filter') as HTMLButtonElement;
const archivedFilter = document.getElementById('archived-filter') as HTMLButtonElement;
const filterToggle = document.getElementById('filter-toggle') as HTMLButtonElement;
const collapseToggle = document.getElementById('collapse-toggle') as HTMLButtonElement;
const filterPanel = document.getElementById('filter-panel')!;
const datePresets = document.getElementById('date-presets')!;
const dateCustom = document.getElementById('date-custom')!;
const dateRangeLabel = document.getElementById('date-range-label')!; // persistent line under presets
const dateRangeCaption = document.getElementById('date-range-caption')!; // same text, inside calendar
const pad2 = (n: number): string => String(n).padStart(2, '0');
// Inline range calendar.
// Custom-rendered month/year views (click the header to zoom out to a months grid, then a years grid, arrows paging through) and no native <select>, so it behaves under WSLg.
// Capped at today: sessions are never in the future.
let suppressPickerSelect = false;
const datePicker = new AirDatepicker(document.getElementById('date-range')!, {
  inline: true,
  range: true,
  locale: localeEn,
  maxDate: new Date(),
  onSelect: () => {
    if (!suppressPickerSelect) onCustomDateChange();
  },
});
const searchInput = document.getElementById('search') as HTMLInputElement;
const switcherEl = document.getElementById('project-switcher')!;
const switcherCurrent = document.getElementById('switcher-current') as HTMLButtonElement;
const switcherName = document.getElementById('switcher-name')!;
const switcherBadge = document.getElementById('switcher-badge')!;
const switcherPopover = document.getElementById('switcher-popover')!;
const footerToggle = document.getElementById('footer-toggle')!;
const footerBadge = document.getElementById('footer-badge')!;
const footerLabel = document.getElementById('footer-label')!;
const footerList = document.getElementById('footer-list')!;

// A group's mark: layers, meaning "several things stacked as one". Muted, never accent — the accent belongs to the project's folder icon one line above it.
const layersIcon = (size: number): string =>
  `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M8 2.2 2 5.4l6 3.2 6-3.2-6-3.2Z" /><path d="M2.4 9.2 8 12.2l5.6-3" /></svg>`;

const FOLDER_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M2 4h4l1.5 1.5H14V13H2z"/></svg>';

// The chrome marks — carets, +, ⋮, ✓, × — as SVG rather than the text glyphs they used to be.
// Every one of those resolved through system font fallback, which is how ⑂ ended up rendering from a MONOSPACE face beside its neighbours (see the family/worktree marks below).
// These render the same whatever the system has installed, take their colour from `currentColor` like the other icons, and have their ink centred on (8,8) in the viewBox so flex centring lands them square with no nudge.
// `ink` is the stroke the user actually SEES, in px — the viewBox is a fixed 16 units, so a constant stroke-width would draw a 9px caret at two-thirds the weight of a 14px one and the set would look mismatched at exactly the sizes this chrome uses.
// Converting px to units per size keeps every mark the same visual weight, and 1.3px is the weight the existing folder/layers icons already render at.
const strokeIcon = (size: number, path: string, ink = 1.3): string =>
  `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${((ink * 16) / size).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
// Chevrons, not filled triangles: the collapse-all button already says fold/unfold with a chevron, and a solid triangle would be the only filled shape in an outline icon set.
const chevronDown = (size: number): string => strokeIcon(size, '<path d="M4 6L8 10L12 6" />');
const chevronRight = (size: number): string => strokeIcon(size, '<path d="M6 4L10 8L6 12" />');
const plusIcon = (size: number): string => strokeIcon(size, '<path d="M8 3.5V12.5M3.5 8H12.5" />');
const tickIcon = (size: number): string => strokeIcon(size, '<path d="M3.5 8.4L6.6 11.5L12.5 4.9" />', 1.5);
const closeIcon = (size: number): string => strokeIcon(size, '<path d="M4.6 4.6L11.4 11.4M11.4 4.6L4.6 11.4" />');
// A tab's button ends the session before it removes the tab, so it needs two marks rather than one: the media-stop square for the first press, the cross for the second. Squared off at 6.6 units so it reads at the same weight as the cross's diagonal.
const stopIcon = (size: number): string => strokeIcon(size, '<rect x="4.7" y="4.7" width="6.6" height="6.6" rx="1.2" />');
// Dots, so it stays a kebab rather than becoming a dashed line. The radius is in px for the same reason the stroke is: three 2.6px dots whatever the button's size.
const kebabIcon = (size: number): string => {
  const r = ((1.3 * 16) / size).toFixed(2);
  return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" fill="currentColor"><circle cx="8" cy="3.4" r="${r}" /><circle cx="8" cy="8" r="${r}" /><circle cx="8" cy="12.6" r="${r}" /></svg>`;
};
// One helper for every collapsible section's caret, so project and group carets can't drift apart.
const caretIcon = (collapsed: boolean, size: number): string => (collapsed ? chevronRight(size) : chevronDown(size));
const filterStatus = document.getElementById('filter-status')!;
const filterCount = document.getElementById('filter-count')!;
const filterClear = document.getElementById('filter-clear') as HTMLButtonElement;
const loadingEl = document.getElementById('loading')!;
const tabbar = document.getElementById('tabbar')!;
const terminalsEl = document.getElementById('terminals')!;
const placeholder = document.getElementById('term-placeholder')!;
const confirmOverlay = document.getElementById('confirm-overlay')!;
const confirmMessage = document.getElementById('confirm-message')!;
const confirmDetail = document.getElementById('confirm-detail')!;
const confirmOk = document.getElementById('confirm-ok') as HTMLButtonElement;
const confirmCancel = document.getElementById('confirm-cancel') as HTMLButtonElement;
const renameOverlay = document.getElementById('rename-overlay')!;
const renameTitle = document.getElementById('rename-title')!;
const renamePath = document.getElementById('rename-path')!;
const renameError = document.getElementById('rename-error')!;
const renameInput = document.getElementById('rename-input') as HTMLInputElement;
const renameTextarea = document.getElementById('rename-textarea') as HTMLTextAreaElement;
const renameOk = document.getElementById('rename-ok') as HTMLButtonElement;
const renameCancel = document.getElementById('rename-cancel') as HTMLButtonElement;
const toast = document.getElementById('toast')!;
const toastMessage = document.getElementById('toast-message')!;
const toastClose = document.getElementById('toast-close') as HTMLButtonElement;

let toastTimer: number | undefined;
function hideToast(): void {
  toast.hidden = true;
  if (toastTimer) clearTimeout(toastTimer);
}
/**
 * `sticky` keeps the message up until it is dismissed, for a condition that will not resolve on its own — a missing `claude` CLI is the case it exists for, where three seconds would be gone before the sentence was read.
 */
function showToast(message: string, sticky = false): void {
  toastMessage.textContent = message;
  toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = sticky ? undefined : window.setTimeout(hideToast, 3000);
}
toastClose.addEventListener('click', hideToast);

// Stacking attention toasts: a background tab (one you're not viewing) went waiting/idle. Separate from the one-off #toast message bar above.
const notifications = document.getElementById('notifications')!;
const NOTIF_TTL = 5000;
const NOTIF_MAX = 4;

function showAttentionToast(tab: Tab, status: 'waiting' | 'idle'): void {
  const el = document.createElement('div');
  el.className = `notif ${status}`;
  const dot = document.createElement('span');
  dot.className = `project-badge ${status}`;
  // The dot/edge colour already says waiting vs finished; the text names the tab and its project.
  const text = document.createElement('span');
  text.className = 'notif-text';
  const title = document.createElement('span');
  title.className = 'notif-title';
  title.textContent = sessionLabel(tab.session);
  const proj = document.createElement('span');
  proj.className = 'notif-proj';
  proj.textContent = projName(tab.session.repoRoot);
  text.append(title, proj);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'notif-close';
  close.innerHTML = closeIcon(14);
  close.setAttribute('aria-label', 'Dismiss');
  el.append(dot, text, close);

  let timer: number | undefined;
  const dismiss = (): void => {
    window.clearTimeout(timer);
    el.remove();
  };
  const arm = (): void => {
    timer = window.setTimeout(dismiss, NOTIF_TTL);
  };
  el.addEventListener('mouseenter', () => window.clearTimeout(timer));
  el.addEventListener('mouseleave', arm);
  el.addEventListener('click', () => {
    dismiss();
    jumpToTab(tab);
  });
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    dismiss();
  });

  notifications.prepend(el); // newest on top
  while (notifications.childElementCount > NOTIF_MAX) notifications.lastElementChild?.remove();
  arm();
}

// A real transition into waiting/idle on a tab you're not looking at -> toast it. Never for busy, a cleared status, a no-op repeat, or the tab you're already on.
function maybeAttentionToast(id: string, status: string | undefined, prev: string | undefined): void {
  if ((status !== 'waiting' && status !== 'idle') || status === prev) return;
  const tab = tabs.find((t) => t.session.id === id);
  if (!tab || tab === activeTab) return;
  showAttentionToast(tab, status);
}

// Jump to a tab from a toast: scope to its project if we're viewing a different one, then activate it.
function jumpToTab(tab: Tab): void {
  if (activeProject !== null && activeProject !== tab.session.repoRoot) {
    selectProject(tab.session.repoRoot);
  }
  activateTab(tab);
}

function setLoading(on: boolean): void {
  loadingEl.classList.toggle('active', on);
}

let pinned = new Set<string>();
let archived = new Map<string, number>();
let projectNames = new Map<string, string>(); // repoRoot -> user rename override
// The explicit project order. Seeded from the recency order the list already had, so switching this on changed nothing on screen; from then on it only moves when the user moves it.
let projectOrder: string[] = [];
// Session id -> note. Only sessions that HAVE one appear here (a blank note deletes its entry).
let notes = new Map<string, string>();
const projName = (repoRoot: string): string => displayName(repoRoot, projectNames);
// Conversations whose delete is in flight: hidden from the list until that delete resolves, so a concurrent delete's disk re-read can't briefly resurrect them.
const pendingDeletes = new Set<string>();
let statuses = new Map<string, string>();
// Session ids whose dot the user has marked "read": shown dimmed (no pulse) instead of the live colour. In-memory only, so a restart re-lights everything. Any incoming status event clears it.
const acked = new Set<string>();
let allSessions: SessionSummary[] = [];
let filterText = '';
let showPinnedOnly = false;
let showOpenOnly = false;
let showRunningOnly = false;
let showWorktreeOnly = false;
let showSiblingsOnly = false;
let showNotedOnly = false;
let showArchivedOnly = false;
// The project the switcher is scoped to; null = "All" (the grouped overview). Persisted, like the rest of the view state.
let activeProject: string | null = null;
// Date filter, as an inclusive [from, to] window in epoch ms; null means unbounded on that side.
let datePreset = 'any';
let dateFromMs: number | null = null;
let dateToMs: number | null = null;
// Structure of the last rendered list, so disk changes that only grow a transcript (new lastActivity) doesn't trigger a rebuild — we re-render only on structural change.
let lastSignature = '';
// Status dots by tip session id; rebuilt each render (a status event names a session id).
const statusDots = new Map<string, HTMLElement>();
// Row elements by entity key (the session id), reused across renders so a re-render moves nodes instead of recreating them — no flicker, no scroll jump, hover/focus kept.
const sessionRows = new Map<string, HTMLElement>();
// Every section currently rendered, so collapse-all/expand-all acts on precisely what is on screen rather than on everything that has ever existed.
let renderedSections: { projects: string[]; groups: string[] } = { projects: [], groups: [] };
const collapsedProjects = new Set<string>();
// Collapsed custom groups, by group id (projects collapse by repo root, groups by their own id).
const collapsedGroups = new Set<string>();
/**
 * The same two, for while a filter is on — and a separate pair rather than a flag, because they answer a different question.
 *
 * Filtering opens the whole tree, so that a match inside something you had folded away is not hidden from you.
 * Folding from there is a way THROUGH the results — shut a project you have already looked at — rather than a statement about how you like the sidebar arranged.
 * So these last exactly as long as the filter, and leave the folds you made without a filter untouched underneath.
 *
 * They are stored all the same: the filter itself is restored on the next launch, and coming back to the same results without the same view is precisely what remembering the view is for.
 */
const filterFoldedProjects = new Set<string>();
const filterFoldedGroups = new Set<string>();

/** The fold sets in play right now: the transient pair while filtering, the stored pair otherwise. Every read and every write goes through these, so the two can never be mixed up. */
function foldedProjects(): Set<string> {
  return isFiltering() ? filterFoldedProjects : collapsedProjects;
}
function foldedGroups(): Set<string> {
  return isFiltering() ? filterFoldedGroups : collapsedGroups;
}
// Every group and who is in one, loaded once at startup and refreshed after any change.
let groupState: GroupState = { groups: [], groupOf: {} };
// Group membership for sessions that do not exist on disk yet, keyed by their PLACEHOLDER id.
// A new session started from a group's "+" (or a fork of a grouped session) has no real id until claude reports for it, but it must show inside its group straight away rather than appearing loose and jumping in later.
// Kept in memory only — placeholder ids are transient and never belong in meta.
const pendingGroupOf = new Map<string, string>();

// The membership the UI should draw: what's on disk, plus the not-yet-created sessions.
function effectiveGroupState(): GroupState {
  if (pendingGroupOf.size === 0) return groupState;
  return { groups: groupState.groups, groupOf: { ...groupState.groupOf, ...Object.fromEntries(pendingGroupOf) } };
}

interface ProjectSectionEls {
  section: HTMLElement;
  heading: HTMLElement;
  caret: HTMLElement;
  count: HTMLElement;
  label: HTMLElement;
  /** Opens the jump-to-a-group menu; hidden below 2 targets, disabled while filtering. */
  groupsBtn: HTMLButtonElement;
  /** The new-session split-button's dropdown caret (present only for a project with a folder). */
  addCaret?: HTMLElement;
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
  /** Holds the member rows; the indent and its rail live on this element. */
  members: HTMLElement;
  /** Shown instead of rows when the group has no members yet. */
  empty: HTMLElement;
}
// Group sections by group id, reused across renders like the project sections above.
const groupSections = new Map<string, GroupSectionEls>();
// The session each row currently shows, by entity key (session id), so a reused row's click/pin handlers act on the live session data of the latest render.
let currentByKey = new Map<string, SessionSummary>();

function isOpen(id: string): boolean {
  return tabs.some((t) => t.session.id === id);
}

function updateSidebarHighlight(): void {
  for (const row of sessionRows.values()) {
    const id = row.dataset.sid ?? '';
    const tab = tabs.find((t) => t.session.id === id);
    row.classList.toggle('open', tab !== undefined);
    // "Has a tab" and "is running" stopped being the same thing once tabs restore cold, so the row says which: an accent bar for a live session, a muted one for a tab waiting to be resumed.
    row.classList.toggle('cold', tab !== undefined && tab.terminalId === null);
    row.classList.toggle('active-session', activeTab?.session.id === id);
  }
}

// Keep open tabs' titles in sync with the freshly-read session list: a new session's first message / AI title, a rename, or a regenerated AI title all land here on the next read.
function reconcileOpenTabs(): void {
  const byId = new Map(allSessions.map((s) => [s.id, s]));
  let changed = false;
  for (const tab of tabs) {
    const fresh = byId.get(tab.session.id);
    if (!fresh) continue;
    // Always adopt the fresh summary (cheap, and keeps a tab's data from going stale), but only rebuild the bar when something the TAB shows actually differs.
    // Comparing only title/firstMessage used to leave the mid-session cases behind: entering a worktree or gaining a sibling changes worktree/isSibling (and repoRoot, which groups the tabs), so the mark never appeared until the next unrelated title change.
    const shownDiffers =
      fresh.title !== tab.session.title ||
      fresh.firstMessage !== tab.session.firstMessage ||
      fresh.worktree !== tab.session.worktree ||
      fresh.repoRoot !== tab.session.repoRoot ||
      fresh.isSibling !== tab.session.isSibling ||
      fresh.siblingIds.length !== tab.session.siblingIds.length;
    tab.session = fresh;
    if (shownDiffers) changed = true;
    if (fresh.title || fresh.firstMessage) tab.needsTitle = false;
  }
  if (changed) renderTabBar();
}

function setStatus(id: string, status: string | undefined): void {
  const prev = statuses.get(id);
  if (status) statuses.set(id, status);
  else statuses.delete(id);
  // A new status event is fresh activity: drop any "read" mark so the dot re-lights (and, for a new waiting, re-pulses) even if the user had acked the previous state.
  acked.delete(id);
  renderStatusDot(id);
  refreshSwitcher(); // keep the project roll-up badges live
  maybeAttentionToast(id, status, prev);
}

// Repaint a session's dot wherever it shows (sidebar row + open tab) from the current status/ack.
function renderStatusDot(id: string): void {
  const dot = statusDots.get(id);
  if (dot) applyStatus(dot, statuses.get(id), acked.has(id));
  if (tabs.some((t) => t.session.id === id)) renderTabBar();
}

// Toggle the "read" mark on a session's dot: mutes a live status (dimmed, no pulse) without closing the tab or replying.
// Only the attention states are ackable — idle (done) and waiting (needs you).
// Busy (working) and closed/hollow have nothing to acknowledge, so acking them is a no-op.
function toggleAck(id: string): void {
  const status = statuses.get(id);
  if (status !== 'idle' && status !== 'waiting') return;
  if (acked.has(id)) acked.delete(id);
  else acked.add(id);
  renderStatusDot(id);
  refreshSwitcher(); // an acked/un-acked session changes its project's roll-up badge
}

// You've attended to a session by viewing it, so drop its "needs you" nudge.
function clearNudge(id: string): void {
  window.claudeUi.clearStatus(id);
  setStatus(id, undefined);
}

interface Tab {
  session: SessionSummary;
  /**
   * The running process, or null when the tab is COLD — built and listed, with no claude behind it.
   * Restored tabs start cold and spawn on activation; a null id is why nothing routes to them and why their input is dropped rather than sent nowhere.
   */
  terminalId: number | null;
  /** Guards against a second start while the first is still awaiting its terminal id. */
  starting?: boolean;
  /**
   * Spawned, but nothing has come out of the pty yet — the window where the pane would otherwise be black.
   * MEASURED at 2.3-3.4s for a claude start, which is far too long to show nothing.
   * Cleared by the first byte of output, deliberately rather than by anything claude-specific: claude never switches to the alternate screen buffer (the sequence is absent from the binary), so there is no "the TUI is up" marker to wait for, and a signal that depends on how claude renders would break the moment it changed.
   */
  booting?: boolean;
  /** Set while a user-initiated stop is in flight, so its exit cools the tab instead of closing it. */
  stopping?: boolean;
  term: Terminal;
  fitAddon: FitAddon;
  el: HTMLElement;
  // Unique per terminal; the status hook echoes it so we can learn a new session's real id.
  token: string;
  // A new session has no title on disk yet; keep re-reading on status events until it does.
  needsTitle: boolean;
  // The group this session should join the moment it has a real id. A brand-new session runs on a placeholder id, so it cannot be filed until claude reports for it (see onSessionStatus).
  joinGroupId?: string;
  // When claude was launched, to tell a real exit from a failed-to-start one.
  startedAt: number;
  // Bumped on each activation, so a workspace switch can restore a project's most-recent tab.
  activatedSeq: number;
}

const tabs: Tab[] = [];
let activeTab: Tab | null = null;
let activationSeq = 0;
// Where you were, per project and overall.
// Seeded from meta at restore and kept current as you switch, so returning to a project lands where you left it even across a restart — `activatedSeq` alone cannot do that, since it resets to 0 when tabs are rebuilt.
let activeByProject: Record<string, string> = {};
let lastActiveKey: string | null = null;
let restoring = false;
// Set once the app is quitting.
// Shutdown kills every terminal, and each pty exit closes its tab; we must not let those closes persist an empty open-tabs list over the real one (it would wipe the tabs to restore next launch).
// Set via onQuitting, below.
let shuttingDown = false;

function persistOpenTabs(): void {
  if (restoring || shuttingDown) return;
  // Persist entity keys (session ids — immutable, so a restart always finds them again). Fall back to the tab's placeholder id before it has reconciled to disk.
  const idToKey = new Map(allSessions.map((s) => [s.id, entityKey(s)]));
  window.claudeUi.setOpenSessions(tabs.map((t) => idToKey.get(t.session.id) ?? t.session.id));
}

async function restoreOpenTabs(): Promise<void> {
  restoring = true;
  try {
    const [sessions, openKeys, activeKey, byProject] = await Promise.all([
      window.claudeUi.listSessions(),
      window.claudeUi.getOpenSessions(),
      window.claudeUi.getActiveSession(),
      window.claudeUi.getActiveSessionByProject(),
    ]);
    activeByProject = { ...byProject };
    lastActiveKey = activeKey;
    const tips = sessionsByKey(sessions);
    // Restore the tabs COLD — no claude process each.
    // Starting them all was costing 20 processes at ~437 MB on this machine, spawned whether or not any was used, plus 20 CLI cold starts on every launch.
    // A tab starts when you select it.
    let toActivate: Tab | null = null;
    for (const key of openKeys) {
      const session = tips.get(key);
      if (!session) continue;
      const tab = buildTab(session, false);
      if (key === activeKey) toActivate = tab;
    }
    // Land where you left off — SELECTED but not started, since nothing is meant to be live after a restart. Without a remembered tab we open on none rather than guessing.
    if (toActivate) activateTab(toActivate, false);
    else updatePlaceholder();
  } finally {
    restoring = false;
    persistOpenTabs();
  }
}

// --- Sidebar ---

async function renderSessions(showLoading = true): Promise<void> {
  if (showLoading) setLoading(true);
  try {
    const [sessions, pinnedList, archivedList, statusMap, namesMap, noteMap] = await Promise.all([
      window.claudeUi.listSessions(),
      window.claudeUi.getPinned(),
      window.claudeUi.getArchived(),
      window.claudeUi.getAllStatuses(),
      window.claudeUi.getProjectNames(),
      window.claudeUi.getNotes(),
    ]);
    allSessions = sessions;
    // Seed from the RAW list (archived included — the transcript still exists), so a project whose sessions are all archived still holds a slot.
    // Writes only when a root is genuinely new, so the common case costs one read.
    // Recency order is what seeds the very first run.
    projectOrder = await window.claudeUi.seedProjectOrder([...new Set(sessions.map((s) => s.repoRoot))]);
    applyDatePickerMinDate();
    pinned = new Set(pinnedList);
    archived = new Map(Object.entries(archivedList));
    projectNames = new Map(Object.entries(namesMap));
    notes = new Map(Object.entries(noteMap));
    statuses = new Map(Object.entries(statusMap));
    lastSignature = structuralSignature(sessions);
    reconcileOpenTabs();
    renderList();
  } finally {
    if (showLoading) setLoading(false);
  }
}

// A disk change fired: re-read sessions but only re-render when the structure actually changed (a new/removed session, a rename, or a new branch becoming the tip).
// Statuses and pins arrive on their own channels, so we don't refetch them here.
async function refreshFromDisk(): Promise<void> {
  const sessions = await window.claudeUi.listSessions();
  allSessions = sessions;
  const signature = structuralSignature(sessions);
  if (signature === lastSignature) return;
  lastSignature = signature;
  applyDatePickerMinDate();
  reconcileOpenTabs();
  renderList();
}

// Any filter active? Used to auto-expand projects with matches and to show the filter status.
function isFiltering(): boolean {
  return (
    filterText.length > 0 ||
    showPinnedOnly ||
    showOpenOnly ||
    showRunningOnly ||
    showWorktreeOnly ||
    showSiblingsOnly ||
    showNotedOnly ||
    showArchivedOnly ||
    datePreset !== 'any'
  );
}

// Session key -> its group's NAME, so typing a group name reaches its sessions.
// Built ONCE per filter pass and handed in: passesFilters runs per session, so building it there would be one pass over the membership map per row.
function groupNameByKey(): Map<string, string> {
  const byId = new Map(groupState.groups.map((g) => [g.id, g.name]));
  const out = new Map<string, string>();
  for (const [key, id] of Object.entries(effectiveGroupState().groupOf)) {
    const name = byId.get(id);
    if (name) out.set(key, name);
  }
  return out;
}

// Adapt the current filter state to the pure predicate.
function passesFilters(session: SessionSummary, groupNames?: ReadonlyMap<string, string>): boolean {
  return sessionPasses(session, {
    groupNames,
    text: filterText,
    pinnedOnly: showPinnedOnly,
    openOnly: showOpenOnly,
    open: showOpenOnly ? new Set(tabs.map((t) => entityKey(t.session))) : undefined,
    runningOnly: showRunningOnly,
    // Built per call rather than hoisted: cheap next to the tab count, and it must reflect the tabs as they are right now, since starting or stopping one changes what this filter shows.
    running: showRunningOnly
      ? new Set(tabs.filter((t) => t.terminalId !== null).map((t) => entityKey(t.session)))
      : undefined,
    worktreeOnly: showWorktreeOnly,
    siblingOnly: showSiblingsOnly,
    notedOnly: showNotedOnly,
    archivedOnly: showArchivedOnly,
    dateFrom: dateFromMs,
    dateTo: dateToMs,
    pinned,
    archived,
    notes,
    pendingDeletes,
  });
}

// The custom-range calendar is an inline popover; its open state is independent of the active preset, so a picked range stays applied while the calendar is dismissed.
let datePopoverOpen = false;
function setDatePopover(open: boolean): void {
  datePopoverOpen = open;
  dateCustom.hidden = !open;
}

// Translate the date presets into the [from, to] window. Presets are rolling from now; custom reads the calendar selection.
function applyDatePreset(preset: string): void {
  datePreset = preset;
  // The persistent range line shows only while Custom is the active preset (open or closed calendar).
  dateRangeLabel.hidden = preset !== 'custom';
  for (const chip of datePresets.querySelectorAll('button')) {
    chip.classList.toggle('active', (chip as HTMLElement).dataset.range === preset);
  }
  if (preset === 'custom') {
    // Custom just selects the mode; the range bar is the one control that opens the calendar.
    applyCustomDates();
  } else {
    setDatePopover(false);
    const range = datePresetRange(preset, Date.now());
    dateFromMs = range.from;
    dateToMs = range.to;
  }
}

function applyCustomDates(): void {
  const [from, to] = datePicker.selectedDates.slice().sort((a, b) => a.getTime() - b.getTime());
  dateFromMs = from ? new Date(from).setHours(0, 0, 0, 0) : null;
  dateToMs = to ? new Date(to).setHours(23, 59, 59, 999) : null;
  updateDateRangeLabel(from, to);
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
function applyDatePickerMinDate(): void {
  const earliest = allSessions.reduce<number | null>((min, s) => {
    const t = Date.parse(s.lastActivity);
    return min === null || t < min ? t : min;
  }, null);
  datePicker.update({ minDate: earliest !== null ? new Date(earliest) : false }, { silent: true });
}

// Make an active filter obvious: show "N of M" with a clear button and flag the active controls.
function updateFilterStatus(matches: number, total: number): void {
  const filtering = isFiltering();
  filterStatus.hidden = !filtering;
  searchInput.classList.toggle('active', filterText.length > 0);
  pinnedFilter.classList.toggle('active', showPinnedOnly);
  pinnedFilter.setAttribute('aria-pressed', String(showPinnedOnly));
  openFilter.classList.toggle('active', showOpenOnly);
  openFilter.setAttribute('aria-pressed', String(showOpenOnly));
  runningFilter.classList.toggle('active', showRunningOnly);
  runningFilter.setAttribute('aria-pressed', String(showRunningOnly));
  worktreeFilter.classList.toggle('active', showWorktreeOnly);
  worktreeFilter.setAttribute('aria-pressed', String(showWorktreeOnly));
  siblingFilter.classList.toggle('active', showSiblingsOnly);
  siblingFilter.setAttribute('aria-pressed', String(showSiblingsOnly));
  noteFilter.classList.toggle('active', showNotedOnly);
  noteFilter.setAttribute('aria-pressed', String(showNotedOnly));
  archivedFilter.classList.toggle('active', showArchivedOnly);
  archivedFilter.setAttribute('aria-pressed', String(showArchivedOnly));
  // The toggle carries the accent when any filter is on, so an active filter is visible even with the panel closed.
  filterToggle.classList.toggle('active', filtering);
  if (filtering) filterCount.textContent = `Showing ${matches} of ${total}`;
}

function clearFilter(): void {
  searchInput.value = '';
  filterText = '';
  showPinnedOnly = false;
  showOpenOnly = false;
  showRunningOnly = false;
  showWorktreeOnly = false;
  showSiblingsOnly = false;
  showNotedOnly = false;
  showArchivedOnly = false;
  suppressPickerSelect = true;
  datePicker.clear();
  suppressPickerSelect = false;
  applyDatePreset('any');
  renderList();
  container.scrollTop = 0;
}

// --- View state that survives a restart ---
// Search, filters, folds, width and scroll are one answer to one question — put the sidebar back the way it was — so they are snapshotted, stored and restored together rather than as a setting each.

/**
 * Show or hide the filter panel. Split out because both the toggle and the restore need it, and the restore must not touch focus: at startup the terminal wants it.
 */
function setFilterPanel(open: boolean): void {
  filterPanel.hidden = !open;
  filterToggle.setAttribute('aria-expanded', String(open));
}

// Nothing is written until the stored state has been applied, or the first render would snapshot an empty sidebar straight over the real one.
let uiRestored = false;
let uiSaveTimer: number | undefined;
// The last snapshot actually sent. Renders happen for reasons that have nothing to do with the view — a transcript growing, a status dot changing — and without this each one would cost a full read-modify-write of meta.json.
let lastUiSignature = '';

function uiSnapshot(): UiState {
  return {
    // The raw box contents, not the trimmed and lowercased `filterText`: what is restored has to be what was typed.
    search: searchInput.value,
    filters: {
      pinned: showPinnedOnly,
      open: showOpenOnly,
      running: showRunningOnly,
      worktree: showWorktreeOnly,
      siblings: showSiblingsOnly,
      noted: showNotedOnly,
      archived: showArchivedOnly,
    },
    datePreset,
    dateFrom: dateFromMs,
    dateTo: dateToMs,
    filterPanelOpen: !filterPanel.hidden,
    footerExpanded,
    collapsedProjects: [...collapsedProjects],
    collapsedGroups: [...collapsedGroups],
    filterCollapsedProjects: [...filterFoldedProjects],
    filterCollapsedGroups: [...filterFoldedGroups],
    // An empty flex-basis means the sidebar has never been dragged, so the stylesheet still owns the width.
    sidebarWidth: parseInt(sidebar.style.flexBasis, 10) || null,
    scrollTop: container.scrollTop,
  };
}

/**
 * Store the view, on a debounce.
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
 * Put the sidebar back the way it was left, and hand back the scroll offset to apply once there is a list to scroll.
 *
 * Runs before the first render on purpose: restoring filters afterwards would draw the full list and then visibly cut it down.
 * Reads `groupState`, so it has to run after that is loaded.
 */
async function restoreUiState(): Promise<number> {
  const state = await window.claudeUi.getUiState();
  searchInput.value = state.search;
  filterText = state.search.trim().toLowerCase();
  showPinnedOnly = state.filters.pinned;
  showOpenOnly = state.filters.open;
  showRunningOnly = state.filters.running;
  showWorktreeOnly = state.filters.worktree;
  showSiblingsOnly = state.filters.siblings;
  showNotedOnly = state.filters.noted;
  showArchivedOnly = state.filters.archived;
  for (const repoRoot of state.collapsedProjects) collapsedProjects.add(repoRoot);
  for (const repoRoot of state.filterCollapsedProjects) filterFoldedProjects.add(repoRoot);
  // A project keeps its fold even while it has no sessions to show (same reasoning as projectOrder), but a DELETED group is gone for good, and this is the one moment we know which ids are real.
  const liveGroups = new Set(groupState.groups.map((g) => g.id));
  for (const id of state.collapsedGroups) if (liveGroups.has(id)) collapsedGroups.add(id);
  for (const id of state.filterCollapsedGroups) if (liveGroups.has(id)) filterFoldedGroups.add(id);
  // Nothing special is needed for a restore that lands with no filter on: the first render empties these, and stores that.
  // The width lived in localStorage before this; adopt that value once, so an existing install keeps its sidebar, and let meta.json own it from here.
  const width = state.sidebarWidth ?? Number(localStorage.getItem('sidebarWidth'));
  if (width >= SIDEBAR_MIN && width <= SIDEBAR_MAX) sidebar.style.flexBasis = `${width}px`;
  // Only a CUSTOM range is restored as stored. The rolling presets are recomputed by applyDatePreset from the current moment, which is the whole point of "last 7 days" still meaning the last 7 days.
  if (state.datePreset === 'custom') {
    const picked = [state.dateFrom, state.dateTo].filter((ms): ms is number => ms !== null).map((ms) => new Date(ms));
    if (picked.length > 0) {
      // Awaited, because applyDatePreset reads the range back OUT of the picker: the selection has to have landed first.
      // Flagged rather than the picker's own `silent`, so the calendar still repaints — this only needs onSelect not to re-apply and re-render mid-restore.
      suppressPickerSelect = true;
      await datePicker.selectDate(picked);
      suppressPickerSelect = false;
    }
  }
  applyDatePreset(state.datePreset);
  // Exactly as it was left, an active filter included. Closing the panel over a filter you have deliberately left on is a choice to keep the results and reclaim the space; the filter icon carries its accent while anything is on, which is the cue that the list is cut down.
  setFilterPanel(state.filterPanelOpen);
  footerExpanded = state.footerExpanded;
  uiRestored = true;
  // Seed the signature from what was just restored, so an opening render that changed nothing writes nothing.
  lastUiSignature = JSON.stringify(uiSnapshot());
  return state.scrollTop;
}

// --- Project switcher ---

// Update the switcher header + popover from the visible project pool. The pool is every project's tips (see renderList); the switcher is independent of search/project so you can always navigate.
function renderSwitcher(pool: SessionSummary[]): void {
  const model = projectsForSwitcher(pool, statuses, acked, projectNames, projectOrder);
  const active = activeProject ? model.projects.find((f) => f.repoRoot === activeProject) : null;
  switcherName.textContent = active ? active.name : 'All';

  // Header nudge: the overall roll-up across ALL projects (incl. the active one and busy), so any attention is visible at a glance even when scoped to a project or scrolled down a long list.
  const headerBadge = model.all.badge;
  switcherBadge.className = headerBadge ? `project-badge ${headerBadge}` : 'project-badge';
  switcherBadge.hidden = !headerBadge;
  setTooltip(switcherBadge, headerBadge ? `A project is ${headerBadge}` : null);

  switcherPopover.replaceChildren(
    switcherItem('All', null, model.all.count, null, activeProject === null),
    ...model.projects.map((f) => switcherItem(f.name, f.repoRoot, f.count, f.badge, f.repoRoot === activeProject)),
  );

  renderFooter(model, pool);
}

const NUDGE_ORDER: Record<'waiting' | 'idle' | 'busy', number> = { waiting: 0, idle: 1, busy: 2 };
// Seeded from meta at startup (default open — the strip exists to be read), and written back on every toggle so the choice survives a restart.
let footerExpanded = true;

// A session's contribution to the roll-up: its live status, but an acked idle/waiting counts as nothing (muted), same rule as the switcher badges.
function sessionNudge(id: string): NudgeStatus {
  const st = statuses.get(id);
  if (st === 'waiting' || st === 'idle') return acked.has(id) ? null : st;
  if (st === 'busy') return 'busy';
  return null;
}

// The one place a session's display label is composed: title, else first message, else a fallback (the short id by default).
// Every surface shows the same name this way, and any sanitization of the underlying fields (command tags, caveat plumbing) lands everywhere at once.
function sessionLabel(session: SessionSummary, fallback = session.id.slice(0, 8)): string {
  return session.title || session.firstMessage || fallback;
}

// Copy to the clipboard with a small confirmation toast; the OS gives no visible cue otherwise.
async function copyText(text: string, confirmation: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast(confirmation);
  } catch {
    showToast("Couldn't copy to the clipboard.");
  }
}

// Jump to a specific session from the footer: scope to its project if needed, then open/focus its tab.
function jumpToSession(session: SessionSummary): void {
  if (activeProject !== null && activeProject !== session.repoRoot) selectProject(session.repoRoot);
  void openSession(session);
  // Scope alone isn't enough to SEE it: the row can sit inside a collapsed group or project.
  // Reveal the same way clicking a tab does — jumping to a sibling filed in another group is exactly the case where scoping to the project still leaves the row hidden.
  revealSessionInSidebar(session);
}

// A session's siblings (the other members of its family), most recent first. Shared by the count badge and the kebab submenu.
function siblingsOf(session: SessionSummary): SessionSummary[] {
  return allSessions
    .filter((s) => session.siblingIds.includes(s.id))
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

// Menu items for a sibling list; siblings often share a title, so each shows title + when.
function siblingMenuItems(siblings: SessionSummary[]): MenuItem[] {
  return siblings.map((sibling) => ({
    label: `${sessionLabel(sibling)} · ${relativeTime(sibling.lastActivity)}`,
    onSelect: () => jumpToSession(sibling),
  }));
}

// --- Group actions ------------------------------------------------------------------------------ Every mutation goes through the main process and hands back the whole state, so the renderer never second-guesses what changed — it swaps its copy and re-renders.

function applyGroupState(next: GroupState): void {
  groupState = next;
  renderList();
  renderTabBar(); // the bar clusters by group too, so it has to follow the same change
}

// The groups belonging to one project, in registry order.
function projectGroups(repoRoot: string): SessionGroup[] {
  return groupState.groups.filter((g) => g.repoRoot === repoRoot);
}

async function moveSessionToGroup(session: SessionSummary, groupId: string | null): Promise<void> {
  applyGroupState(await window.claudeUi.moveSessionToGroup(entityKey(session), groupId));
}

// "New group…" from a row names the group and moves the session into it in one step, so the group is never briefly empty and the user never has to find it again to fill it.
async function newGroupForSession(session: SessionSummary): Promise<void> {
  const name = await promptText('New group', projName(session.repoRoot), '', 'Create');
  if (name === null || !name.trim()) return;
  applyGroupState(await window.claudeUi.createGroup(name, session.repoRoot, entityKey(session)));
}

// The four ordering moves for a group, minus any that would be a no-op here: the first group has no "up", the last no "down", and a lone group in a project has nowhere to go at all.
// So the menu never offers a move that does nothing.
function groupMoveItems(id: string): MenuItem[] {
  // Same reason as projects: filtering drops groups whose sessions all fell out, so a neighbour can be missing from the screen and the move would appear to do nothing.
  if (isFiltering()) return [];
  const group = groupState.groups.find((g) => g.id === id);
  if (!group?.repoRoot) return [];
  const siblings = projectGroups(group.repoRoot);
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
  const group = groupState.groups.find((g) => g.id === id);
  if (!group) return;
  const name = await promptText('Rename group', projName(group.repoRoot ?? ''), group.name);
  if (name === null || !name.trim()) return;
  applyGroupState(await window.claudeUi.renameGroup(id, name));
}

// No confirmation: nothing is destroyed. The group goes and its members simply sit under the project again — unlike deleting a session, which trashes a transcript.
async function deleteGroupById(id: string): Promise<void> {
  const group = groupState.groups.find((g) => g.id === id);
  applyGroupState(await window.claudeUi.deleteGroup(id));
  if (group) showToast(`Group "${group.name}" deleted. Its sessions are back under the project.`);
}

// The "Move to group" list: the project's groups with the current one ticked, then the two ways out — back to the project, or into a group that doesn't exist yet.
function moveToGroupItems(session: SessionSummary): MenuItem[] {
  const current = groupState.groupOf[entityKey(session)];
  const items: MenuItem[] = projectGroups(session.repoRoot).map((group) => ({
    label: group.name,
    checked: group.id === current,
    onSelect: () => void moveSessionToGroup(session, group.id),
  }));
  if (items.length > 0) items.push({ label: '', separator: true });
  items.push({ label: 'None', checked: !current, onSelect: () => void moveSessionToGroup(session, null) });
  items.push({ label: 'New group…', onSelect: () => void newGroupForSession(session) });
  return items;
}

// Archive/unarchive one session. Archiving puts it away, so any open tab for it closes too (unarchive leaves tabs alone). Shared by the kebab item and the archived view's row button.
async function toggleArchiveFor(key: string): Promise<void> {
  archived = new Map(Object.entries(await window.claudeUi.toggleArchive(key)));
  if (archived.has(key)) {
    for (const tab of [...tabs]) if (entityKey(tab.session) === key) closeTab(tab);
  }
  renderList();
}

// The per-session action list — one builder, shared by the row kebab (and any future surface that offers session actions, e.g. a tab context menu).
function sessionMenuItems(session: SessionSummary): MenuItem[] {
  const items: MenuItem[] = [{ label: 'Fork this session', onSelect: () => { void forkSession(session); } }];
  const siblings = siblingsOf(session);
  if (siblings.length > 0) {
    items.push({ label: `Siblings (${siblings.length})`, submenu: siblingMenuItems(siblings) });
  }
  items.push({ label: notes.has(entityKey(session)) ? 'Edit note…' : 'Add note…', onSelect: () => void editNote(session) });
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
  const text = await promptText('Note', sessionLabel(session), notes.get(key) ?? '', 'Save', undefined, true);
  if (text === null) return; // cancelled: leave whatever was there
  notes = new Map(Object.entries(await window.claudeUi.setNote(key, text)));
  renderList();
}

// List a session's siblings in the shared popover; click one to jump to it.
function openSiblingsMenu(anchor: HTMLElement, session: SessionSummary): void {
  const siblings = siblingsOf(session);
  // The mark can briefly outlive its siblings (a delete between refreshes); nothing to list then.
  if (siblings.length === 0) return;
  openMenu(anchor, siblingMenuItems(siblings));
}

// Cross-project attention strip in the sidebar footer.
// The toggle badge is the same overall roll-up as the switcher header; expanded, it lists the nudged SESSIONS grouped under their project (each a row: state dot + session title), click one to jump to it.
// Muted "all clear" when nothing pending.
function renderFooter(model: SwitcherModel, pool: SessionSummary[]): void {
  const overall = model.all.badge;
  footerBadge.className = overall ? `project-badge ${overall}` : 'project-badge';
  footerBadge.hidden = !overall;

  // Nudged sessions grouped by project; projects and sessions ordered attention-first.
  const projects = new Map<string, { name: string; items: { session: SessionSummary; badge: NudgeStatus }[] }>();
  for (const session of pool) {
    const badge = sessionNudge(session.id);
    if (!badge) continue;
    let project = projects.get(session.repoRoot);
    if (!project) {
      project = { name: projName(session.repoRoot), items: [] };
      projects.set(session.repoRoot, project);
    }
    project.items.push({ session, badge });
  }
  for (const project of projects.values()) {
    project.items.sort((a, b) => NUDGE_ORDER[a.badge!] - NUDGE_ORDER[b.badge!]);
  }
  const ordered = [...projects.values()].sort((a, b) => NUDGE_ORDER[a.items[0].badge!] - NUDGE_ORDER[b.items[0].badge!]);
  const total = ordered.reduce((n, g) => n + g.items.length, 0);

  if (total === 0) {
    // Collapsed for this render only — deliberately NOT touching footerExpanded, or an all-clear moment would quietly reset a preference the user set.
    footerToggle.classList.add('clear');
    footerToggle.setAttribute('aria-expanded', 'false');
    footerLabel.textContent = 'All clear';
    footerList.hidden = true;
    footerList.replaceChildren();
    return;
  }

  footerToggle.classList.remove('clear');
  footerToggle.setAttribute('aria-expanded', String(footerExpanded));
  footerLabel.textContent = `${total} ${total === 1 ? 'session' : 'sessions'}`;
  footerList.hidden = !footerExpanded;
  footerList.replaceChildren(
    ...ordered.flatMap((project) => {
      const heading = document.createElement('div');
      heading.className = 'footer-project';
      heading.textContent = project.name;
      const rows = project.items.map(({ session, badge }) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'footer-item';
        const dot = document.createElement('span');
        dot.className = `project-badge ${badge}`;
        const name = document.createElement('span');
        name.className = 'footer-item-name';
        name.textContent = sessionLabel(session);
        row.append(dot, name);
        setTooltip(row, sessionLabel(session, '') || null);
        row.addEventListener('click', () => jumpToSession(session));
        return row;
      });
      return [heading, ...rows];
    }),
  );
}

footerToggle.addEventListener('click', () => {
  if (footerToggle.classList.contains('clear')) return; // nothing to expand
  footerExpanded = !footerExpanded;
  footerList.hidden = !footerExpanded;
  footerToggle.setAttribute('aria-expanded', String(footerExpanded));
  persistUi();
});

function switcherItem(name: string, repoRoot: string | null, count: number, badge: NudgeStatus, active: boolean): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = active ? 'switcher-item active' : 'switcher-item';
  btn.setAttribute('role', 'menuitem');
  setTooltip(btn, repoRoot ?? 'All projects'); // full path on hover (the row shows only the last segment)

  const label = document.createElement('span');
  label.className = 'switcher-item-name';
  label.textContent = name;

  const dot = document.createElement('span');
  dot.className = badge ? `project-badge ${badge}` : 'project-badge';

  const cnt = document.createElement('span');
  cnt.className = 'switcher-item-count';
  cnt.textContent = String(count);

  btn.append(label, dot, cnt);
  btn.addEventListener('click', () => selectProject(repoRoot));
  return btn;
}

function selectProject(repoRoot: string | null): void {
  activeProject = repoRoot;
  // Open a project expanded even if it was collapsed in the All view.
  if (repoRoot) foldedProjects().delete(repoRoot);
  window.claudeUi.setActiveProject(repoRoot);
  closeSwitcher();
  renderList();
  container.scrollTop = 0;
  // Full workspace switch: also move the tab bar + active terminal to this project.
  switchWorkspaceTerminal(repoRoot);
}

function openSwitcher(): void {
  switcherPopover.hidden = false;
  switcherCurrent.setAttribute('aria-expanded', 'true');
  document.addEventListener('click', onSwitcherOutside, true);
}

function closeSwitcher(): void {
  switcherPopover.hidden = true;
  switcherCurrent.setAttribute('aria-expanded', 'false');
  document.removeEventListener('click', onSwitcherOutside, true);
}

function onSwitcherOutside(event: MouseEvent): void {
  if (!switcherEl.contains(event.target as Node)) closeSwitcher();
}

switcherCurrent.addEventListener('click', () => {
  if (switcherPopover.hidden) openSwitcher();
  else closeSwitcher();
});

// The sessions the sidebar can show: every session on disk, plus new-but-unsaved tabs (so a fresh session appears in its project immediately, before it is written to disk).
function visibleSessions(): SessionSummary[] {
  const tips = sessionsByKey(allSessions);
  const knownIds = new Set(allSessions.map((s) => s.id));
  const pending = tabs.filter((t) => t.needsTitle && !knownIds.has(t.session.id)).map((t) => t.session);
  return [...pending, ...tips.values()];
}

// The switcher's project pool: every project's tips minus archived/pending-delete, independent of the search text and active project so you can always navigate to any project.
function switcherPool(all: SessionSummary[]): SessionSummary[] {
  return all.filter((s) => !archived.has(entityKey(s)) && !pendingDeletes.has(entityKey(s)));
}

// Repaint just the switcher (header + popover badges) — used when a status/ack change should update the roll-up badges without re-rendering the whole list.
function refreshSwitcher(): void {
  renderSwitcher(switcherPool(visibleSessions()));
}

// Render from the cached session list, applying the current search filter.
// Keystrokes call this directly so filtering never re-reads disk.
// Reuses project/row nodes by key so a re-render moves elements into place instead of rebuilding the sidebar (no flicker, scroll stays put).
function renderList(): void {
  const scroll = container.scrollTop;
  statusDots.clear();
  // The filter is off, so the folds made while it was on have served their purpose and go. Done here rather than where a filter is cleared, because a filter also ends by deleting the last character, by a date preset going back to Any, and by Clear.
  if (!isFiltering()) {
    filterFoldedProjects.clear();
    filterFoldedGroups.clear();
  }

  // Include new sessions not yet written to disk (from their open tabs) so they appear in the list immediately, in the right project; they reconcile to the real entry once created.
  const all = visibleSessions();
  currentByKey = new Map(all.map((s) => [entityKey(s), s]));
  // The switcher lists every project, independent of search/project, so you can always navigate. If the active project no longer has any sessions, fall back to All (and persist that).
  const pool = switcherPool(all);
  if (activeProject && !pool.some((s) => s.repoRoot === activeProject)) {
    activeProject = null;
    window.claudeUi.setActiveProject(null);
  }
  renderSwitcher(pool);

  const groupNames = filterText ? groupNameByKey() : undefined;
  const filtered = all.filter((s) => passesFilters(s, groupNames));
  // Project scope applies everywhere, the archived view included.
  // It used to be exempt, from when archived was a rarely-visited global bin — but the scope is an explicit statement of what you are looking at, and one view quietly overriding it reads as a leak.
  // Switch to All to find an archived session whose project you have forgotten.
  const scoped = activeProject ? filtered.filter((s) => s.repoRoot === activeProject) : filtered;
  updateFilterStatus(scoped.length, all.length);

  if (scoped.length === 0) {
    clearList();
    const message = document.createElement('div');
    message.className = 'empty-message';
    message.textContent = all.length === 0 ? 'No sessions found in ~/.claude/projects.' : 'No matches.';
    container.append(message);
    // Nothing on screen to fold away: this early return would otherwise leave the toggle live with the previous render's sections.
    renderedSections = { projects: [], groups: [] };
    updateCollapseToggle();
    persistUi();
    return;
  }
  container.querySelector(':scope > .empty-message')?.remove();

  // One section per repo, each holding its groups and then the sessions in no group.
  // Every ordering rule (groups first, pins floated inside their own section) lives in the pure builder.
  // While filtering, groups whose sessions all fell out are dropped rather than left as empty headings.
  const tree = buildProjectTree(scoped, effectiveGroupState(), pinned, isFiltering(), projectOrder);
  renderedSections = {
    projects: tree.map((p) => p.repoRoot),
    groups: tree.flatMap((p) => p.groups.map((g) => g.group.id)),
  };
  reconcileProjectSections(tree);
  pruneRows(new Set(scoped.map((s) => entityKey(s))));

  container.scrollTop = scroll;
  updateSidebarHighlight();
  updateCollapseToggle();
  syncStickyOffset();
  updatePlaceholder(); // its wording depends on whether there are sessions at all
  // Every change to a filter or a fold ends here, so this one call covers all of them; the snapshot is compared before it is written, so the renders that change nothing about the view cost nothing.
  persistUi();
}

// Chevrons stacked in the direction things will move: up to fold everything away, down to open it again. Ink centred on 8,8 like the row icons, so the glyph sits square in its button.
const COLLAPSE_ALL_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.49" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7.25L8 3.75L12 7.25" /><path d="M4 12.25L8 8.75L12 12.25" /></svg>';
const EXPAND_ALL_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.49" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3.75L8 7.25L12 3.75" /><path d="M4 8.75L8 12.25L12 8.75" /></svg>';

// What the button folds depends on the view.
// In All it folds the project sections (keyed on projects alone: with every project shut its groups are out of sight anyway, which is why a group toggling on its own needs no refresh call).
// In a single-project view folding the one project you asked to look at is pointless, so it folds THAT project's groups instead.
function collapseScope(): { ids: string[]; collapsed: Set<string> } {
  return activeProject === null
    ? { ids: renderedSections.projects, collapsed: foldedProjects() }
    : { ids: renderedSections.groups, collapsed: foldedGroups() };
}

// Everything in scope folded away already? Then the button offers the way back instead.
function allSectionsCollapsed(): boolean {
  const { ids, collapsed } = collapseScope();
  return ids.length > 0 && ids.every((id) => collapsed.has(id));
}

function updateCollapseToggle(): void {
  // Filtering forces every section open (so matches inside a collapsed one are visible), which leaves this nothing to act on.
  collapseToggle.disabled = isFiltering() || collapseScope().ids.length === 0;
  const label = allSectionsCollapsed() ? 'Expand all' : 'Collapse all';
  collapseToggle.innerHTML = allSectionsCollapsed() ? EXPAND_ALL_ICON : COLLAPSE_ALL_ICON;
  setTooltip(collapseToggle, label);
  collapseToggle.setAttribute('aria-label', label);
}

// Collapsing takes the groups with it, so expanding a project afterwards shows its group headings rather than dumping every row back at once — two levels of overview instead of one.
collapseToggle.addEventListener('click', () => {
  const { ids, collapsed } = collapseScope();
  const expanding = allSectionsCollapsed();
  for (const id of ids) {
    if (expanding) collapsed.delete(id);
    else collapsed.add(id);
  }
  // In the All view a project's groups fold along with it, so expanding one afterwards shows its group headings rather than dumping every row back. In a project view the groups ARE the scope already.
  if (activeProject === null) {
    if (expanding) foldedGroups().clear();
    else for (const id of renderedSections.groups) foldedGroups().add(id);
  }
  renderList();
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
function reconcileProjectSections(desired: ProjectTree[]): void {
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
    const collapsed = activeProject === null && foldedProjects().has(project.repoRoot);
    els.section.classList.toggle('collapsed', collapsed);
    // A project view can't collapse its one project, so it shows no caret and no clickable styling.
    els.section.classList.toggle('no-collapse', activeProject !== null);
    els.caret.hidden = activeProject !== null;
    els.caret.innerHTML = caretIcon(collapsed, 10);
    els.count.textContent = String(project.count);
    els.label.textContent = projName(project.repoRoot); // keep the heading current (e.g. after a rename)
    // Below 2 targets there is nowhere to jump, and the heading is already carrying six controls at a 320px sidebar — so the button is absent rather than dimmed.
    // Filtering forces every section open and reshuffles what is on screen, which leaves the jump nothing to act on: disabled there, like collapse-all, since a control vanishing as you type reads worse than one plainly unavailable.
    const targets = groupJumpTargets(project, statuses, acked);
    jumpTargets.set(project.repoRoot, targets);
    els.groupsBtn.hidden = targets.length < 2;
    els.groupsBtn.disabled = isFiltering();
    if (els.addCaret) els.addCaret.hidden = !project.isRepo; // worktree option only for git repos
    for (const { group, sessions } of project.groups) {
      const groupEls = groupSections.get(group.id) ?? createGroupSection(group.id);
      groupSections.set(group.id, groupEls);
      const groupCollapsed = foldedGroups().has(group.id);
      groupEls.section.classList.toggle('collapsed', groupCollapsed);
      groupEls.caret.innerHTML = caretIcon(groupCollapsed, 10);
      groupEls.label.textContent = group.name;
      groupEls.count.textContent = String(sessions.length);
      groupEls.addCaret.hidden = !project.isRepo; // worktree option only for git repos
      groupEls.empty.hidden = sessions.length > 0;
      for (const session of sessions) {
        const row = getOrCreateRow(entityKey(session));
        updateRow(row, session);
        row.classList.remove('after-groups'); // rows are reused: it may have been a loose row before
        groupEls.members.appendChild(row);
      }
      els.section.appendChild(groupEls.section);
    }
    // Ungrouped sessions sit directly under the project heading, at full width — there is no "Ungrouped" heading, so the indent alone says whether a row is in a group.
    let first = true;
    for (const session of project.loose) {
      const row = getOrCreateRow(entityKey(session));
      updateRow(row, session);
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

// In-app confirm modal (a native dialog flickers under WSLg).
// Resolves true on Delete, false on Cancel / Esc.
// Deliberately NOT dismissable by clicking the backdrop: selecting text inside the dialog and releasing the mouse outside it dispatches the click on the common ancestor of the mousedown and mouseup — the overlay — so an outside-click dismiss threw the dialog away mid-drag.
function confirmDelete(title: string): Promise<boolean> {
  confirmMessage.textContent = `Delete "${title}"?`;
  confirmDetail.textContent = 'Its transcript files move to the trash, so you can restore them from there if needed.';
  confirmOverlay.hidden = false;
  // Focus Cancel, not Delete: safer default for a destructive action, and it keeps the accent focus ring off the red button.
  confirmCancel.focus();
  return new Promise((resolve) => {
    const close = (result: boolean): void => {
      confirmOverlay.hidden = true;
      confirmOk.removeEventListener('click', onOk);
      confirmCancel.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onOk = (): void => close(true);
    const onCancel = (): void => close(false);
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close(false);
    };
    confirmOk.addEventListener('click', onOk);
    confirmCancel.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
  });
}

// A small modal text prompt (Promise-resolving): OK/Enter resolves the value, Cancel/Esc resolves null.
// No backdrop dismiss, for the same drag-select reason as the confirm modal above.
// Shared by project rename, fork naming, and worktree naming; okLabel names the confirm button.
// An optional async `validate` runs on submit: return an error string to show it inline and keep the dialog open (so the user can fix the value), or null to accept.
function promptText(
  title: string,
  context: string,
  initialValue: string,
  okLabel = 'Save',
  validate?: (value: string) => Promise<string | null> | string | null,
  // Multiline swaps the single-line input for a textarea (session notes). Same dialog, same skin — only the field and what Enter means differ.
  multiline = false,
): Promise<string | null> {
  renameTitle.textContent = title;
  renamePath.textContent = context;
  renamePath.hidden = !context; // no empty context line (e.g. the fork dialog puts it in the title)
  renameError.hidden = true;
  renameOk.textContent = okLabel;
  const field: HTMLInputElement | HTMLTextAreaElement = multiline ? renameTextarea : renameInput;
  // A union of input|textarea loses addEventListener's keyed overloads (the handler would widen to
  // Event), so listeners go through the element as an HTMLElement while `field` keeps .value typed.
  const fieldEl: HTMLElement = field;
  renameInput.hidden = multiline;
  renameTextarea.hidden = !multiline;
  field.value = initialValue;
  renameOverlay.hidden = false;
  field.focus();
  // Select-all suits a short name you're replacing; a note you're editing wants the caret at the end.
  if (multiline) field.setSelectionRange(initialValue.length, initialValue.length);
  else field.select();
  return new Promise((resolve) => {
    const close = (result: string | null): void => {
      renameOverlay.hidden = true;
      renameOk.removeEventListener('click', onOk);
      renameCancel.removeEventListener('click', onCancel);
      fieldEl.removeEventListener('keydown', onInputKey);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    // Validate before accepting; on an error, show it inline and leave the dialog open.
    const submit = async (): Promise<void> => {
      const value = field.value;
      if (validate) {
        const error = await validate(value);
        if (error) {
          renameError.textContent = error;
          renameError.hidden = false;
          return;
        }
      }
      close(value);
    };
    const onOk = (): void => void submit();
    const onCancel = (): void => close(null);
    // Enter belongs to the field (it submits what you typed), but Esc has to close the dialog from anywhere: clicking the dialog's own text blurs the input, and with no backdrop dismiss that would otherwise leave Cancel as the only way out.
    // Same document-level Esc as confirmDelete.
    const onInputKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter') return;
      // In a note, Enter is a newline; Ctrl/Cmd+Enter saves (same habit as the terminal). A one-line field submits on plain Enter as before.
      if (!multiline) void submit();
      else if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        void submit();
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close(null);
    };
    renameOk.addEventListener('click', onOk);
    renameCancel.addEventListener('click', onCancel);
    fieldEl.addEventListener('keydown', onInputKey);
    document.addEventListener('keydown', onKey);
  });
}

// The ordering moves for a project, minus any that would do nothing — same rule as a group's.
// The order spans every project ever seen, so the ends are the ends of THAT list, not of what's on screen (a filter or an all-archived project can hide neighbours without changing where this one sits).
function projectMoveItems(repoRoot: string): MenuItem[] {
  // All view only: a project view renders a single heading, so there is nothing to order against.
  if (activeProject !== null) return [];
  // Not while filtering either: a hidden neighbour makes the move land where you can't see it, so "Move up" past a filtered-out project looks like a button that did nothing.
  if (isFiltering()) return [];
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

async function moveProjectBy(repoRoot: string, move: OrderMove): Promise<void> {
  projectOrder = await window.claudeUi.moveProject(repoRoot, move);
  renderList();
}

async function renameProject(repoRoot: string): Promise<void> {
  const name = await promptText('Rename project', repoRoot, projName(repoRoot));
  if (name === null) return;
  // Typing the folder name back clears the override rather than storing a redundant one.
  const canonical = name.trim() === folderName(repoRoot) ? '' : name;
  projectNames = new Map(Object.entries(await window.claudeUi.setProjectName(repoRoot, canonical)));
  renderList();
  renderTabBar();
}

// A small floating kebab menu, generic over its items so the project-heading and session-row kebabs share the open/close/outside-click machinery.
// An item may carry a `submenu`: it then opens a child list on hover (one level deep) instead of running an action.
interface MenuItem {
  label: string;
  onSelect?: () => void;
  submenu?: MenuItem[];
  /** Present on items in a pick-one list: shows a tick column, so the current choice is visible. */
  checked?: boolean;
  /** A rule instead of an item, splitting a list into groups of related actions. */
  separator?: boolean;
  /** A count for the thing the item names, right-aligned in its own column. */
  count?: number;
  /** A rolled-up status dot ahead of the label, in the column a tick would use. */
  badge?: NudgeStatus;
  /** Dims the label — used for "Ungrouped", which is a place rather than a named thing. */
  muted?: boolean;
}
let openMenuEl: HTMLElement | null = null;
let openMenuAnchor: HTMLElement | null = null;
let openSubmenuEl: HTMLElement | null = null;
let openSubmenuOwner: HTMLElement | null = null;
function closeSubmenu(): void {
  openSubmenuEl?.remove();
  openSubmenuEl = null;
  openSubmenuOwner?.classList.remove('menu-open'); // parent row drops its held state
  openSubmenuOwner = null;
}
function closeMenu(): void {
  closeSubmenu();
  openMenuEl?.remove();
  openMenuEl = null;
  openMenuAnchor?.classList.remove('menu-open');
  openMenuAnchor = null;
  document.removeEventListener('click', onMenuOutside, true);
}
function onMenuOutside(event: MouseEvent): void {
  const target = event.target as Node;
  // A click on the trigger itself is left to its own handler (which toggles the menu shut); closing here too would close-then-reopen and the menu would never toggle off.
  // A click inside the open submenu counts as inside too, so it isn't dismissed before its own handler runs.
  if (
    openMenuEl &&
    !openMenuEl.contains(target) &&
    !openSubmenuEl?.contains(target) &&
    !openMenuAnchor?.contains(target)
  )
    closeMenu();
}

// Render `items` as buttons into `menu`.
// A leaf runs its onSelect and closes everything; a submenu-parent opens its child list on hover (and on click, for non-hover input).
// `isRoot` marks the top menu: only its leaves close an open submenu on hover — a submenu's own leaves must not, or hovering toward them would close the very submenu being reached for.
function fillMenu(menu: HTMLElement, items: MenuItem[], isRoot: boolean): void {
  for (const item of items) {
    if (item.separator) {
      const rule = document.createElement('div');
      rule.className = 'menu-separator';
      menu.append(rule);
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = item.label;
    // A row that names something countable (a group, say): a status dot leads, the label takes the room it needs and ellipsizes, and the count sits in its own column at the right.
    if (item.count !== undefined) {
      button.classList.add('has-count');
      const label = document.createElement('span');
      label.className = 'menu-item-label';
      label.textContent = item.label;
      if (item.muted) label.classList.add('muted');
      const dot = document.createElement('span');
      dot.className = `project-badge${item.badge ? ` ${item.badge}` : ''}`;
      const count = document.createElement('span');
      count.className = 'menu-item-count';
      count.textContent = String(item.count);
      button.textContent = '';
      button.append(dot, label, count);
    }
    if (item.checked !== undefined) {
      // A fixed-width column, empty when unchecked, so every label in the list still lines up.
      const tick = document.createElement('span');
      tick.className = 'menu-tick';
      tick.innerHTML = item.checked ? tickIcon(11) : '';
      button.classList.add('has-tick');
      button.prepend(tick);
    }
    if (item.submenu) {
      button.className = 'has-submenu';
      const chev = document.createElement('span');
      chev.className = 'submenu-chev';
      chev.innerHTML = chevronRight(10);
      button.append(chev);
      const open = () => openSubmenu(button, item.submenu!);
      button.addEventListener('mouseenter', open);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        open();
      });
    } else {
      // Moving onto a sibling root leaf closes any open submenu; submenu leaves keep it open.
      if (isRoot) button.addEventListener('mouseenter', closeSubmenu);
      button.addEventListener('click', () => {
        closeMenu();
        item.onSelect?.();
      });
    }
    menu.append(button);
  }
}

// Open a child list beside its parent item; prefer the right, flip left when it would overflow.
function openSubmenu(item: HTMLElement, items: MenuItem[]): void {
  if (openSubmenuOwner === item) return; // already open for this item; don't rebuild/flicker
  closeSubmenu();
  const menu = document.createElement('div');
  menu.className = 'kebab-menu submenu';
  fillMenu(menu, items, false);
  document.body.append(menu);
  const r = item.getBoundingClientRect();
  const flipped = r.right + menu.offsetWidth + 8 > window.innerWidth;
  menu.classList.add(flipped ? 'attach-left' : 'attach-right');
  const left = flipped ? r.left - menu.offsetWidth - 5 : r.right + 5;
  const top = Math.max(8, Math.min(r.top, window.innerHeight - menu.offsetHeight - 8));
  menu.style.top = `${top}px`;
  menu.style.left = `${Math.max(8, left)}px`;
  // The notch points at the parent item's vertical center, clamped clear of the rounded corners.
  const notchY = Math.max(10, Math.min(r.top + r.height / 2 - top - 4, menu.offsetHeight - 18));
  menu.style.setProperty('--notch-y', `${notchY}px`);
  openSubmenuEl = menu;
  openSubmenuOwner = item;
  item.classList.add('menu-open'); // hold the parent row's active look while its submenu is up
}

function openMenu(anchor: HTMLElement, items: MenuItem[]): void {
  // Clicking the same trigger again toggles the menu shut.
  if (openMenuAnchor === anchor) {
    closeMenu();
    return;
  }
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'kebab-menu attach-top';
  fillMenu(menu, items, true);
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 5}px`;
  const left = Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8));
  menu.style.left = `${left}px`;
  // The notch points at the anchor's horizontal center, clamped clear of the rounded corners.
  const notchX = Math.max(10, Math.min(r.left + r.width / 2 - left - 4, menu.offsetWidth - 18));
  menu.style.setProperty('--notch-x', `${notchX}px`);
  openMenuEl = menu;
  openMenuAnchor = anchor;
  anchor.classList.add('menu-open'); // trigger shows an open/active state while its menu is up
  // Defer so the click that opened it doesn't immediately close it.
  setTimeout(() => document.addEventListener('click', onMenuOutside, true));
}

// Reveal a session's row in the sidebar (expanding its project if collapsed), so clicking a tab scrolls to where it lives and shows which project it belongs to.
function revealSessionInSidebar(session: SessionSummary): void {
  // Its group can be collapsed too, and then the row is hidden even with the project open.
  const groupId = groupState.groupOf[entityKey(session)];
  if (groupId && foldedGroups().delete(groupId)) renderList();
  if (foldedProjects().has(session.repoRoot)) {
    foldedProjects().delete(session.repoRoot);
    renderList();
  }
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
  if (foldedProjects().has(repoRoot)) {
    foldedProjects().delete(repoRoot);
    renderList();
  }
  const els = projectSections.get(repoRoot);
  if (!els) return;
  container.scrollTop += els.section.getBoundingClientRect().top - container.getBoundingClientRect().top;
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
  if (foldedProjects().delete(repoRoot)) renderList();
  if (groupId !== null && foldedGroups().delete(groupId)) renderList();

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

// A brief accent wash on whatever you just jumped to. Short jumps move the list barely at all, so without it there is no way to tell the click did anything.
function flash(el: HTMLElement): void {
  el.classList.remove('flash'); // restart it if you jump to the same place twice
  void el.offsetWidth; // force a reflow so removing and re-adding actually replays the animation
  el.classList.add('flash');
  window.setTimeout(() => el.classList.remove('flash'), 900);
}

// Build a project section once; contents (count, caret, rows) are updated on later renders.
function createProjectSection(name: string, folderCwd?: string): ProjectSectionEls {
  const section = document.createElement('section');
  section.className = 'project';

  const heading = document.createElement('h2');
  const caret = document.createElement('span');
  caret.className = 'caret';
  const icon = document.createElement('span');
  icon.className = 'project-icon';
  icon.innerHTML = FOLDER_ICON;
  const label = document.createElement('span');
  label.className = 'label';
  setTooltip(label, name); // full path on hover
  label.textContent = projName(name);
  const count = document.createElement('span');
  count.className = 'project-count';
  // Jump straight to one of this project's groups instead of scrolling for it.
  // The heading is position:sticky, so this trigger is on screen the whole time you scroll the project — which is what makes a menu enough here, rather than a panel that would cost a line of height per project.
  // reconcileProjectSections hides it below 2 targets and disables it while filtering.
  const groupsBtn = document.createElement('button');
  groupsBtn.className = 'project-groups';
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
  if (folderCwd) {
    // Split button: the "+" is one-click "New session"; the caret opens a dropdown with worktree options. reconcileProjectSections shows the caret only for git repos.
    const split = document.createElement('div');
    split.className = 'split-button';
    const add = document.createElement('button');
    add.className = 'project-add';
    add.innerHTML = plusIcon(12);
    setTooltip(add, 'New session in this project');
    add.addEventListener('click', (event) => {
      event.stopPropagation();
      void openNewSession(folderCwd);
    });
    const caret = document.createElement('button');
    caret.className = 'project-add-caret';
    caret.innerHTML = chevronDown(9);
    caret.hidden = true;
    setTooltip(caret, 'New session options');
    caret.addEventListener('click', (event) => {
      event.stopPropagation();
      openMenu(caret, [
        { label: 'New session', onSelect: () => void openNewSession(folderCwd) },
        { label: 'New worktree session…', onSelect: () => void openWorktreeSession(folderCwd) },
      ]);
    });
    split.append(add, caret);
    heading.append(split);
    addCaret = caret;
  }
  // Project options (rename now, hide later); stopPropagation so it doesn't toggle collapse.
  const kebab = document.createElement('button');
  kebab.className = 'project-kebab';
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
    ]);
  });
  heading.append(kebab);
  // Toggle in place (CSS hides the rows) so the sidebar doesn't rebuild and flicker.
  // Keep the clicked heading anchored: a sticky heading otherwise snaps between stuck and natural position as its rows appear/disappear, which reads as a jump.
  heading.addEventListener('click', () => {
    // Not collapsible in a single-project view: hiding the one project you're looking at leaves an empty sidebar. The heading is a title there, and updateProjectSection drops its caret to say so.
    if (activeProject !== null) return;
    const before = heading.getBoundingClientRect().top;
    const collapsed = !foldedProjects().has(name);
    if (collapsed) foldedProjects().add(name);
    else foldedProjects().delete(name);
    section.classList.toggle('collapsed', collapsed);
    caret.innerHTML = caretIcon(collapsed, 10);
    container.scrollTop += heading.getBoundingClientRect().top - before;
    // This toggle deliberately skips renderList (no flicker, no scroll jump), so the header button has to be refreshed by hand — otherwise it still reads "Expand all" after one project reopens.
    updateCollapseToggle();
    // And so does the store, for the same reason: skipping the render skips the one call that would otherwise have saved this.
    persistUi();
  });
  section.appendChild(heading);

  return { section, heading, caret, count, label, groupsBtn, addCaret };
}

// Build a group's sub-section once: a heading (lighter than the project's — no divider, not sticky) over an indented well that holds its rows. Contents are updated on later renders.
function createGroupSection(id: string): GroupSectionEls {
  const section = document.createElement('section');
  section.className = 'group';

  const heading = document.createElement('h3');
  const caret = document.createElement('span');
  caret.className = 'caret';
  const icon = document.createElement('span');
  icon.className = 'group-icon';
  icon.innerHTML = layersIcon(13);
  const label = document.createElement('span');
  label.className = 'label';
  const count = document.createElement('span');
  count.className = 'group-count';
  // Start a session already in this group — the group's answer to the project heading's split button, and the same two parts: "+" starts one straight away, the caret offers the worktree variant.
  // reconcileProjectSections shows the caret only when the project is a git repo.
  const split = document.createElement('div');
  split.className = 'split-button';
  const add = document.createElement('button');
  add.className = 'group-add';
  add.innerHTML = plusIcon(14);
  setTooltip(add, 'New session in this group');
  add.addEventListener('click', (event) => {
    event.stopPropagation();
    const group = groupState.groups.find((g) => g.id === id);
    if (group?.repoRoot) void openNewSession(group.repoRoot, id);
  });
  const addCaret = document.createElement('button');
  addCaret.className = 'group-add-caret';
  addCaret.innerHTML = chevronDown(9);
  addCaret.hidden = true;
  setTooltip(addCaret, 'New session options');
  addCaret.addEventListener('click', (event) => {
    event.stopPropagation();
    const repoRoot = groupState.groups.find((g) => g.id === id)?.repoRoot;
    if (!repoRoot) return;
    openMenu(addCaret, [
      { label: 'New session', onSelect: () => void openNewSession(repoRoot, id) },
      { label: 'New worktree session…', onSelect: () => void openWorktreeSession(repoRoot, id) },
    ]);
  });
  split.append(add, addCaret);
  // Group options, same shape as the project heading's kebab; stopPropagation so it doesn't collapse.
  const kebab = document.createElement('button');
  kebab.className = 'group-kebab';
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
    const collapsed = !foldedGroups().has(id);
    if (collapsed) foldedGroups().add(id);
    else foldedGroups().delete(id);
    section.classList.toggle('collapsed', collapsed);
    caret.innerHTML = caretIcon(collapsed, 10);
    // Same as the project heading above: no render here, so nothing else would store the fold.
    persistUi();
  });

  // The rows live in their own element so the indent and its rail wrap the whole group, which is what shows where a group ends without needing to read the next heading.
  const members = document.createElement('div');
  members.className = 'group-members';
  const empty = document.createElement('div');
  empty.className = 'group-empty';
  // Names the control the way its own tooltip does ("Session options") rather than drawing a ⋮ in text: the glyphs this used to lean on are all SVG now, and a lone one here rendered in whatever the UI font offered.
  empty.textContent = "Empty — move a session here from any session's options.";
  members.append(empty);

  section.append(heading, members);
  return { section, heading, caret, label, count, addCaret, members, empty };
}

function getOrCreateRow(key: string): HTMLElement {
  const existing = sessionRows.get(key);
  if (existing) return existing;
  const row = createSessionRow(key);
  sessionRows.set(key, row);
  return row;
}

// The family/worktree marks.
// Both used to be font glyphs, and not even from the same font: ⑂ (U+2442) is absent from DejaVu Sans and resolved from FreeMono, a MONOSPACE face, while ⎇ (U+2387) came from DejaVu — which is why they never matched weight and needed hand-tuned font-size corrections.
// Conventional icons instead: a fork (one session split into a family) and a branch off a trunk (a linked worktree).
// Asymmetric vs symmetric, so they stay apart at badge size.
// Both are drawn so their INK is centred on 8,8 and 10 units tall, not merely their viewBox: the first cut centred the boxes while the fork hung 1.25 low and the branch filled 7.5 units against the fork's 11, which read as one mark misaligned and the other too small.
// A note's mark: a page with a line of writing on it.
const NOTE_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2.5h8v11H4z" /><path d="M6.25 6h3.5M6.25 8.75h3.5" /></svg>';
const SIBLING_ICON =
  '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 12V8M4 4L8 8L12 4" /></svg>';
const WORKTREE_ICON =
  '<svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12V4M4.5 8Q11.5 8 11.5 4" /></svg>';

// The pin, as SVG rather than the ★/☆ glyphs: those resolve through system font fallback (DejaVu Sans under WSLg), whose outline star is a hairline that reads far fainter than its --muted colour should.
// Same star either way — filled for pinned, outlined for not — so the two states differ by ink, not by colour, and both render at a weight we control instead of the font's.
const STAR_PATH =
  'M8 2.1 L9.41 6.06 L13.61 6.18 L10.28 8.74 L11.47 12.77 L8 10.4 L4.53 12.77 L5.72 8.74 L2.39 6.18 L6.59 6.06 Z';
const PIN_ICON =
  `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.49" stroke-linejoin="round"><path d="${STAR_PATH}" /></svg>`;
const PINNED_ICON =
  `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" stroke="currentColor" stroke-width="1.49" stroke-linejoin="round"><path d="${STAR_PATH}" /></svg>`;

// The open filter's mark: a window with a title bar — "this one has a tab". Deliberately a SHAPE where running is a DOT, so the pair reads as two different questions rather than two intensities.
const OPEN_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1.4" /><path d="M2.6 6.4h10.8" /></svg>';

// The running filter's mark: a filled dot inside a ring — the same "live" language the status dots speak, rather than a play triangle, which would read as "start these".
const RUNNING_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2.2" fill="currentColor" stroke="none" /></svg>';

// The archived filter's mark: a lidded box. Ink spans the full 16-unit box horizontally and 3..13 vertically, centred on (8,8) like the rest, so it sits square beside the star and the branch.
const ARCHIVE_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.2h11v3h-11z" /><path d="M3.6 6.2v6.6h8.8V6.2" /><path d="M6.4 9h3.2" /></svg>';

// Take it back out of the box. Archiving has no row icon — it is a kebab item (text) in the normal view; only unarchiving, the archived view's primary action, stays a button on the row.
const UNARCHIVE_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.23" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>';

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
  dot.addEventListener('click', (event) => {
    event.stopPropagation();
    const session = currentByKey.get(key);
    if (session) toggleAck(session.id);
  });
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
  pin.className = 'pin';
  pin.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (pin.disabled) return;
    // Disabling it is the pending cue: .pin:disabled dims. (There was a 'loading' class here with no CSS behind it, so it painted nothing.)
    pin.disabled = true;
    pinned = new Set(await window.claudeUi.togglePin(key));
    renderList();
  });

  // Unarchive lives on the row because it is what the archived view is for; archiving a live session is a kebab item instead (shown/hidden in updateRow), so a normal row carries only pin + kebab.
  const unarchiveBtn = document.createElement('button');
  unarchiveBtn.className = 'unarchive-btn';
  unarchiveBtn.hidden = true;
  unarchiveBtn.innerHTML = UNARCHIVE_ICON;
  setTooltip(unarchiveBtn, 'Unarchive');
  unarchiveBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    void toggleArchiveFor(key);
  });

  // Delete lives only in the archived view (shown/hidden in updateRow); trash-based + confirmed.
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  setTooltip(deleteBtn, 'Delete session');
  deleteBtn.hidden = true;
  deleteBtn.innerHTML =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10" /><path d="M6.5 4.5V3h3v1.5" /><path d="M4.8 4.5l.5 8h5.4l.5-8" /></svg>';
  deleteBtn.addEventListener('click', async (event) => {
    event.stopPropagation();
    const session = currentByKey.get(key);
    const title = session ? sessionLabel(session) : key.slice(0, 8);
    if (!(await confirmDelete(title))) return;
    // Hide it right away so deletion feels instant; trashing files (slow under WSL) and the meta purge run in the background.
    // It stays hidden via pendingDeletes until its files are gone from disk (see renderSessions), so a concurrent delete's re-read can't resurrect it.
    // Only this entity's file goes (entity key = session id); siblings are separate entities.
    pendingDeletes.add(key);
    renderList();
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
      pendingDeletes.delete(key);
      await renderSessions(false);
    }
  });

  // Per-session actions menu: fork this session, and (for a family member) list its siblings.
  const kebab = document.createElement('button');
  kebab.className = 'session-kebab';
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
    if (showArchivedOnly) return;
    const session = currentByKey.get(key);
    if (session) void openSession(session);
  });
  return item;
}

// Refresh a reused row's content for the tip it now shows.
function updateRow(row: HTMLElement, session: SessionSummary): void {
  row.dataset.sid = session.id;
  const els = rowEls.get(row)!;

  applyStatus(els.dot, statuses.get(session.id), acked.has(session.id));
  statusDots.set(session.id, els.dot);

  els.title.textContent = sessionLabel(session, '(no prompt yet)');
  setTooltip(els.title, sessionLabel(session, '') || null);

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

  const note = notes.get(entityKey(session));
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

  if (showArchivedOnly) {
    const ts = archived.get(entityKey(session));
    els.metaText.textContent = ts ? `archived ${relativeTime(new Date(ts).toISOString())}` : 'archived';
  } else {
    const model = modelLabel(session.model);
    const when = relativeTime(session.lastActivity);
    els.metaText.textContent = model ? `${when} · ${model}` : when;
  }

  // The archived view is a management view: no pinning, and delete replaces it there.
  const isPinned = pinned.has(entityKey(session));
  els.pin.innerHTML = isPinned ? PINNED_ICON : PIN_ICON;
  setTooltip(els.pin, isPinned ? 'Unpin' : 'Pin');
  els.pin.disabled = false;
  els.pin.hidden = showArchivedOnly;

  // Unarchive and delete are the archived view's two actions and appear nowhere else.
  els.unarchiveBtn.hidden = !showArchivedOnly;
  els.deleteBtn.hidden = !showArchivedOnly;
  // The kebab (fork, groups, archive) is a normal-view affordance; the archived view is manage-only.
  els.kebab.hidden = showArchivedOnly;
}

function applyStatus(dot: HTMLElement, status: string | undefined, isAcked = false): void {
  dot.className = status ? `status-dot ${status}${isAcked ? ' acked' : ''}` : 'status-dot';
  setTooltip(dot, status ? (isAcked ? `${status} (read)` : status) : null);
}

// --- Tabs ---

async function openSession(session: SessionSummary): Promise<void> {
  const existing = tabs.find((t) => t.session.id === session.id);
  if (existing) {
    activateTab(existing);
    return;
  }
  await createTab(session, session.id);
}

let newSessionCounter = 0;

// Placeholder for a session whose transcript hasn't been written yet (a new/fork/worktree tab): a minted id plus the SessionSummary defaults; callers override what they already know.
// One factory, so a SessionSummary field change lands here once instead of in three literals.
/** True for an id minted by placeholderSession: no transcript exists under it, so it can't be resumed. */
function isPlaceholderId(id: string): boolean {
  return id.startsWith('new-');
}

function placeholderSession(over: Partial<SessionSummary> & Pick<SessionSummary, 'cwd' | 'repoRoot' | 'title'>): SessionSummary {
  const id = `new-${Date.now()}-${newSessionCounter++}`;
  return {
    id,
    conversationId: id,
    isRepo: false,
    worktree: '',
    firstMessage: '',
    model: '',
    lastActivity: new Date().toISOString(),
    isSibling: false,
    siblingIds: [],
    postCompactHeads: [],
    ...over,
  };
}

// Land where a new tab will be visible: stay in its own project, else drop the scope to All.
function ensureProjectVisible(repoRoot: string): void {
  if (activeProject !== null && repoRoot !== activeProject) {
    activeProject = null;
    window.claudeUi.setActiveProject(null);
  }
}

// Start a brand-new claude session in `cwd`. It has no real id until claude creates it, so the tab uses a placeholder; the real session appears in the sidebar on the next refresh.
async function openNewSession(cwd: string, joinGroupId?: string): Promise<void> {
  const folder = cwd.split('/').filter(Boolean).pop() ?? cwd;
  const session = placeholderSession({ cwd, repoRoot: cwd, title: `New: ${folder}` });
  // Show it in its group from the first paint; the real membership is written once it has an id.
  if (joinGroupId) pendingGroupOf.set(session.id, joinGroupId);
  ensureProjectVisible(session.repoRoot);
  await createTab(session, undefined, false, undefined, undefined, joinGroupId);
  renderList();
}

// Start a new session in a fresh git worktree of `repoRoot`: `claude -w [name]`.
// Prompts for an optional name (blank -> claude auto-names).
// Like openNewSession, the tab starts on a placeholder and adopts the real id via its token; the worktree session appears (badged) on the next refresh.
async function openWorktreeSession(repoRoot: string, joinGroupId?: string): Promise<void> {
  const folder = repoRoot.split('/').filter(Boolean).pop() ?? repoRoot;
  // claude's `-w` name must be a slug (letters/digits/dots/underscores/dashes); turn the free-text label into one. A blank slug means auto-name, which can't collide.
  const slugify = (value: string): string => value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const label = await promptText(
    'New worktree session',
    `Worktree of "${projName(repoRoot)}"`,
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
  const session = placeholderSession({
    cwd: repoRoot,
    repoRoot,
    isRepo: true,
    // Show the worktree badge right away (optimistic); it reconciles to the real name on refresh.
    worktree: slug || 'new worktree',
    // The name you typed becomes the title (it's also what --name sets); the badge already says it's a worktree, so no prefix. Blank name falls back to a plain new-session label.
    title: friendly || `New: ${folder}`,
  });
  // Same as openNewSession: show it in its group from the first paint, before the real id exists.
  if (joinGroupId) pendingGroupOf.set(session.id, joinGroupId);
  ensureProjectVisible(session.repoRoot);
  await createTab(session, undefined, false, friendly || undefined, slug, joinGroupId);
  renderList();
}

// Fork an existing session: `claude --resume <id> --fork-session` copies its transcript into a new session in the same cwd.
// Like openNewSession, the tab starts on a placeholder and adopts the real fork id via its token; the fork then appears in the sidebar (as a sibling) on the next disk refresh.
async function forkSession(parent: SessionSummary): Promise<void> {
  const parentTitle = sessionLabel(parent, 'session');
  // Forks copy the parent's title, so offer a fresh name up front (via claude's --name). Cancel aborts the fork; keeping/clearing the field just inherits the parent title.
  const name = await promptText('Create fork', `Fork from "${parentTitle}"`, parentTitle, 'Fork');
  if (name === null) return;
  const trimmed = name.trim();
  const session = placeholderSession({
    cwd: parent.cwd,
    repoRoot: parent.repoRoot,
    isRepo: parent.isRepo,
    worktree: parent.worktree,
    title: trimmed || parentTitle,
    // Mark the placeholder as a family member right away (we know its parent is a sibling), so the row shows the sibling mark immediately instead of waiting for claude to write the transcript.
    // It reconciles to the real row once that file lands and grouping runs on the next refresh.
    isSibling: true,
    siblingIds: [parent.id],
  });
  ensureProjectVisible(session.repoRoot);
  // A fork continues its parent's work, so it belongs wherever the parent was filed — and it shows there immediately, like a new session started from the group's "+".
  const parentGroup = groupState.groupOf[entityKey(parent)];
  if (parentGroup) pendingGroupOf.set(session.id, parentGroup);
  await createTab(session, parent.id, true, trimmed || undefined, undefined, parentGroup);
  renderList();
}

/**
 * Build a tab WITHOUT a process: real DOM, a real Terminal, no claude.
 * `terminalId` stays null until startTab fills it in, which is what lets tabs be restored cold — 20 restored tabs used to mean 20 `claude --resume` processes at ~437 MB each, spawned whether or not you looked at any of them.
 * The xterm instance stays eager on purpose: an empty one costs almost nothing next to a process, and keeping it non-null confines this to the handful of places that use terminalId.
 */
function buildTab(session: SessionSummary, needsTitle: boolean, joinGroupId?: string): Tab {
  const token = crypto.randomUUID();

  const el = document.createElement('div');
  el.className = 'term';
  terminalsEl.appendChild(el);

  const term = new Terminal({
    fontFamily: 'monospace',
    fontSize: 13,
    // Neutral (hue-less) default foreground: claude's selected-item accent is a periwinkle, so a neutral grey fg makes it pop by HUE (the old lavender-white #cdd6f4 shared its hue and merged).
    // The fix was the hue, not the brightness, so it can be a light near-white for comfortable reading.
    // The select-menu contrast bug (28a); proper per-user terminal colours are item 28.
    theme: { background: '#11111b', foreground: '#d8d8d8' },
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(el);

  // Canvas renderer for smoother scrolling/paste than the default DOM renderer; fall back to DOM if it can't initialize (e.g. a WSLg GPU quirk) so the terminal always works.
  try {
    term.loadAddon(new CanvasAddon());
  } catch {
    // DOM renderer stays in place.
  }

  // Make http(s) URLs clickable; open them in the OS browser via the main process.
  term.loadAddon(new WebLinksAddon((_event, uri) => window.claudeUi.openExternal(uri)));

  // Ctrl+Enter and Shift+Enter insert a newline (send \n, which claude reads as a newline) rather than submitting — matching the terminal (Ctrl+Enter) and Claude Desktop (Shift+Enter) habits.
  // Plain Enter still submits; Ctrl+J and Alt+Enter already produce \n on their own.
  term.attachCustomKeyEventHandler((event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.shiftKey)) {
      // Send the newline once (on keydown), and swallow BOTH keydown and keypress so xterm never turns the accompanying keypress into a submit \r.
      // Shift+Enter emits that keypress (Ctrl+ Enter does not), which is why only Shift+Enter was flaky.
      // tab.terminalId, not a captured value: it is null while these handlers are wired and only filled in when the tab is actually started.
      if (event.type === 'keydown' && tab.terminalId !== null) {
        window.claudeUi.sendTerminalInput(tab.terminalId, '\n');
      }
      return false;
    }
    return true;
  });

  const tab: Tab = {
    session,
    terminalId: null,
    term,
    fitAddon,
    el,
    token,
    needsTitle,
    joinGroupId,
    startedAt: 0,
    activatedSeq: 0,
  };

  // Ctrl-C twice in the terminal closes the tab instead of dropping to the leftover shell.
  let lastCtrlC = 0;
  term.onData((data) => {
    // Swallow Ctrl+Z: claude binds it to self-suspend, which strands the tab (no shell prompt to `fg` back from).
    // You background a session by switching tabs, so suspend has no use here. claude advertises the key, so a silent no-op is confusing — say why.
    if (data === '\x1a') {
      showToast('Ctrl+Z is off here — switch tabs to keep a session running in the background.');
      return;
    }
    if (data === '\x03') {
      const now = Date.now();
      if (now - lastCtrlC < 600) {
        closeTab(tab);
        return;
      }
      lastCtrlC = now;
    }
    if (tab.terminalId !== null) window.claudeUi.sendTerminalInput(tab.terminalId, data);
  });

  tabs.push(tab);
  return tab;
}

/**
 * Give a built tab a process.
 * Separate from buildTab so a tab can exist cold: restored tabs start this way and only spawn when you activate one.
 * Returns early if it is already running, so activating a live tab is free.
 */
async function startTab(
  tab: Tab,
  resumeId: string | undefined,
  fork = false,
  name?: string,
  worktree?: string,
): Promise<void> {
  if (tab.terminalId !== null || tab.starting) return;
  tab.starting = true;
  try {
    tab.startedAt = Date.now();
    // Every way a session begins — new, fork, worktree, resuming a cold tab — funnels through here, so the starting state belongs here rather than at any one call site.
    tab.booting = true;
    // Before the await, not after: otherwise a cold tab keeps saying "click its tab to resume it" across the spawn round-trip, which is the one thing you have just done.
    if (tab === activeTab) updatePlaceholder();
    renderTabBar(); // and for the same reason: the button has to show the pause while the process is on its way, not once it has arrived.
    tab.terminalId = await window.claudeUi.startTerminal(tab.session.cwd, resumeId, tab.token, fork, name, worktree);
    // Gone while it was still starting: the tab has been removed but the pty has not, so hand it straight back rather than leaving a claude running with nothing pointing at it.
    // The button is disabled throughout the wait, so this is not that route — it is deleting the session, which closes its tab wherever that tab had got to.
    // It has to be the first thing after the await, since everything below touches a terminal that removeTab has already disposed.
    if (!tabs.includes(tab)) {
      window.claudeUi.closeTerminal(tab.terminalId);
      tab.terminalId = null;
      return;
    }
    // Reveal it BEFORE fitting: `.term` is display:none until `.active`, and FitAddon sizes from the element's own box, so fitting a hidden pane leaves the terminal at xterm's 80x24 default and claude draws its whole TUI at that width.
    // Cold tabs are what exposed this — the pane used to be revealed by activateTab before any of this ran, and now it only reveals a tab that HAS a process.
    // A tab you switched away from during the await stays hidden and mis-fitted, which activateTab's own fit corrects when you come back to it.
    if (activeTab === tab) {
      tab.el.classList.add('active');
      tab.term.focus();
    }
    // The pty is created at a default size; hand it the real one now that the pane has a real one.
    tab.fitAddon.fit();
    window.claudeUi.resizeTerminal(tab.terminalId, tab.term.cols, tab.term.rows);
    renderTabBar();
    updatePlaceholder();
    updateSidebarHighlight(); // its row's bar goes from muted to accent now that it is live
  } finally {
    tab.starting = false;
    // A start that ends without reaching the render above — a throw, or the early return below — must still hand the button back.
    if (tabs.includes(tab)) renderTabBar();
  }
}

async function createTab(session: SessionSummary, resumeId: string | undefined, fork = false, name?: string, worktree?: string, joinGroupId?: string): Promise<void> {
  // A fork mints a NEW session id despite resuming one, so it also needs to adopt its real id via the token (like a fresh session) — a plain resume already carries its final id.
  const tab = buildTab(session, resumeId === undefined || fork, joinGroupId);
  // Select it WITHOUT starting: this call knows the real arguments (fork, --name, -w) and starts the tab itself below.
  // Letting activateTab start it instead launched every new session as `claude --resume new-<ts>-<n>` — it can only guess `tab.session.id`, which for a new, forked or worktree tab is the placeholder — and its `starting` flag then made the real start a no-op.
  activateTab(tab, false);
  persistOpenTabs();
  await startTab(tab, resumeId, fork, name, worktree);
}

/**
 * `start` is false for the two callers that must not spawn here: a RESTORE, which shows you the tab you left off in without starting it (nothing is meant to be live after a restart), and createTab, which starts the tab itself because only it knows the real arguments.
 * Every other selection — a click in the tab bar or the sidebar — starts the tab, and can only resume it.
 */
function activateTab(tab: Tab, start = true): void {
  // Viewing a tab no longer clears its nudge: a waiting dot persists until you actually reply (submitting fires UserPromptSubmit -> busy) or you mark it read by clicking the dot.
  tab.activatedSeq = ++activationSeq;
  activeTab = tab;
  // A cold tab's (empty) terminal stays hidden, so the placeholder can explain itself instead of showing a blank black pane.
  for (const other of tabs) other.el.classList.toggle('active', other === tab && other.terminalId !== null);
  renderTabBar();
  updatePlaceholder();
  updateSidebarHighlight();
  tab.fitAddon.fit();
  // A cold tab starts the moment you select it — selecting IS starting, with no separate affordance, because that is how activating a tab has always behaved and laziness should show up only as a wait.
  // Fire-and-forget: activateTab is called from click handlers and stays synchronous.
  if (tab.terminalId === null) {
    // A tab still on its placeholder id has no transcript to resume (it can reach here by being stopped before claude reported its real id), so start it fresh rather than resuming nothing.
    if (start) void startTab(tab, isPlaceholderId(tab.session.id) ? undefined : tab.session.id);
  } else window.claudeUi.resizeTerminal(tab.terminalId, tab.term.cols, tab.term.rows);
  tab.term.focus();
  // Remembered twice: overall (where to reopen at launch) and for this project (where to return to when you switch back to it).
  lastActiveKey = entityKey(tab.session);
  activeByProject[tab.session.repoRoot] = lastActiveKey;
  window.claudeUi.setActiveSession(lastActiveKey, tab.session.repoRoot);
}

// Full workspace switch: bring the active terminal in line with the current scope (a project, or All).
// Keeps the current tab if it's in scope; otherwise activates the scope's most-recent tab, or clears the terminal if the scope has no open tabs.
// Always re-renders the (filtered) tab bar.
function switchWorkspaceTerminal(repoRoot: string | null): void {
  const scoped = repoRoot ? tabs.filter((t) => t.session.repoRoot === repoRoot) : tabs;
  if (!(activeTab && scoped.includes(activeTab))) {
    // Prefer a tab that is already RUNNING here; failing that, SELECT the one you were last in for this project, cold.
    // Selecting a cold tab is harmless — it is STARTING one that a workspace switch must never do, or browsing projects in the switcher would spawn a session per project you glanced at.
    // Hence activateTab(..., false) either way: it only suppresses the start, which a running tab does not need anyway.
    const running = scoped.filter((t) => t.terminalId !== null);
    const rememberedKey = repoRoot ? activeByProject[repoRoot] : lastActiveKey;
    const target = running.length
      ? running.reduce((best, t) => (t.activatedSeq > best.activatedSeq ? t : best))
      : (scoped.find((t) => entityKey(t.session) === rememberedKey) ?? null);
    if (target) {
      activateTab(target, false);
      return;
    }
    activeTab = null;
    for (const t of tabs) t.el.classList.remove('active');
  }
  renderTabBar();
  updatePlaceholder();
  updateSidebarHighlight();
}

// Drop a tab from the UI. Idempotent (a user close and the terminal's own exit can both fire). It does not touch the terminal process; callers terminate it when they need to.
function removeTab(tab: Tab): void {
  const index = tabs.indexOf(tab);
  if (index === -1) return;
  pendingGroupOf.delete(tab.session.id); // a session that never started leaves no optimistic entry
  clearNudge(tab.session.id);
  tab.term.dispose();
  tab.el.remove();
  tabs.splice(index, 1);
  if (activeTab === tab) activeTab = null;
  // Re-establish the active tab within the current workspace scope (or clear); this re-renders too.
  switchWorkspaceTerminal(activeProject);
  persistOpenTabs();
}

// User-initiated close: terminate the session (claude persists per turn, so its context is on disk) and drop the tab. closeTerminal sends Ctrl-C twice to exit claude cleanly, then kills it.
/**
 * End the session but keep its tab, cold and resumable.
 * The opposite of closeTab, and the deliberate counterpart to claude exiting on its own — which still CLOSES the tab, so a finished session does not leave an empty one behind.
 * `stopping` is what tells those two apart when the exit arrives.
 */
function stopSession(tab: Tab): void {
  if (tab.terminalId === null) return;
  tab.stopping = true;
  // At once, so the button shows the pause for as long as the exit takes rather than after it.
  renderTabBar();
  window.claudeUi.closeTerminal(tab.terminalId); // Ctrl-C twice, then kill
}

/** Turn a tab that has just lost its process into a cold one. */
function coolTab(tab: Tab): void {
  tab.terminalId = null;
  tab.stopping = false;
  // A stopped tab is not a slow one: the loader must not outlive the process.
  tab.booting = false;
  // Wipe the dead session's output: left in place it reads as a live terminal, and a resume would paint the new session over the old one's tail.
  tab.term.reset();
  tab.el.classList.remove('active');
  // Stopping what you were looking at drops you to the empty screen rather than leaving a selected tab with nothing behind it.
  if (activeTab === tab) activeTab = null;
  renderTabBar();
  updatePlaceholder();
  updateSidebarHighlight();
}

/**
 * The tab button's two steps: end the session first, remove the tab second.
 *
 * A running session and a tab are separate things — a cold tab costs nothing but a line in the bar, and it is restored on the next launch — so one press should not decide both.
 * The first press stops (claude gets its normal exit path and flushes), the tab stays and goes cold; the second removes it. A tab that is already cold goes in one press, since there is nothing live to protect.
 * While a session is arriving or leaving the button does nothing at all: see the disabled state in tabElement. Checked here too, since a middle click reaches this without going through the button.
 */
function closeOrStop(tab: Tab): void {
  if (tab.stopping || tab.starting) return;
  if (tab.terminalId !== null) {
    stopSession(tab);
    return;
  }
  closeTab(tab);
}

function closeTab(tab: Tab): void {
  if (tab.terminalId !== null) window.claudeUi.closeTerminal(tab.terminalId); // nothing to kill when cold
  removeTab(tab);
}

// The key a tab is grouped and dragged within: its project, plus its group when it has one. A drag stays inside its own cluster because each cluster is its own Sortable container.
function tabClusterKey(tab: Tab, groupOf: Record<string, string> = effectiveGroupState().groupOf): string {
  return `${tab.session.repoRoot}\0${groupOf[tab.session.id] ?? ''}`;
}

// One row per cluster: a project's ungrouped tabs share the project's own row, and each of its groups gets an indented row beneath it behind the same rail the sidebar uses.
// A project view drops the project label (everything shown belongs to it) but keeps the group rows.
/** The tabs actually on screen: a project view shows only its own. */
function visibleTabs(): Tab[] {
  return activeProject ? tabs.filter((t) => t.session.repoRoot === activeProject) : tabs;
}

function renderTabBar(): void {
  const shown = visibleTabs();
  const groupOf = effectiveGroupState().groupOf; // computed once; every tab is keyed against it
  const byCluster = new Map<string, Tab[]>();
  const projectOrder: string[] = [];
  for (const tab of shown) {
    const root = tab.session.repoRoot;
    if (!projectOrder.includes(root)) projectOrder.push(root);
    const key = tabClusterKey(tab, groupOf);
    const list = byCluster.get(key) ?? [];
    list.push(tab);
    byCluster.set(key, list);
  }

  const children: HTMLElement[] = [];
  for (const root of projectOrder) {
    // The project's own row: its label (in All) and every tab of its that is in no group.
    const loose = byCluster.get(`${root}\0`) ?? [];
    if (!activeProject || loose.length > 0) {
      const row = document.createElement('div');
      row.className = 'tab-project';
      row.dataset.cluster = `${root}\0`;
      if (!activeProject) {
        const label = document.createElement('span');
        label.className = 'tab-project-label';
        label.textContent = projName(root);
        setTooltip(label, root);
        label.addEventListener('click', () => revealProjectInSidebar(root));
        row.append(label);
      }
      row.append(...loose.map(tabElement));
      children.push(row);
    }
    // Then one row per group that has tabs open, in registry order — the sidebar's order.
    for (const group of projectGroups(root)) {
      const groupTabs = byCluster.get(`${root}\0${group.id}`) ?? [];
      if (groupTabs.length === 0) continue;
      const row = document.createElement('div');
      row.className = 'tab-project tab-group-row';
      row.dataset.cluster = `${root}\0${group.id}`;
      const rail = document.createElement('span');
      rail.className = 'tab-rail';
      const label = document.createElement('span');
      label.className = 'tab-group-label';
      const icon = document.createElement('span');
      icon.className = 'group-icon';
      icon.innerHTML = layersIcon(11);
      label.append(icon, document.createTextNode(group.name));
      row.append(rail, label, ...groupTabs.map(tabElement));
      children.push(row);
    }
  }
  tabbar.replaceChildren(...children);
  initTabSortables();
}

function tabElement(tab: Tab): HTMLElement {
  const el = document.createElement('div');
  // 'cold' = restored but never started. Dimmed rather than marked: it is a session waiting to be resumed, not a broken one, and clicking it is exactly what starts it.
  el.className = [
    'tab',
    tab === activeTab ? 'active' : '',
    tab.terminalId === null ? 'cold' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const dot = document.createElement('span');
  applyStatus(dot, statuses.get(tab.session.id), acked.has(tab.session.id));
  // Toggle "read" from the tab too; stopPropagation so it doesn't also switch tabs.
  dot.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleAck(tab.session.id);
  });

  // Siblings often share a title, so mark the tab too — keyed on isSibling, the same signal as the sidebar row's badge, so tab and row always agree.
  const siblingMark = document.createElement('span');
  siblingMark.className = 'tab-sibling';
  siblingMark.innerHTML = SIBLING_ICON;
  if (tab.session.isSibling) {
    const count = tab.session.siblingIds.length;
    setTooltip(siblingMark, `Has ${count} ${count === 1 ? 'sibling' : 'siblings'} in its session family`);
  }

  // A worktree session's tab gets the same branch marker as its sidebar badge.
  const worktreeMark = document.createElement('span');
  worktreeMark.className = 'tab-worktree';
  worktreeMark.innerHTML = WORKTREE_ICON;
  if (tab.session.worktree) setTooltip(worktreeMark, `Linked git worktree: ${tab.session.worktree}`);

  const label = document.createElement('span');
  label.className = 'tab-label';
  const text = sessionLabel(tab.session);
  label.textContent = text;
  setTooltip(label, `${projName(tab.session.repoRoot)} · ${text}`);

  // Two presses, and which one this is shows in the mark: stop a running session, then close the tab it leaves behind. See closeOrStop.
  const close = document.createElement('button');
  close.className = 'tab-close';
  if (tab.stopping || tab.starting) {
    // Both ends of a session's life are a pause, for the same reason: neither a tab whose process has not arrived yet nor one whose process is still leaving can be acted on without the bar disagreeing with what is actually running.
    close.disabled = true;
    close.innerHTML = stopIcon(14);
    setTooltip(close, tab.starting ? 'Starting…' : 'Stopping…');
  } else if (tab.terminalId !== null) {
    close.innerHTML = stopIcon(14);
    setTooltip(close, 'Stop session');
  } else {
    close.innerHTML = closeIcon(14);
    setTooltip(close, 'Close tab');
  }
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    closeOrStop(tab);
  });

  el.dataset.sid = tab.session.id; // used by the Sortable onEnd to find the moved tab
  const marks = [...(tab.session.isSibling ? [siblingMark] : []), ...(tab.session.worktree ? [worktreeMark] : [])];
  // The marks ride in their own tight cluster rather than sitting at the tab's full gap, so the leading glyphs read as one group.
  // Only added when there ARE marks — an empty wrapper would still consume a gap and shift the label.
  if (marks.length > 0) {
    const markGroup = document.createElement('span');
    markGroup.className = 'tab-marks';
    markGroup.append(...marks);
    el.append(dot, markGroup, label, close);
  } else {
    el.append(dot, label, close);
  }
  el.addEventListener('click', () => {
    activateTab(tab);
    revealSessionInSidebar(tab.session);
  });
  el.addEventListener('mousedown', (event) => {
    if (event.button === 1) {
      event.preventDefault();
      // The same two steps as the button: a middle click that killed a running session outright would be the one way left to lose one by accident.
      closeOrStop(tab);
    }
  });
  return el;
}

// Drag-to-reorder tabs via SortableJS.
// One Sortable per project container (the whole tab bar in a cluster row: a project's ungrouped tabs, or one of its groups), so a drag stays inside its own cluster by construction — a tab can't be dragged into another group or project.
// forceFallback uses pointer-based dragging instead of native HTML5 DnD (flaky under WSLg).
// Re-created on every renderTabBar since it rebuilds the DOM; old instances destroyed first to avoid leaks.
let tabSortables: Sortable[] = [];
let tabDragActive = false;

function initTabSortables(): void {
  for (const s of tabSortables) s.destroy();
  const containers = [...tabbar.querySelectorAll<HTMLElement>('.tab-project')];
  tabSortables = containers.map((container) =>
    Sortable.create(container, {
      draggable: '.tab', // never the project label
      // The close button is not a drag handle.
      // Without this, a mousedown on it starts a potential drag, and `forceFallback` then calls preventDefault to take over pointer handling — after which Chromium on macOS never synthesises the click, so closing a tab silently did nothing there.
      // It survived on Linux, which is why this only appeared once the app reached a Mac.
      // preventOnFilter: false is the half that matters: the default (true) still preventDefaults on the filtered element, which is the very thing that swallows the click.
      filter: '.tab-close',
      preventOnFilter: false,
      forceFallback: true,
      animation: 0,
      ghostClass: 'tab-ghost',
      onStart: () => {
        tabDragActive = true;
        tabbar.classList.add('dragging'); // suppress per-tab hover while reordering
      },
      onEnd: (evt) => {
        tabDragActive = false;
        tabbar.classList.remove('dragging');
        const el = evt.item as HTMLElement;
        const moved = tabs.find((t) => t.session.id === el.dataset.sid);
        // Index among the destination's tabs (ignores the project label), mapped onto the tabs array.
        const newIndex = [...(evt.to as HTMLElement).querySelectorAll<HTMLElement>('.tab')].indexOf(el);
        if (!moved || newIndex < 0) return;
        tabs.splice(0, tabs.length, ...reorderWithinGroup(tabs, tabClusterKey, moved, newIndex));
        persistOpenTabs();
      },
    }),
  );
}

// Alt-tabbing away mid-drag never delivers a pointerup, so SortableJS can leave a drag stuck. On blur, synthesise the release so it ends cleanly (dropping the tab where it currently is).
window.addEventListener('blur', () => {
  if (!tabDragActive) return;
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
});

function updatePlaceholder(): void {
  // Shown for a COLD selected tab as well as for no tab at all: its terminal exists but is empty, so without this a restored session would look like a session that had nothing in it.
  const cold = activeTab !== null && activeTab.terminalId === null;
  // A booting tab HAS a terminal, but it is still empty: keep the pane covered rather than showing the black rectangle that the wait would otherwise be.
  const booting = activeTab?.booting === true;
  placeholder.style.display = activeTab && !cold && !booting ? 'none' : 'flex';
  if (booting) {
    placeholder.textContent = `Starting “${sessionLabel(activeTab!.session)}”…`;
    return;
  }
  // Four different situations reach this pane, and each has a different next move — one sentence covering all of them tells someone with no sessions to pick one, and someone with no tabs to pick a tab that isn't there.
  placeholder.textContent = cold
    ? `“${sessionLabel(activeTab!.session)}” isn’t running. Click its tab to resume it.`
    : allSessions.length === 0
      ? 'No sessions yet — start one with + New.'
      : // visibleTabs, not tabs: a project view shows only its own, so "pick a tab above" was being
        // offered next to an empty bar whenever the open tabs all belonged to other projects.
        visibleTabs().length === 0
        ? 'Pick a session in the sidebar to open it.'
        : 'Pick a tab above, or a session in the sidebar, to resume it.';
}

// --- Wiring ---

window.claudeUi.onTerminalData((id, data) => {
  const tab = tabs.find((t) => t.terminalId === id);
  if (!tab) return;
  tab.term.write(data);
  // First VISIBLE output: the pane has something to show, so stop covering it.
  if (tab.booting && hasVisibleOutput(data)) {
    tab.booting = false;
    if (tab === activeTab) updatePlaceholder();
    renderTabBar();
  }
});
window.claudeUi.onTerminalExit((id, exitCode) => {
  const tab = tabs.find((t) => t.terminalId === id);
  if (!tab) return; // Already closed by the user.
  // A stop the user asked for: keep the tab, cold, so the layout survives and it can be resumed. Every other exit keeps today's behaviour below.
  if (tab.stopping) {
    coolTab(tab);
    return;
  }
  // A near-instant exit almost always means claude failed to start (bad env, not found, rc error).
  // Keep the tab so the error stays visible instead of flashing away.
  // Otherwise claude exited normally, so close the tab — no leftover shell.
  if (Date.now() - tab.startedAt < 1500) {
    tab.term.writeln(`\r\n[claude exited immediately (code ${exitCode}) — the session did not start]`);
    // Uncover the pane: this line IS the explanation of the failure, and it is exactly what the loader would otherwise hide.
    tab.booting = false;
    if (tab === activeTab) updatePlaceholder();
    return;
  }
  removeTab(tab);
});
window.claudeUi.onSessionStatus((id, status, tab) => {
  // A new-session tab learns its real session id the first time claude reports for it, so it then matches the sidebar entry (clicking it focuses the tab instead of opening a duplicate).
  if (tab) {
    const owner = tabs.find((t) => t.token === tab);
    if (owner && owner.session.id !== id) {
      const placeholderId = owner.session.id;
      owner.session = { ...owner.session, id };
      persistOpenTabs();
      // Now that the session has a real id it can be filed for real. The optimistic entry under the placeholder id is dropped in the same breath, so the row never leaves its group in between.
      if (owner.joinGroupId) {
        const groupId = owner.joinGroupId;
        owner.joinGroupId = undefined;
        pendingGroupOf.set(id, groupId); // hold the spot until the write comes back
        void window.claudeUi.moveSessionToGroup(id, groupId).then((next) => {
          pendingGroupOf.delete(id);
          applyGroupState(next);
        });
      }
      pendingGroupOf.delete(placeholderId);
      // Adoption changes the tab's IDENTITY, so the tab that could not be matched a moment ago can be matched now — and nothing else re-runs that match.
      // The refresh below is gated on the SESSION LIST's structure, which a rename before the first prompt has already consumed: the transcript was written (and its signature stored) while the tab still held its placeholder id, so the gate short-circuits and the tab keeps the "New: <folder>" name for good.
      // Reconciling here is cheap and needs no fresh read — refreshFromDisk assigns allSessions BEFORE that gate, so the renamed session is already in hand.
      reconcileOpenTabs();
      // And the SIDEBAR has to be redrawn for the same reason.
      // A not-yet-saved tab is shown from its own placeholder (visibleSessions adds it while its id is unknown to disk), so between the rename and this moment the list carries BOTH: the real renamed session and the placeholder.
      // Adoption is what retires the placeholder, and nothing else here redraws the list — reconcileOpenTabs paints only the tab bar, setStatus only the dots and the switcher.
      renderList();
    }
  }
  // 'start' is the SessionStart hook reporting which session a tab is running, not a state it is in.
  // It fires on `clear` and `compact` too — mid-session — so passing it to setStatus would clear a live dot.
  // Identity is all it carries, and that has been applied above.
  if (status === 'start') return;
  setStatus(id, status);
  // A new session's title isn't on disk immediately; re-read on its status events until it is (this also makes the new session appear in the sidebar).
  if (tabs.some((t) => t.needsTitle && t.session.id === id)) void refreshFromDisk();
});

// The sidebar keeps itself current: a transcript created or changed on disk re-renders it.
window.claudeUi.onSessionsChanged(() => void refreshFromDisk());

// Stop persisting open tabs once shutdown starts, so the terminal-exit closes it triggers don't overwrite the saved tab list with an empty one (see the shuttingDown note above).
window.claudeUi.onQuitting(() => {
  shuttingDown = true;
});

// Without the CLI every tab would open on "command not found", which reads as this app being broken rather than as a missing prerequisite. Say which one, and stay on screen until dismissed.
window.claudeUi.onClaudeMissing(() => {
  showToast('The claude CLI was not found on your PATH. Install it and restart claude-ui.', true);
});

function fitActive(): void {
  if (!activeTab) return;
  activeTab.fitAddon.fit();
  if (activeTab.terminalId === null) return; // cold: nothing to resize until it starts
  window.claudeUi.resizeTerminal(activeTab.terminalId, activeTab.term.cols, activeTab.term.rows);
}

window.addEventListener('resize', fitActive);
// Re-fit when the terminal area itself changes height (e.g. the tab bar wrapping to a new row), not just on window resize, so the terminal always fills its pane instead of being clipped.
// The ResizeObserver also covers sidebar resizing, since that changes the terminal pane's width.
new ResizeObserver(() => fitActive()).observe(terminalsEl);

// Drag the divider between the sidebar and the terminal to resize the session list; the width is remembered across launches.
const sidebar = document.getElementById('sidebar')!;
const sidebarResizer = document.getElementById('sidebar-resizer')!;
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 640;
// The width is restored with the rest of the view state (restoreUiState), not read here.
sidebarResizer.addEventListener('mousedown', (event) => {
  event.preventDefault();
  document.body.classList.add('resizing');
  sidebarResizer.classList.add('dragging');
  const onMove = (move: MouseEvent): void => {
    const width = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, move.clientX - sidebar.getBoundingClientRect().left));
    sidebar.style.flexBasis = `${width}px`;
  };
  const onUp = (): void => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.body.classList.remove('resizing');
    sidebarResizer.classList.remove('dragging');
    persistUi();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

newButton.addEventListener('click', async () => {
  // Show an active state while the folder picker is open (it has no persistent menu of its own), matching how the other header buttons look while their panel/menu is up.
  newButton.classList.add('active');
  try {
    const dir = await window.claudeUi.pickFolder();
    if (dir) openNewSession(dir);
  } finally {
    newButton.classList.remove('active');
  }
});
searchInput.addEventListener('input', () => {
  filterText = searchInput.value.trim().toLowerCase();
  renderList();
  // A filter change reshapes the list, so start at the top rather than a stale scroll offset.
  container.scrollTop = 0;
});
filterClear.addEventListener('click', clearFilter);
// Every filter pill does the same thing: flip its flag, re-render, scroll back to the results' top.
function wireFilterToggle(button: HTMLButtonElement, flip: () => void): void {
  button.addEventListener('click', () => {
    flip();
    renderList();
    container.scrollTop = 0;
  });
}
// Each pill shows the same mark the rows use, from the one definition — a glyph would render at a different weight beside them.
// Icon-only: the words cost the panel an extra line at a 320px sidebar, and every pill carries a tooltip and an aria-label (see index.html) for what it means.
pinnedFilter.innerHTML = PINNED_ICON;
openFilter.innerHTML = OPEN_ICON;
runningFilter.innerHTML = RUNNING_ICON;
siblingFilter.innerHTML = SIBLING_ICON;
worktreeFilter.innerHTML = WORKTREE_ICON;
noteFilter.innerHTML = NOTE_ICON;
archivedFilter.innerHTML = ARCHIVE_ICON;
wireFilterToggle(pinnedFilter, () => (showPinnedOnly = !showPinnedOnly));
wireFilterToggle(openFilter, () => (showOpenOnly = !showOpenOnly));
wireFilterToggle(runningFilter, () => (showRunningOnly = !showRunningOnly));
wireFilterToggle(worktreeFilter, () => (showWorktreeOnly = !showWorktreeOnly));
wireFilterToggle(siblingFilter, () => (showSiblingsOnly = !showSiblingsOnly));
wireFilterToggle(noteFilter, () => (showNotedOnly = !showNotedOnly));
wireFilterToggle(archivedFilter, () => (showArchivedOnly = !showArchivedOnly));
filterToggle.addEventListener('click', () => {
  // Boolean(): `hidden` is a string-or-boolean these days (it also takes "until-found").
  const opening = Boolean(filterPanel.hidden);
  setFilterPanel(opening);
  // Opening hands focus to the search box; closing drops focus so the ring doesn't linger.
  if (opening) searchInput.focus();
  else filterToggle.blur();
  // The only view change that does not re-render, so it needs its own call.
  persistUi();
});
datePresets.addEventListener('click', (event) => {
  const preset = (event.target as HTMLElement).dataset.range;
  if (!preset) return;
  applyDatePreset(preset);
  renderList();
  container.scrollTop = 0;
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
  applyCustomDates();
  renderList();
  container.scrollTop = 0;
}
// Where the list was scrolled to is remembered, so a scroll of your own is a change to remember too.
container.addEventListener('scroll', persistUi);
installTooltips();
// Restore the last-active project and open tabs, then scope the tab bar + terminal to that project.
void (async () => {
  groupState = await window.claudeUi.getGroupState();
  activeProject = await window.claudeUi.getActiveProject();
  // Before the first render: restoring filters afterwards would draw the whole list and then visibly cut it down.
  const scrollTop = await restoreUiState();
  await renderSessions();
  await restoreOpenTabs();
  // Again, now that the tabs exist. Two filters — open, and running — are questions about the TABS, and the render above happened while there were none, so a restored "open" filter would otherwise show an empty list next to a full tab bar. It also puts the open marker on the rows, which used to wait for the next render for its own reasons.
  renderList();
  // Last, because there is nothing to scroll until the rows are on screen. Later renders carry the offset along themselves.
  container.scrollTop = scrollTop;
  switchWorkspaceTerminal(activeProject);
})();
updatePlaceholder();
