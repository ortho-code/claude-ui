import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
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
  orderAsTabs,
  unstartableReason,
  hasVisibleOutput,
  statusLabel,
  stopControlState,
  type NudgeStatus,
  type SwitcherModel,
} from './logic';
import { parseLaunchFlags } from '../shared/flags';
import { installTooltips, setTooltip } from './tooltip';
import { chevronIcon, strokeIcon } from './svg';
import { createTerminal, bindTerminal, routeTerminals } from './terminal';
import { initTree, loadLayout, startPanels, restoreTreeState, treeState, treeContextChanged, configRoot } from './panels/tree';
import { reportBuiltinStatus } from './panels/types/builtin';
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
const liveFilter = document.getElementById('live-filter') as HTMLButtonElement;
const worktreeFilter = document.getElementById('worktree-filter') as HTMLButtonElement;
const siblingFilter = document.getElementById('sibling-filter') as HTMLButtonElement;
const noteFilter = document.getElementById('note-filter') as HTMLButtonElement;
const archivedFilter = document.getElementById('archived-filter') as HTMLButtonElement;
const goneFilter = document.getElementById('gone-filter') as HTMLButtonElement;
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
const sidebarFooter = document.getElementById('sidebar-footer')!;
const footerToggle = document.getElementById('footer-toggle')!;
const footerBadge = document.getElementById('footer-badge')!;
const footerLabel = document.getElementById('footer-label')!;
const footerList = document.getElementById('footer-list')!;

// A group's mark: layers, meaning "several things stacked as one". Muted, never accent — the accent belongs to the project's folder icon one line above it.
const layersIcon = (size: number): string => strokeIcon(size, '<path d="M8 2.2 2 5.4l6 3.2 6-3.2-6-3.2Z" /><path d="M2.4 9.2 8 12.2l5.6-3" />');

const FOLDER_ICON = strokeIcon(14, '<path d="M2 4h4l1.5 1.5H14V13H2z" />');

// The chrome marks — carets, +, ⋮, ✓, × — as SVG rather than the text glyphs they used to be.
// Every one of those resolved through system font fallback, which is how ⑂ ended up rendering from a MONOSPACE face beside its neighbours (see the family/worktree marks below).
// These render the same whatever the system has installed, take their colour from `currentColor` like the other icons, and are drawn through `strokeIcon`, which keeps their weight equal at every size.
// Chevrons, not filled triangles: the collapse-all button already says fold/unfold with a chevron, and a solid triangle would be the only filled shape in an outline icon set.
const chevronDown = (size: number): string => chevronIcon('down', size);
const chevronRight = (size: number): string => chevronIcon('right', size);
const plusIcon = (size: number): string => strokeIcon(size, '<path d="M8 3.5V12.5M3.5 8H12.5" />');
const tickIcon = (size: number): string => strokeIcon(size, '<path d="M3.5 8.4L6.6 11.5L12.5 4.9" />', 1.5);
const closeIcon = (size: number): string => strokeIcon(size, '<path d="M4.6 4.6L11.4 11.4M11.4 4.6L4.6 11.4" />');
// A tab's button ends the session before it removes the tab, so it needs two marks rather than one: the media-stop square for the first press, the cross for the second. Squared off at 6.6 units so it reads at the same weight as the cross's diagonal.
const stopIcon = (size: number): string => strokeIcon(size, '<rect x="4.7" y="4.7" width="6.6" height="6.6" rx="1.2" />');
// The window controls, drawn from the same set as everything else rather than as the platform glyphs they imitate — the app has no font-glyph icons anywhere and these should not be the exception.
const minimizeIcon = (size: number): string => strokeIcon(size, '<path d="M3.5 8H12.5" />');
const maximizeIcon = (size: number): string => strokeIcon(size, '<rect x="3.9" y="3.9" width="8.2" height="8.2" rx="1.4" />');
// Restore reads as "there is another window behind this one": the same square, with a second one peeking out top-right.
const restoreIcon = (size: number): string =>
  strokeIcon(size, '<path d="M5.6 5.6V4.4a1 1 0 011-1h4.8a1 1 0 011 1v4.8a1 1 0 01-1 1h-1.2" /><rect x="3.4" y="5.6" width="7" height="7" rx="1.2" />');
// The filter toggle's mark: a funnel, not the magnifier it used to be. A magnifier promises a search box, which clears when it closes; what this opens is filters, which stay on.
const filterIcon = (size: number): string => strokeIcon(size, '<path d="M2.5 2.5h11L9.2 7.9v4.4l-2.4 1.2V7.9z" />');
// Settings as two sliders, each with its knob.
const settingsIcon = (size: number): string =>
  strokeIcon(size, '<path d="M2 4.6h8.1M13.1 4.6h.9M2 11.4h2.9M7.9 11.4h6.1" /><circle cx="11.7" cy="4.6" r="1.6" /><circle cx="6.4" cy="11.4" r="1.6" />');
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
const settingsToggle = document.getElementById('settings-toggle') as HTMLButtonElement;
const settingsOverlay = document.getElementById('settings-overlay')!;
const settingsFlags = document.getElementById('settings-flags') as HTMLInputElement;
const settingsError = document.getElementById('settings-error')!;
const settingsOk = document.getElementById('settings-ok') as HTMLButtonElement;
const settingsCancel = document.getElementById('settings-cancel') as HTMLButtonElement;
const settingsConfigPath = document.getElementById('settings-config-path')!;
const settingsConfigReveal = document.getElementById('settings-config-reveal') as HTMLButtonElement;
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
toastClose.innerHTML = closeIcon(14);
toastClose.addEventListener('click', hideToast);

// Stacking attention toasts: a background tab (one you're not viewing) went waiting/idle. Separate from the one-off #toast message bar above.
const notifications = document.getElementById('notifications')!;
const NOTIF_TTL = 5000;
const NOTIF_MAX = 4;

function showAttentionToast(tab: Tab, status: 'waiting' | 'idle'): void {
  const el = document.createElement('div');
  el.className = `notif ${status}`;
  const dot = document.createElement('span');
  dot.className = `nudge ${status}`;
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
  close.className = 'icon-btn notif-close';
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
let showLiveOnly = false;
let showWorktreeOnly = false;
let showGoneOnly = false;
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
// A session started inside a group is filed under its real id before claude has even spawned — the app mints that id — so there is no transient membership to hold anywhere: what the UI draws is what meta says, always.
let groupState: GroupState = { groups: [], groupOf: {} };

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

/**
 * Models a session has switched to while the app was watching, by session id.
 *
 * A transcript records which model ANSWERED, never which one was chosen, so `/model` leaves no trace in it until the next reply — and the row went on naming the old model in between.
 * `PostModelSwitch` is the only place that answer exists at the moment it becomes true, so it is kept here and preferred over the transcript's.
 * In memory only: it can never be staler than what is on disk (every switch in this app's sessions lands here), and after a restart the transcript's own last answer is the right source again.
 */
const switchedModel = new Map<string, string>();

/** The model to show for a session: the one it has switched to if we saw that happen, else the one that last answered. */
function modelOf(session: SessionSummary): string {
  return switchedModel.get(session.id) ?? session.model;
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

/**
 * Make a status dot mute its session when clicked, wherever that dot is drawn.
 *
 * The gesture is "click the status dot", and it has to mean the same thing on all three surfaces that draw one — the sidebar row, the tab, and the attention strip — so it is one helper rather than three copies of the same four lines.
 * `stopPropagation` is the load-bearing part: every one of those dots sits inside something clickable that does something else (select the row, switch to the tab, jump to the session), and muting must not also do that.
 * The id arrives as a thunk because the sidebar's rows are REUSED across renders: the row knows its key, and which session that key holds is only true at the moment of the click.
 */
function ackOnClick(dot: HTMLElement, sessionId: () => string | null): void {
  dot.addEventListener('click', (event) => {
    event.stopPropagation();
    const id = sessionId();
    if (id) toggleAck(id);
  });
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
  /**
   * Why the last attempt to start this tab was refused, shown in place of the pane until it is tried again.
   * A refusal is not an exit: the tab never had a process, so nothing arrives on the terminal to explain itself.
   */
  failure?: string;
  term: Terminal;
  fitAddon: FitAddon;
  el: HTMLElement;
  // Names this TAB for the status hook, which echoes it back.
  // The tab's session id would not do: `/clear` ends the session and starts another in the same terminal, and this is what says the two belong to the same tab.
  token: string;
  // When claude was launched, to tell a real exit from a failed-to-start one.
  startedAt: number;
  // Bumped on each activation, so a workspace switch can restore a project's most-recent tab.
  activatedSeq: number;
}

/**
 * The arguments that apply only to a session's FIRST start, and to nothing else.
 * A resume needs none of them — the session already exists and carries its own name, worktree and history — which is why they are passed in rather than kept on the tab.
 */
interface TabLaunch {
  /** The session to resume FROM: a fork's parent. A plain resume needs nothing here, since a tab resumes its own session. */
  resumeFrom?: string;
  /** Copy the resumed session rather than continue it (`--fork-session`). */
  fork?: boolean;
  /** The session's display name (`--name`). */
  name?: string;
  /** A new git worktree to start in (`-w`): a name, or `''` to let claude pick one. */
  worktree?: string;
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
  // Persist entity keys (session ids — immutable, so a restart always finds them again). A session with no transcript yet is not in the map; its own id stands in, and restore drops it, which is right — there is nothing on disk to reopen.
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
      const tab = buildTab(session);
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
  return filterText.length > 0 || FILTER_PILLS.some((pill) => pill.get()) || datePreset !== 'any';
}

// Session key -> its group's NAME, so typing a group name reaches its sessions.
// Built ONCE per filter pass and handed in: passesFilters runs per session, so building it there would be one pass over the membership map per row.
function groupNameByKey(): Map<string, string> {
  const byId = new Map(groupState.groups.map((g) => [g.id, g.name]));
  const out = new Map<string, string>();
  for (const [key, id] of Object.entries(groupState.groupOf)) {
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
    liveOnly: showLiveOnly,
    // Built per call rather than hoisted: cheap next to the tab count, and it must reflect the tabs as they are right now, since starting or stopping one changes what this filter shows.
    live: showLiveOnly
      ? new Set(tabs.filter((t) => t.terminalId !== null).map((t) => entityKey(t.session)))
      : undefined,
    worktreeOnly: showWorktreeOnly,
    goneOnly: showGoneOnly,
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
  for (const pill of FILTER_PILLS) {
    pill.button.classList.toggle('active', pill.get());
    pill.button.setAttribute('aria-pressed', String(pill.get()));
  }
  // The toggle carries the accent when any filter is on, so an active filter is visible even with the panel closed.
  filterToggle.classList.toggle('active', filtering);
  if (filtering) filterCount.textContent = `Showing ${matches} of ${total}`;
}

function clearFilter(): void {
  searchInput.value = '';
  filterText = '';
  for (const pill of FILTER_PILLS) pill.set(false);
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
      live: showLiveOnly,
      worktree: showWorktreeOnly,
      gone: showGoneOnly,
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
    // Adopted into the layout tree's sizes on the first launch that has them, and not written again: the tree owns the sidebar's width now.
    sidebarWidth: null,
    scrollTop: container.scrollTop,
    panelState: treeState(),
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
  showLiveOnly = state.filters.live;
  showWorktreeOnly = state.filters.worktree;
  showGoneOnly = state.filters.gone;
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
  // The sidebar's width lived in localStorage, then in `sidebarWidth`; either is adopted once into the layout tree's sizes, so an existing install keeps its sidebar, and the tree owns it from here.
  restoreTreeState(state.panelState, state.sidebarWidth ?? Number(localStorage.getItem('sidebarWidth')));
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
  switcherBadge.className = headerBadge ? `nudge ${headerBadge}` : 'nudge';
  switcherBadge.hidden = !headerBadge;
  setTooltip(switcherBadge, headerBadge ? `A project is ${headerBadge}` : null);

  switcherPopover.replaceChildren(
    switcherItem('All', null, model.all.count, null, activeProject === null),
    ...model.projects.map((f) => switcherItem(f.name, f.repoRoot, f.count, f.badge, f.repoRoot === activeProject)),
  );

  renderFooter(model, pool);
  // What the built-ins' rail icons say while they are folded or behind another panel: the same roll-up as the header's badge for the sidebar, and the tabs on show for the terminal area.
  reportBuiltinStatus('sessions', headerBadge === 'waiting' ? 'wait' : null);
  reportBuiltinStatus('claude', visibleTabs().some((tab) => sessionNudge(tab.session.id) === 'waiting') ? 'wait' : null);
}

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
  // Forking RUNS claude in the session's folder, so it needs that folder to be there — but the item stays in the list, dimmed and carrying the reason, rather than vanishing.
  // Everything below is bookkeeping about a session rather than a way to start one, so it stays available: cleaning up after a folder that has gone is exactly when you need it.
  const cannotRun = unstartableReason(session);
  const items: MenuItem[] = [
    cannotRun
      ? { label: 'Fork this session', disabled: cannotRun }
      : { label: 'Fork this session', onSelect: () => { void forkSession(session); } },
  ];
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

/**
 * The strip row's stop control.
 *
 * WHY IT BELONGS HERE and is not just a shortcut for the tab's button: clicking a strip row calls `jumpToSession`, which is navigation — it switches the active project and activates the tab. So stopping a stray session from the strip costs you your place: you go there, stop it, and come back. This is the only way to act on a session in ANOTHER project without leaving the one you are looking at, which is the same gap the strip was built to close.
 * The membership rule makes it exact: the strip lists what has a PROCESS, which is precisely the set of things that can be stopped — so there is no scoping or filtering to reason about, and no cold-tab case.
 * STOP ONLY, never close: the strip is not a list of tabs. A row leaves it by the session stopping, which is what this already does.
 */
function stripStopButton(session: SessionSummary): HTMLButtonElement {
  const stop = document.createElement('button');
  stop.type = 'button';
  stop.className = 'icon-btn compact footer-item-stop';
  stop.innerHTML = stopIcon(14);
  const tab = tabs.find((t) => t.session.id === session.id);
  // No tab at all should not happen — membership is "has a process", and a process belongs to a tab — so it is inert rather than guessed at.
  if (!tab) {
    stop.disabled = true;
    return stop;
  }
  const { disabled, tooltip } = stopControlState(tab);
  stop.disabled = disabled;
  setTooltip(stop, tooltip);
  if (!disabled) {
    stop.addEventListener('click', (event) => {
      // The row around it jumps to the session; stopping must not also take you there.
      event.stopPropagation();
      stopSession(tab);
    });
  }
  return stop;
}

// Cross-project attention strip in the sidebar footer.
// The toggle badge is the same overall roll-up as the switcher header; expanded, it lists the nudged SESSIONS grouped under their project (each a row: state dot + session title), click one to jump to it.
// Muted "all clear" when nothing pending.
function renderFooter(model: SwitcherModel, pool: SessionSummary[]): void {
  const overall = model.all.badge;
  footerBadge.className = overall ? `nudge ${overall}` : 'nudge';
  footerBadge.hidden = !overall;

  // What is RUNNING, wherever it is running — not what is nudging.
  // Membership used to be "has a live nudge", which meant marking a dot read deleted the row: muting said "erase this" when it should have said "seen it".
  // Running is also the only rule that closes the gap this strip exists for: scoped to one project, a live session in another is invisible in the tab bar (filtered to the active project) and out of scope in the list, and the switcher only ever gets you to a PROJECT, never back to a SESSION.
  // Nothing is lost by dropping the nudge from the membership: a session that is not running has already reported SessionEnd, so it cannot be nudging in the first place.
  // IN TAB ORDER, which is the only order here that nothing on disk can move — see orderAsTabs.
  // Driven from the tabs rather than from the session list on purpose: every row in this strip IS a live tab, and taking the order from the tabs array is what stops a session writing a message from swapping two rows you were reading.
  // The session data still comes from the list, so a row shows what the sidebar shows; only the ORDER is the tab bar's.
  const shown = new Map(pool.map((s) => [entityKey(s), s]));
  const clusters = orderAsTabs(
    tabs
      .filter((t) => t.terminalId !== null)
      .flatMap((t) => {
        const session = shown.get(entityKey(t.session));
        return session ? [{ repoRoot: session.repoRoot, groupId: groupState.groupOf[session.id] ?? '', item: session }] : [];
      }),
    (root) => projectGroups(root).map((g) => g.id),
    projectOrder,
  );
  // The strip has no group ROWS — each row carries its group as a chip — so a project's clusters are flattened back into one run, in the order the tab bar would have drawn them.
  const ordered = [...new Map(clusters.map((c) => [c.repoRoot, [] as SessionSummary[]])).keys()].map((repoRoot) => ({
    name: projName(repoRoot),
    items: clusters.filter((c) => c.repoRoot === repoRoot).flatMap((c) => c.items),
  }));
  const total = ordered.reduce((n, g) => n + g.items.length, 0);
  // "Needs you" is idle or waiting and NOT already read; busy is work in progress, which wants nothing from you.
  const needing = ordered.reduce(
    (n, g) => n + g.items.filter((s) => sessionNudge(s.id) === 'idle' || sessionNudge(s.id) === 'waiting').length,
    0,
  );

  if (total === 0) {
    // Gone entirely rather than sitting there saying "All clear", which read as odd on a first run — nothing had happened yet for anything to be clear of — and left a caret pointing at a panel that could not open.
    // Absent over inert is what the rest of the sidebar does: the group jump button is dropped below two targets, the filter status hides when nothing is filtering.
    // The stored footerExpanded is deliberately untouched: this is what there is to show, not a preference, and the strip must come back the way you left it.
    sidebarFooter.hidden = true;
    footerList.hidden = true;
    footerList.replaceChildren();
    return;
  }

  sidebarFooter.hidden = false;
  footerToggle.setAttribute('aria-expanded', String(footerExpanded));
  // Counting ATTENTION rather than rows: now that a session stays listed while it runs, a plain row count would report five sessions wanting you when four of them are working away happily.
  footerLabel.textContent = needing > 0 ? `${needing} of ${total} need you` : `${total} live`;
  footerList.hidden = !footerExpanded;
  // Once for the whole strip rather than per row: the membership and the registry have to come from the same read anyway.
  const { groups, groupOf } = groupState;
  footerList.replaceChildren(
    ...ordered.flatMap((project) => {
      const heading = document.createElement('div');
      heading.className = 'footer-project';
      heading.textContent = project.name;
      const rows = project.items.map((session) => {
        // The row is a DIV holding two buttons rather than one button, because a button cannot contain a button and this row now has two things to do: jump to the session, or stop it.
        // The row shape (.footer-item, the shared menu-row rule) stays on the wrapper, so hovering anywhere in it still lights the whole row and the strip looks exactly as it did.
        const row = document.createElement('div');
        row.className = 'footer-item';
        const jump = document.createElement('button');
        jump.type = 'button';
        jump.className = 'footer-item-jump';
        // The roll-up badge rather than the sidebar's status dot: that one is 9px and bordered because it is a control in a dense row, where this sits on a row of its own.
        // It IS clickable though, and for the same reason the row is: acking a session anywhere else means going to where that session lives, which costs you the project you are looking at — the exact gap this strip exists to close.
        // The read state has to show either way, or a muted row reads as live — hence the acked modifier, which dims this badge exactly as it dims the dot.
        const dot = document.createElement('span');
        applyStatus(dot, statuses.get(session.id), acked.has(session.id));
        // A muted row stays LISTED: membership is "has a process", and acking says "seen it", not "stop". Only the count above drops it.
        ackOnClick(dot, () => session.id);
        const name = document.createElement('span');
        name.className = 'footer-item-name';
        name.textContent = sessionLabel(session);
        jump.append(dot, name);
        // The group as a CHIP rather than a third level of headings. The strip is capped at 40vh, where a project -> group -> session nesting costs a heading row and an indent per group, and a chip costs no rows at all.
        // Worth revisiting if several sessions of one group routinely show here together, since the same chip repeated down a run of rows reads as noise where a single heading would not.
        const groupName = groups.find((g) => g.id === groupOf[entityKey(session)])?.name;
        if (groupName) {
          const chip = document.createElement('span');
          chip.className = 'footer-item-group';
          chip.textContent = groupName;
          jump.append(chip);
        }
        setTooltip(jump, sessionLabel(session, '') || null);
        jump.addEventListener('click', () => jumpToSession(session));
        row.append(jump, stripStopButton(session));
        return row;
      });
      return [heading, ...rows];
    }),
  );
}

footerToggle.addEventListener('click', () => {
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
  dot.className = badge ? `nudge ${badge}` : 'nudge';

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

// The sessions the sidebar can show: every session on disk, plus the open tabs whose session has not written a transcript yet (so a fresh session appears in its project immediately).
// A tab's id is the session's real id from the moment it is created, so this adds a row that the transcript later fills in — never a second row beside it.
function visibleSessions(): SessionSummary[] {
  const tips = sessionsByKey(allSessions);
  const knownIds = new Set(allSessions.map((s) => s.id));
  const pending = tabs.filter((t) => !knownIds.has(t.session.id)).map((t) => t.session);
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
  const tree = buildProjectTree(scoped, groupState, pinned, isFiltering(), projectOrder);
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
const COLLAPSE_ALL_ICON = strokeIcon(14, '<path d="M4 7.25L8 3.75L12 7.25" /><path d="M4 12.25L8 8.75L12 12.25" />');
const EXPAND_ALL_ICON = strokeIcon(14, '<path d="M4 3.75L8 7.25L12 3.75" /><path d="M4 8.75L8 12.25L12 8.75" />');

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
    // Nothing can be started in a folder that is not there. Disabled rather than hidden: the project still has sessions to read, and a control that vanishes explains nothing — the tooltip does.
    const rootGone = !project.rootExists;
    const goneReason = rootGone ? `This project's folder is gone: ${project.repoRoot}` : null;
    if (els.addBtn) setUnavailable(els.addBtn, goneReason, 'New session in this project');
    if (els.addCaret) setUnavailable(els.addCaret, goneReason, 'New session options');
    els.section.classList.toggle('root-gone', rootGone);
    for (const { group, sessions } of project.groups) {
      const groupEls = groupSections.get(group.id) ?? createGroupSection(group.id);
      groupSections.set(group.id, groupEls);
      const groupCollapsed = foldedGroups().has(group.id);
      groupEls.section.classList.toggle('collapsed', groupCollapsed);
      groupEls.caret.innerHTML = caretIcon(groupCollapsed, 10);
      groupEls.label.textContent = group.name;
      groupEls.count.textContent = String(sessions.length);
      groupEls.addCaret.hidden = !project.isRepo; // worktree option only for git repos
      // A group starts its sessions in the project's folder, so it is gated by the same fact.
      setUnavailable(groupEls.addBtn, goneReason, 'New session in this group');
      setUnavailable(groupEls.addCaret, goneReason, 'New session options');
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
/**
 * Run a modal to completion.
 *
 * Everything a modal in this app does the same way: show the overlay, close on Escape from anywhere,
 * unbind every listener exactly once, and resolve a promise with the result.
 * `bind` wires the modal's own controls and returns the unbinds; `escapeValue` is what Escape means
 * for this modal, which is the only part that genuinely differs between them.
 *
 * Escape is bound on the DOCUMENT rather than the dialog: clicking the dialog's own text blurs the
 * field, and with no backdrop dismiss that would leave Cancel as the only way out.
 * There is deliberately no backdrop dismiss — selecting text inside the dialog and releasing outside
 * it dispatches the click on the overlay, which threw the dialog away mid-drag.
 */
function runModal<T>(overlay: HTMLElement, escapeValue: T, bind: (finish: (result: T) => void) => Array<() => void>): Promise<T> {
  overlay.hidden = false;
  return new Promise<T>((resolve) => {
    let unbind: Array<() => void> = [];
    const finish = (result: T): void => {
      overlay.hidden = true;
      for (const off of unbind) off();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') finish(escapeValue);
    };
    document.addEventListener('keydown', onKey);
    unbind = bind(finish);
  });
}

/** Add a listener and hand back the function that removes it, so a modal cannot forget one. */
function listen<K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void): () => void {
  el.addEventListener(type, handler);
  return () => el.removeEventListener(type, handler);
}

function confirmDelete(title: string): Promise<boolean> {
  confirmMessage.textContent = `Delete "${title}"?`;
  confirmDetail.textContent = 'Its transcript files move to the trash, so you can restore them from there if needed.';
  // Focus Cancel, not Delete: safer default for a destructive action, and it keeps the accent focus ring off the red button.
  confirmCancel.focus();
  return runModal<boolean>(confirmOverlay, false, (finish) => [
    listen(confirmOk, 'click', () => finish(true)),
    listen(confirmCancel, 'click', () => finish(false)),
  ]);
}

// A small modal text prompt (Promise-resolving): OK/Enter resolves the value, Cancel/Esc resolves null.
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
  // Shown by runModal; focus has to wait for that, since a hidden field cannot take it.
  renameOverlay.hidden = false;
  field.focus();
  // Select-all suits a short name you're replacing; a note you're editing wants the caret at the end.
  if (multiline) field.setSelectionRange(initialValue.length, initialValue.length);
  else field.select();
  return runModal<string | null>(renameOverlay, null, (finish) => {
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
      finish(value);
    };
    return [
      listen(renameOk, 'click', () => void submit()),
      listen(renameCancel, 'click', () => finish(null)),
      // Enter belongs to the field, since it submits what you typed; Escape is the modal's own and
      // lives in runModal. In a note Enter is a newline and Ctrl/Cmd+Enter saves, the same habit as
      // the terminal; a one-line field submits on plain Enter.
      listen(fieldEl, 'keydown', (event) => {
        if (event.key !== 'Enter') return;
        if (!multiline) void submit();
        else if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          void submit();
        }
      }),
    ];
  });
}

/**
 * The app's own preferences.
 *
 * Shares the overlay skin and `runModal`'s behaviour with the other two dialogs, but is its own form rather than a call to `promptText`: that one is a transient prompt built per call, this is a fixed screen that will grow sections.
 * Saving is validated by the same parser the launcher uses (shared/flags.ts), so what the field accepts and what a session gets can't disagree.
 */
async function openSettings(): Promise<void> {
  const stored = await window.claudeUi.getSettings();
  settingsFlags.value = stored.launchFlags;
  settingsError.hidden = true;
  // Read-only: the folder is edited by hand, so the dialog only says where it is.
  settingsConfigPath.textContent = configRoot() ?? '';
  settingsOverlay.hidden = false;
  settingsFlags.focus();
  settingsFlags.select();
  await runModal<void>(settingsOverlay, undefined, (finish) => {
    const submit = async (): Promise<void> => {
      const value = settingsFlags.value.trim();
      const { error } = parseLaunchFlags(value);
      if (error) {
        settingsError.textContent = error;
        settingsError.hidden = false;
        return;
      }
      await window.claudeUi.setSettings({ ...stored, launchFlags: value });
      finish();
    };
    return [
      listen(settingsOk, 'click', () => void submit()),
      listen(settingsCancel, 'click', () => finish()),
      listen(settingsFlags, 'keydown', (event) => {
        if (event.key === 'Enter') void submit();
      }),
      // Typing is the fix for an error, so clear it as soon as they do rather than leaving a stale complaint under the field.
      listen(settingsFlags, 'input', () => {
        settingsError.hidden = true;
      }),
    ];
  });
}

settingsToggle.addEventListener('click', () => void openSettings());
settingsConfigReveal.addEventListener('click', () => window.claudeUi.revealConfigFolder());

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
  renderTabBar(); // the bar orders its project rows by this too, so it moves with the list rather than at the next unrelated redraw
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
/**
 * Mark a control unavailable, carrying the reason, or available again when `reason` is null.
 *
 * `aria-disabled` rather than the `disabled` PROPERTY, and that is the whole point: a natively disabled button emits no mouse events in Chromium, so the tooltip delegated from `document` never fires and the one thing that says WHY is invisible.
 * The click is refused by the handler instead, which `unavailable()` answers for.
 */
function setUnavailable(control: HTMLElement, reason: string | null, tooltipWhenAvailable?: string): void {
  control.classList.toggle('unavailable', reason !== null);
  if (reason) control.setAttribute('aria-disabled', 'true');
  else control.removeAttribute('aria-disabled');
  setTooltip(control, reason ?? tooltipWhenAvailable ?? null);
}

/** Whether a control has been marked unavailable, for the handlers that must then do nothing. */
function unavailable(control: HTMLElement): boolean {
  return control.getAttribute('aria-disabled') === 'true';
}

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
  /**
   * The action exists but cannot be taken right now, with `disabled` saying why.
   * Kept in the list rather than dropped: a menu that changes SHAPE is one you have to re-read, and an action that silently disappears looks like it was never there — where a dimmed one with a reason answers the question you opened the menu to ask.
   */
  disabled?: string;
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
    if (item.disabled) {
      // Nothing is wired below: it takes no click and opens no submenu, and it carries the reason as its tooltip.
      setUnavailable(button, item.disabled);
      menu.append(button);
      continue;
    }
    // A row that names something countable (a group, say): a status dot leads, the label takes the room it needs and ellipsizes, and the count sits in its own column at the right.
    if (item.count !== undefined) {
      button.classList.add('has-count');
      const label = document.createElement('span');
      label.className = 'menu-item-label';
      label.textContent = item.label;
      if (item.muted) label.classList.add('muted');
      const dot = document.createElement('span');
      dot.className = `nudge${item.badge ? ` ${item.badge}` : ''}`;
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
 * Fold or unfold a section: remember it, hide the rows, turn the caret, save.
 *
 * Both toggles deliberately skip renderList — no flicker, no scroll jump — and that render is the one
 * call which would otherwise have persisted the fold, which is why saving happens here instead.
 */
function toggleFold(section: HTMLElement, caret: HTMLElement, folded: Set<string>, key: string): void {
  const collapsed = !folded.has(key);
  if (collapsed) folded.add(key);
  else folded.delete(key);
  section.classList.toggle('collapsed', collapsed);
  caret.innerHTML = caretIcon(collapsed, 10);
  persistUi();
}

// Build a project section once; contents (count, caret, rows) are updated on later renders.
function createProjectSection(name: string, folderCwd?: string): ProjectSectionEls {
  const section = document.createElement('section');
  section.className = 'project';

  const { heading, caret, icon, label, count } = buildHeading('h2', FOLDER_ICON);
  setTooltip(label, name); // full path on hover
  label.textContent = projName(name);
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
      void openNewSession(folderCwd);
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
        { label: 'New session', onSelect: () => void openNewSession(folderCwd) },
        { label: 'New worktree session…', onSelect: () => void openWorktreeSession(folderCwd) },
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
    ]);
  });
  heading.append(kebab);
  // Toggle in place (CSS hides the rows) so the sidebar doesn't rebuild and flicker.
  // Keep the clicked heading anchored: a sticky heading otherwise snaps between stuck and natural position as its rows appear/disappear, which reads as a jump.
  heading.addEventListener('click', () => {
    // Not collapsible in a single-project view: hiding the one project you're looking at leaves an empty sidebar. The heading is a title there, and updateProjectSection drops its caret to say so.
    if (activeProject !== null) return;
    const before = heading.getBoundingClientRect().top;
    toggleFold(section, caret, foldedProjects(), name);
    container.scrollTop += heading.getBoundingClientRect().top - before;
    // No render here, so the header button has to be refreshed by hand — otherwise it still reads "Expand all" after one project reopens.
    updateCollapseToggle();
  });
  section.appendChild(heading);

  return { section, heading, caret, count, label, groupsBtn, addCaret, addBtn };
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
    const group = groupState.groups.find((g) => g.id === id);
    if (group?.repoRoot) void openNewSession(group.repoRoot, id);
  });
  const addCaret = document.createElement('button');
  addCaret.className = 'icon-btn composite group-add-caret';
  addCaret.innerHTML = chevronDown(9);
  addCaret.hidden = true;
  setTooltip(addCaret, 'New session options');
  addCaret.addEventListener('click', (event) => {
    event.stopPropagation();
    if (unavailable(addCaret)) return;
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
    toggleFold(section, caret, foldedGroups(), id);
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
  return { section, heading, caret, label, count, addCaret, addBtn: add, members, empty };
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
const NOTE_ICON = strokeIcon(13, '<path d="M4 2.5h8v11H4z" /><path d="M6.25 6h3.5M6.25 8.75h3.5" />');
const SIBLING_ICON = strokeIcon(11, '<path d="M8 12V8M4 4L8 8L12 4" />');
const WORKTREE_ICON = strokeIcon(11, '<path d="M4.5 12V4M4.5 8Q11.5 8 11.5 4" />');

// The pin, as SVG rather than the ★/☆ glyphs: those resolve through system font fallback (DejaVu Sans under WSLg), whose outline star is a hairline that reads far fainter than its --muted colour should.
// Same star either way — filled for pinned, outlined for not — so the two states differ by ink, not by colour, and both render at a weight we control instead of the font's.
const STAR_PATH =
  'M8 2.1 L9.41 6.06 L13.61 6.18 L10.28 8.74 L11.47 12.77 L8 10.4 L4.53 12.77 L5.72 8.74 L2.39 6.18 L6.59 6.06 Z';
const PIN_ICON = strokeIcon(14, `<path d="${STAR_PATH}" />`);
const PINNED_ICON = strokeIcon(14, `<path d="${STAR_PATH}" fill="currentColor" />`);

// The open filter's mark: a window with a title bar — "this one has a tab". Deliberately a SHAPE where running is a DOT, so the pair reads as two different questions rather than two intensities.
const OPEN_ICON = strokeIcon(13, '<rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1.4" /><path d="M2.6 6.4h10.8" />');

// The running filter's mark: a filled dot inside a ring — the same "live" language the status dots speak, rather than a play triangle, which would read as "start these".
const LIVE_ICON = strokeIcon(13, '<circle cx="8" cy="8" r="5.5" /><circle cx="8" cy="8" r="2.2" fill="currentColor" stroke="none" />');

// The archived filter's mark: a lidded box. Ink spans the full 16-unit box horizontally and 3..13 vertically, centred on (8,8) like the rest, so it sits square beside the star and the branch.
// A folder with a slash through it: the session's directory is not there any more.
// Drawn at the same size and weight as the other pill marks, so it sits with them rather than beside them.
const FOLDER_GONE_ICON = strokeIcon(13, '<path d="M2 12.2V3.8h3.6l1.2 1.6H14v6.8z" /><line x1="3" y1="13.2" x2="13.4" y2="2.8" />');

const ARCHIVE_ICON = strokeIcon(13, '<path d="M2.5 3.2h11v3h-11z" /><path d="M3.6 6.2v6.6h8.8V6.2" /><path d="M6.4 9h3.2" />');

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
    if (showArchivedOnly) return;
    const session = currentByKey.get(key);
    if (!session) return;
    // A session whose folder is gone cannot run anywhere. The row says so in its tooltip, and this answers the click for anyone who tries it anyway rather than opening a tab that could only fail.
    const reason = unstartableReason(session);
    if (reason) {
      showToast(reason);
      return;
    }
    void openSession(session);
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
    const model = modelLabel(modelOf(session));
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
  dot.className = status ? `nudge single clickable ${status}${isAcked ? ' acked' : ''}` : 'nudge single clickable';
  setTooltip(dot, statusLabel(status, isAcked));
}

// --- Tabs ---

async function openSession(session: SessionSummary): Promise<void> {
  const existing = tabs.find((t) => t.session.id === session.id);
  if (existing) {
    activateTab(existing);
    return;
  }
  await createTab(session);
}

/**
 * A session with no transcript yet, as the SessionSummary defaults plus whatever the caller already knows.
 * One factory, so a SessionSummary field change lands here once instead of in four literals.
 *
 * THE ID IS THE REAL ONE, and the caller says what it is: minted here for a session the app is about to start (handed to claude as `--session-id`), or the id Claude Code reported for a session that replaced another in the same terminal.
 * Either way everything keyed by id — the sidebar row, a group, a pin, a note, the status file — is right from the first paint rather than being moved later.
 * Until claude writes the transcript the session exists only as this object, held by its tab; `visibleSessions` is what puts it in the sidebar in the meantime.
 */
function newSession(id: string, over: Partial<SessionSummary> & Pick<SessionSummary, 'cwd' | 'repoRoot' | 'title'>): SessionSummary {
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
    // A session the app is about to start in a folder it just resolved: both are there, or the start would not have been offered.
    cwdExists: true,
    repoRootExists: true,
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

/** What a session with nothing in it yet is called: the folder it runs in. Shared with a session `/clear` has just emptied, which is the same thing. */
function untitledLabel(cwd: string): string {
  return `New: ${cwd.split('/').filter(Boolean).pop() ?? cwd}`;
}

// Start a brand-new claude session in `cwd`, under an id this app mints; the sidebar row is that same session, filled in once claude writes its transcript.
async function openNewSession(cwd: string, joinGroupId?: string): Promise<void> {
  const session = newSession(crypto.randomUUID(), { cwd, repoRoot: cwd, title: untitledLabel(cwd) });
  // Filed BEFORE the tab exists, so the row's first paint is already inside the group. An ordinary membership write: the id is the session's real one, so there is nothing to correct afterwards.
  if (joinGroupId) await moveSessionToGroup(session, joinGroupId);
  ensureProjectVisible(session.repoRoot);
  await createTab(session);
  renderList();
}

// Start a new session in a fresh git worktree of `repoRoot`: `claude -w [name]`.
// Prompts for an optional name (blank -> claude auto-names).
// Like openNewSession, the tab carries the session's real id from the start; the worktree badge is the only optimistic part, and it reconciles on the next refresh.
async function openWorktreeSession(repoRoot: string, joinGroupId?: string): Promise<void> {
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
  renderList();
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
  const parentGroup = groupState.groupOf[entityKey(parent)];
  if (parentGroup) await moveSessionToGroup(session, parentGroup);
  await createTab(session, { resumeFrom: parent.id, fork: true, name: trimmed || undefined });
  renderList();
}

/**
 * Build a tab WITHOUT a process: real DOM, a real Terminal, no claude.
 * `terminalId` stays null until startTab fills it in, which is what lets tabs be restored cold — 20 restored tabs used to mean 20 `claude --resume` processes at ~437 MB each, spawned whether or not you looked at any of them.
 * The xterm instance stays eager on purpose: an empty one costs almost nothing next to a process, and keeping it non-null confines this to the handful of places that use terminalId.
 */
function buildTab(session: SessionSummary): Tab {
  const token = crypto.randomUUID();

  const el = document.createElement('div');
  el.className = 'term';
  terminalsEl.appendChild(el);

  // The xterm itself is the one every terminal here shares (terminal.ts); what follows is the handling that belongs to a tab running claude.
  const { term, fitAddon } = createTerminal(el);

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
async function startTab(tab: Tab, launch: TabLaunch = {}): Promise<void> {
  if (tab.terminalId !== null || tab.starting) return;
  tab.starting = true;
  try {
    tab.startedAt = Date.now();
    // Every way a session begins — new, fork, worktree, resuming a cold tab — funnels through here, so the starting state belongs here rather than at any one call site.
    tab.booting = true;
    tab.failure = undefined; // trying again clears what the last attempt said, so a stale reason cannot outlive it
    // Before the await, not after: otherwise a cold tab keeps saying "click its tab to resume it" across the spawn round-trip, which is the one thing you have just done.
    if (tab === activeTab) updatePlaceholder();
    renderTabBar(); // and for the same reason: the button has to show the pause while the process is on its way, not once it has arrived.
    // Which of the two id flags a start uses is one question: does this session have a transcript?
    // No — the tab's id is one this app minted, so claude is told to CREATE the session under it (claude refuses an id that is already in use, which is exactly the same question).
    // Yes — that id is what there is to resume, and `--session-id` would be refused.
    // A fork is the one start that does both: it resumes the PARENT and creates the tab's own session.
    const onDisk = allSessions.some((s) => s.id === tab.session.id);
    tab.terminalId = await window.claudeUi.startTerminal(tab.session.cwd, {
      sessionId: onDisk ? undefined : tab.session.id,
      resumeSessionId: launch.resumeFrom ?? (onDisk ? tab.session.id : undefined),
      fork: launch.fork,
      name: launch.name,
      worktree: launch.worktree,
      tabToken: tab.token,
    });
    // Gone while it was still starting: the tab has been removed but the pty has not, so hand it straight back rather than leaving a claude running with nothing pointing at it.
    // The button is disabled throughout the wait, so this is not that route — it is deleting the session, which closes its tab wherever that tab had got to.
    // It has to be the first thing after the await, since everything below touches a terminal that removeTab has already disposed.
    if (!tabs.includes(tab)) {
      window.claudeUi.closeTerminal(tab.terminalId);
      tab.terminalId = null;
      return;
    }
    // From here its output and exit are this tab's, until the pty's own exit unbinds it.
    bindTerminal(tab.terminalId, { data: (data) => onTabData(tab, data), exit: (exitCode) => onTabExit(tab, exitCode) });
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
  } catch (error) {
    // The main process refuses to launch into a folder that is no longer there rather than starting somewhere else and saying nothing, so this is where the session gets told.
    // It goes on the PLACEHOLDER rather than into the tab's terminal: the tab stays cold, and a cold tab's pane is covered by the placeholder, so anything written to the terminal would be hidden behind it.
    // The tab is kept rather than closed — put the folder back and the same tab starts.
    tab.terminalId = null;
    tab.booting = false;
    // The same wording the row's tooltip and the toast use, so the three cannot drift — this is the backstop for a folder that disappeared while the app was running, which no amount of gating can pre-empt.
    const refused = /MISSING_CWD:/.test(error instanceof Error ? error.message : '');
    tab.failure = refused
      ? (unstartableReason({ ...tab.session, cwdExists: false }) ?? '')
      : 'This session could not be started.';
    if (tab === activeTab) updatePlaceholder();
    showToast(tab.failure);
  } finally {
    tab.starting = false;
    // A start that ends without reaching the render above — a throw, or the early return below — must still hand the button back.
    if (tabs.includes(tab)) renderTabBar();
    // The attention strip lists what is RUNNING, so a new session belongs in it now.
    // AFTER `starting` is cleared, not before: the strip draws that flag as a disabled stop button, and rendering it a moment early left every freshly started session with a dead button that nothing came back to repaint.
    refreshSwitcher();
  }
}

async function createTab(session: SessionSummary, launch: TabLaunch = {}): Promise<void> {
  const tab = buildTab(session);
  // Select it WITHOUT starting: this call knows the arguments that only apply to a session's FIRST start (--fork-session, --name, -w), and starts the tab itself below.
  // activateTab can only ever resume, and its `starting` flag would then make the real start a no-op.
  activateTab(tab, false);
  persistOpenTabs();
  await startTab(tab, launch);
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
    // A tab whose folder has gone cannot be started, so say so rather than letting the spawn be refused a moment later with the same message.
    // The tab is KEPT, cold: put the folder back — recreate the worktree at its old path — and the very same tab starts.
    const reason = unstartableReason(tab.session);
    if (reason) {
      tab.failure = reason;
      updatePlaceholder();
      if (start) showToast(reason);
    } else if (start) {
      // No arguments: startTab resumes the tab's session, or — for a tab stopped before it ever wrote a transcript — starts it fresh under that same id, so nothing keyed to it is lost.
      void startTab(tab);
    }
  } else window.claudeUi.resizeTerminal(tab.terminalId, tab.term.cols, tab.term.rows);
  tab.term.focus();
  // Remembered twice: overall (where to reopen at launch) and for this project (where to return to when you switch back to it).
  lastActiveKey = entityKey(tab.session);
  activeByProject[tab.session.repoRoot] = lastActiveKey;
  window.claudeUi.setActiveSession(lastActiveKey, tab.session.repoRoot);
  // Panels run in the active tab's folder, so they follow the tab.
  treeContextChanged();
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
  // With no tab in scope the panels fall back to the project's root, or to nothing in the All view.
  treeContextChanged();
}

// Drop a tab from the UI. Idempotent (a user close and the terminal's own exit can both fire). It does not touch the terminal process; callers terminate it when they need to.
function removeTab(tab: Tab): void {
  const index = tabs.indexOf(tab);
  if (index === -1) return;
  clearNudge(tab.session.id);
  tab.term.dispose();
  tab.el.remove();
  tabs.splice(index, 1);
  if (activeTab === tab) activeTab = null;
  // Re-establish the active tab within the current workspace scope (or clear); this re-renders too.
  switchWorkspaceTerminal(activeProject);
  persistOpenTabs();
  // Closing a LIVE tab takes its row out of the strip here, not when the pty's exit eventually lands — `closeTab` removes the tab first and kills the process after, so without this the strip lists a session nothing is running.
  refreshSwitcher();
}

// User-initiated close: terminate the session (claude persists per turn, so its context is on disk) and drop the tab. closeTerminal sends Ctrl-C twice to exit claude cleanly, then kills it.
/**
 * End the session but keep its tab, cold and resumable.
 * The opposite of closeTab, and the deliberate counterpart to claude exiting on its own — which still CLOSES the tab, so a finished session does not leave an empty one behind.
 * `stopping` is what tells those two apart when the exit arrives.
 */
function stopSession(tab: Tab): void {
  if (tab.terminalId === null || tab.stopping) return;
  tab.stopping = true;
  // At once, so the button shows the pause for as long as the exit takes rather than after it.
  // Both buttons: the session is in the attention strip too, by definition — it has a process — and a pause shown in one place and not the other is two surfaces disagreeing about the same session.
  renderTabBar();
  refreshSwitcher();
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
  refreshSwitcher(); // drops it from the attention strip now rather than when its SessionEnd lands
  treeContextChanged(); // the panels lose their tab too, and fall back to the project
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
function tabClusterKey(tab: Tab, groupOf: Record<string, string> = groupState.groupOf): string {
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
  const groupOf = groupState.groupOf; // computed once; every tab is keyed against it
  // Your project order, the same one the sidebar and the strip use — so all three agree about where a project sits.
  // The bar used to order projects by whichever it met first, which nobody chose and which moved on its own: closing a project's last tab and opening another sent that project to the end.
  const clustered = orderAsTabs(
    shown.map((tab) => ({ repoRoot: tab.session.repoRoot, groupId: groupOf[tab.session.id] ?? '', item: tab })),
    (root) => projectGroups(root).map((g) => g.id),
    projectOrder,
  );
  const byCluster = new Map(clustered.map((c) => [`${c.repoRoot}\0${c.groupId}`, c.items]));
  const roots = [...new Set(clustered.map((c) => c.repoRoot))];

  const children: HTMLElement[] = [];
  for (const root of roots) {
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
      icon.className = 'heading-icon';
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
  // Toggle "read" from the tab too, rather than only from the sidebar row.
  ackOnClick(dot, () => tab.session.id);

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
  close.className = 'icon-btn compact tab-close';
  // Anything but a settled cold tab: it has a process, or one is on its way, or one is on its way out.
  if (tab.terminalId !== null || tab.starting || tab.stopping) {
    // Stopping, and its two pauses, are the same rule the attention strip's button follows — see stopControlState.
    const { disabled, tooltip } = stopControlState(tab);
    close.disabled = disabled;
    close.innerHTML = stopIcon(14);
    setTooltip(close, tooltip);
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
        // The strip reads its order from this array, and SortableJS has only moved the TAB's element — nothing else here repaints, so without this the strip keeps the order it was drawn with until something unrelated redraws it.
        refreshSwitcher();
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
  // A start that was REFUSED says why, in place of "click its tab to resume it" — which would be telling you to do the thing that just failed.
  if (activeTab?.failure) {
    placeholder.textContent = activeTab.failure;
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

// Output and exits reach a tab through the sink it bound when it started (terminal.ts routes them by terminal id, for tabs and panels alike).
routeTerminals();

function onTabData(tab: Tab, data: string): void {
  tab.term.write(data);
  // First VISIBLE output: the pane has something to show, so stop covering it.
  if (tab.booting && hasVisibleOutput(data)) {
    tab.booting = false;
    if (tab === activeTab) updatePlaceholder();
    renderTabBar();
  }
}

function onTabExit(tab: Tab, exitCode: number): void {
  if (!tabs.includes(tab)) return; // Already closed by the user.
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
}
window.claudeUi.onSessionStatus((id, status, tab) => {
  // A tab's session can be REPLACED under it: `/clear` ends the session and starts a fresh one in the same terminal, under an id Claude Code chooses rather than one the app passed as `--session-id`.
  // The token is what ties the two together — without this the tab would keep pointing at the session that just ended, and resuming it later would reopen the wrong history.
  const owner = tab ? tabs.find((t) => t.token === tab) : undefined;
  if (owner && owner.session.id !== id) {
    const previous = owner.session;
    const replaced = previous.id;
    // A CLEARED SESSION IS A NEW SESSION, so it starts from the same blank the "+" button does rather than from its predecessor's row.
    // Carrying the old object forward was the app's own half of the copied-title problem: it kept the title, the first message and the sibling marks of a conversation this session does not have.
    // The folder is all that genuinely survives — it is the same terminal, in the same place.
    owner.session = newSession(id, {
      cwd: previous.cwd,
      repoRoot: previous.repoRoot,
      isRepo: previous.isRepo,
      worktree: previous.worktree,
      title: untitledLabel(previous.cwd),
    });
    // The stand-in is ours to choose; the TITLE on disk is not, and is left alone.
    // Claude Code copies the cleared session's name into the new transcript, where nothing distinguishes it from a name somebody chose — so a named session goes on showing that name, exactly as `claude --resume` lists it. Overriding it would mean this app and the CLI disagreeing about what a session is called.
    // The pairing is recorded because nothing else can observe it: neither transcript points at the other, and the connection exists only in this moment.
    void window.claudeUi.recordClear(replaced, id, previous.title);
    persistOpenTabs();
    // A group says where this WORK lives, and clearing a session does not move the work — so the replacement joins the group its predecessor was in, rather than the tab visibly dropping out of its section.
    // The predecessor keeps its own membership: it is still a real session, and still that group's history.
    // Only the group carries over. A pin and a note are about one CONVERSATION, and that conversation still has its own row to hold them.
    const group = groupState.groupOf[replaced];
    if (group) void window.claudeUi.moveSessionToGroup(id, group).then(applyGroupState);
    // The tab's identity is what decides which row is "open" and which session the bar names, and nothing else re-runs that match.
    reconcileOpenTabs();
    renderList();
  }
  // 'start' reports which session a tab is running, not a state it is in — and it fires mid-session on clear and compact, where setting a status would wipe a live one.
  // The one SessionStart that does mean a state (a compaction ending) reaches us as 'idle', not as this.
  if (status === 'start') return;
  setStatus(id, status);
  // A new session's title isn't on disk immediately; re-read on its status events until it is (this also replaces the tab's own stand-in row with the real one).
  if (tabs.some((t) => t.session.id === id) && !allSessions.some((s) => s.id === id)) void refreshFromDisk();
});

window.claudeUi.onSessionModel((id, model) => {
  if (switchedModel.get(id) === model) return;
  switchedModel.set(id, model);
  // The row prints the model, and nothing else is going to redraw it: the session list on disk has not changed, so the usual refresh would see no reason to.
  renderList();
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
  // A terminal area with no size is hidden — behind another panel of its group, or folded — and a fit now would tell the pty xterm's 80×24 default (the hidden-pane trap); the ResizeObserver below fits it once it has a size again.
  if (!activeTab || terminalsEl.clientWidth === 0 || terminalsEl.clientHeight === 0) return;
  activeTab.fitAddon.fit();
  if (activeTab.terminalId === null) return; // cold: nothing to resize until it starts
  window.claudeUi.resizeTerminal(activeTab.terminalId, activeTab.term.cols, activeTab.term.rows);
}

window.addEventListener('resize', fitActive);
// Re-fit when the terminal area itself changes size (the tab bar wrapping to a new row, a divider dragged, the layout rebuilt), not just on window resize, so the terminal always fills its pane instead of being clipped.
new ResizeObserver(() => fitActive()).observe(terminalsEl);

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

/**
 * The filter pills, once, in the order they sit in the panel: each one's button, its mark and its flag.
 * Everything that asks about the pills as a set reads this — whether any is on, how they are drawn and wired, what Clear resets — so none of them can miss a pill.
 * The stored view (`uiSnapshot`, `restoreUiState`) and the predicate (`passesFilters`) still name each flag, because each maps it to a key of its own.
 */
interface FilterPill {
  button: HTMLButtonElement;
  icon: string;
  get: () => boolean;
  set: (on: boolean) => void;
}
const FILTER_PILLS: FilterPill[] = [
  { button: pinnedFilter, icon: PINNED_ICON, get: () => showPinnedOnly, set: (on) => (showPinnedOnly = on) },
  { button: openFilter, icon: OPEN_ICON, get: () => showOpenOnly, set: (on) => (showOpenOnly = on) },
  { button: liveFilter, icon: LIVE_ICON, get: () => showLiveOnly, set: (on) => (showLiveOnly = on) },
  { button: worktreeFilter, icon: WORKTREE_ICON, get: () => showWorktreeOnly, set: (on) => (showWorktreeOnly = on) },
  { button: siblingFilter, icon: SIBLING_ICON, get: () => showSiblingsOnly, set: (on) => (showSiblingsOnly = on) },
  { button: noteFilter, icon: NOTE_ICON, get: () => showNotedOnly, set: (on) => (showNotedOnly = on) },
  { button: archivedFilter, icon: ARCHIVE_ICON, get: () => showArchivedOnly, set: (on) => (showArchivedOnly = on) },
  { button: goneFilter, icon: FOLDER_GONE_ICON, get: () => showGoneOnly, set: (on) => (showGoneOnly = on) },
];

// Each pill shows the same mark the rows use, from the one definition — a glyph would render at a different weight beside them.
// Icon-only: the words cost the panel an extra line at a 320px sidebar, and every pill carries a tooltip and an aria-label (see index.html) for what it means.
for (const pill of FILTER_PILLS) {
  pill.button.innerHTML = pill.icon;
  // Every filter pill does the same thing: flip its flag, re-render, scroll back to the results' top.
  pill.button.addEventListener('click', () => {
    pill.set(!pill.get());
    renderList();
    container.scrollTop = 0;
  });
}
// The header's icons come from here too, rather than inline in index.html, so they are drawn through the same helper as the rest.
settingsToggle.innerHTML = settingsIcon(14);
filterToggle.innerHTML = filterIcon(14);
// The switcher's and the attention strip's carets, from the same chevron as every other fold in the app.
for (const caret of document.querySelectorAll<HTMLElement>('.switcher-chev, .footer-chev')) caret.innerHTML = chevronDown(11);
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

// ---- The window's own title bar ----
// Drawn only where there is no OS one. Every piece of it starts hidden in index.html, so macOS —
// which keeps its native frame and traffic lights — simply never turns any of it on.
// See .plan/plan_window-chrome.md, and the `wsl` skill for why the native maximize cannot be used.
const resizeEdges = document.getElementById('resize-edges')!;
const titlebar = document.getElementById('titlebar')!;
const windowVersion = document.getElementById('window-title')!;
const winMinimize = document.getElementById('win-minimize') as HTMLButtonElement;
const winMaximize = document.getElementById('win-maximize') as HTMLButtonElement;
const winClose = document.getElementById('win-close') as HTMLButtonElement;
let windowMaximized = false;

function paintMaximizeButton(): void {
  const label = windowMaximized ? 'Restore' : 'Maximize';
  winMaximize.innerHTML = windowMaximized ? restoreIcon(14) : maximizeIcon(14);
  winMaximize.setAttribute('aria-label', label);
  setTooltip(winMaximize, label);
}

void (async () => {
  const chrome = await window.claudeUi.getWindowChrome();
  if (!chrome.own) return;
  // The strip lives inside the bar, so unhiding the bar reveals both.
  titlebar.hidden = false;

  // The version, and whether this is a run from source, lost their home when the OS title bar went.
  windowVersion.textContent = chrome.title;
  setTooltip(windowVersion, chrome.title);

  windowMaximized = chrome.maximized;
  paintMaximizeButton();
  winMinimize.innerHTML = minimizeIcon(14);
  winClose.innerHTML = closeIcon(14);

  winMinimize.addEventListener('click', () => window.claudeUi.minimizeWindow());
  winMaximize.addEventListener('click', () => window.claudeUi.toggleMaximizeWindow());
  winClose.addEventListener('click', () => window.claudeUi.closeWindow());
  // Also fires when a window manager maximized the window and the main process converted that into ours.
  window.claudeUi.onWindowMaximized((value) => {
    windowMaximized = value;
    paintMaximizeButton();
  });
  // What counts as "the bar" for dragging and double-clicking: the strip and its inert contents (the
  // mark, the title), but not the controls and not the resize handles along its top.
  // Testing `event.target === titlebar` instead was a real bug: the title fills the middle of the bar
  // (flex: 1), so a double-click on the header almost always lands on IT, and the toggle never ran —
  // the window maximized natively instead, drawn offset and with the app unaware it had happened.
  const onBarBackground = (event: Event): boolean => {
    const target = event.target as HTMLElement | null;
    return target !== null && !target.closest('#window-controls') && !target.closest('.resize-edge');
  };

  titlebar.addEventListener('dblclick', (event) => {
    if (onBarBackground(event)) window.claudeUi.toggleMaximizeWindow();
  });

  // One gesture for moving and for resizing every edge: same pointer capture, same slack, same
  // frame-throttled reporting, differing only in which edge the main process is told to work on.
  // They were two near-identical blocks; see CLAUDE.md on one implementation per behaviour.
  //
  // screenX/screenY throughout, never client coordinates: the window itself moves under the gesture,
  // so anything measured relative to it shifts beneath a pointer that has not moved.
  // The offset sent is the TOTAL from where the gesture began, which the main process applies to the
  // bounds it captured then — incremental deltas would each be measured against the previous move's
  // result and drift.
  //
  // Nothing starts until the pointer has actually travelled: on the title bar the first thing a drag
  // does is come out of maximize, so starting on pointerdown made a plain CLICK restore the window.
  const GESTURE_SLACK = 4;

  function wireWindowGesture(handle: HTMLElement, edge: string, accepts: (event: PointerEvent) => boolean): void {
    handle.addEventListener('pointerdown', (event) => {
      if (!accepts(event)) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const downX = event.screenX;
      const downY = event.screenY;
      let originX = downX;
      let originY = downY;
      let started = false;
      // One setBounds per frame at most. A pointermove can fire far more often than the compositor
      // can place a window, and the backlog is what made a drag stutter between positions before
      // catching up at the end.
      let pending: { dx: number; dy: number } | null = null;
      let frame = 0;
      const flush = (): void => {
        frame = 0;
        if (!pending) return;
        window.claudeUi.resizeWindowBy(pending.dx, pending.dy);
        pending = null;
      };
      const move = (moved: PointerEvent): void => {
        if (!started) {
          if (Math.abs(moved.screenX - downX) < GESTURE_SLACK && Math.abs(moved.screenY - downY) < GESTURE_SLACK) return;
          started = true;
          // Measure from HERE, not from the pointerdown: coming out of maximize repositions the
          // window under the cursor, so the bounds the main process captures belong to this moment.
          originX = moved.screenX;
          originY = moved.screenY;
          window.claudeUi.startWindowResize(edge, { x: moved.screenX, y: moved.screenY });
          return;
        }
        pending = { dx: moved.screenX - originX, dy: moved.screenY - originY };
        if (!frame) frame = requestAnimationFrame(flush);
      };
      const up = (ended: PointerEvent): void => {
        handle.releasePointerCapture(ended.pointerId);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        if (!started) return;
        // The last move may still be queued for the next frame, and dropping it would leave the
        // window a few pixels from where the gesture ended.
        if (frame) cancelAnimationFrame(frame);
        flush();
        window.claudeUi.endWindowResize();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  wireWindowGesture(titlebar, 'move', onBarBackground);
  resizeEdges.hidden = false;
  // Every edge and corner is ours: Chromium offers a 4px margin on three sides and none at the top,
  // so a hand-built top edge alone would have behaved unlike its neighbours.
  for (const handle of document.querySelectorAll<HTMLElement>('.resize-edge')) {
    wireWindowGesture(handle, handle.dataset.edge ?? '', () => !windowMaximized);
  }
})();

installTooltips();
// The window's layout, drawn now so the first paint is already the window: the default layout until the file has been read, which the start-up below does before it draws a single row.
initTree({
  where: () => ({
    tab: activeTab ? { cwd: activeTab.session.cwd, repoRoot: activeTab.session.repoRoot, id: activeTab.session.id } : null,
    project: activeProject,
  }),
  showToast,
  hideToast,
  persist: persistUi,
});
// Restore the last-active project and open tabs, then scope the tab bar + terminal to that project.
void (async () => {
  groupState = await window.claudeUi.getGroupState();
  activeProject = await window.claudeUi.getActiveProject();
  // Before the first render: restoring filters afterwards would draw the whole list and then visibly cut it down.
  const scrollTop = await restoreUiState();
  // Before the rows and the tabs too: placing the layout moves the sidebar and the terminal area into it, and a move is cheapest, and invisible, while they are still empty.
  await loadLayout();
  await renderSessions();
  await restoreOpenTabs();
  // Again, now that the tabs exist. Two filters — open, and running — are questions about the TABS, and the render above happened while there were none, so a restored "open" filter would otherwise show an empty list next to a full tab bar. It also puts the open marker on the rows, which used to wait for the next render for its own reasons.
  renderList();
  // Last, because there is nothing to scroll until the rows are on screen. Later renders carry the offset along themselves.
  container.scrollTop = scrollTop;
  switchWorkspaceTerminal(activeProject);
  // After the tabs, so a panel's first run is in the restored tab's folder rather than once for the project and again for the tab.
  startPanels();
})();
updatePlaceholder();
