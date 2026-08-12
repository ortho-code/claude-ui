import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CanvasAddon } from '@xterm/addon-canvas';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { ClaudeUiApi, SessionSummary } from '../shared/types';
import {
  tipsByConversation,
  structuralSignature,
  groupByRepo,
  groupName,
  displayName,
  entityKey,
  reorderWithinGroup,
  relativeTime,
  modelLabel,
  sessionPasses,
  datePresetRange,
  foldersForSwitcher,
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
const worktreeFilter = document.getElementById('worktree-filter') as HTMLButtonElement;
const siblingFilter = document.getElementById('sibling-filter') as HTMLButtonElement;
const archivedFilter = document.getElementById('archived-filter') as HTMLButtonElement;
const filterToggle = document.getElementById('filter-toggle') as HTMLButtonElement;
const filterPanel = document.getElementById('filter-panel')!;
const datePresets = document.getElementById('date-presets')!;
const dateCustom = document.getElementById('date-custom')!;
const dateRangeLabel = document.getElementById('date-range-label')!; // persistent line under presets
const dateRangeCaption = document.getElementById('date-range-caption')!; // same text, inside calendar
const pad2 = (n: number): string => String(n).padStart(2, '0');
// Inline range calendar. Custom-rendered month/year views (click the header to zoom out to a months
// grid, then a years grid, arrows paging through) and no native <select>, so it behaves under WSLg.
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
const switcherEl = document.getElementById('folder-switcher')!;
const switcherCurrent = document.getElementById('switcher-current') as HTMLButtonElement;
const switcherName = document.getElementById('switcher-name')!;
const switcherBadge = document.getElementById('switcher-badge')!;
const switcherPopover = document.getElementById('switcher-popover')!;
const footerToggle = document.getElementById('footer-toggle')!;
const footerBadge = document.getElementById('footer-badge')!;
const footerLabel = document.getElementById('footer-label')!;
const footerList = document.getElementById('footer-list')!;

const FOLDER_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M2 4h4l1.5 1.5H14V13H2z"/></svg>';
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
function showToast(message: string): void {
  toastMessage.textContent = message;
  toast.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, 3000);
}
toastClose.addEventListener('click', hideToast);

// Stacking attention toasts: a background tab (one you're not viewing) went waiting/idle. Separate
// from the one-off #toast message bar above.
const notifications = document.getElementById('notifications')!;
const NOTIF_TTL = 5000;
const NOTIF_MAX = 4;

function showAttentionToast(tab: Tab, status: 'waiting' | 'idle'): void {
  const el = document.createElement('div');
  el.className = `notif ${status}`;
  const dot = document.createElement('span');
  dot.className = `folder-badge ${status}`;
  // The dot/edge colour already says waiting vs finished; the text names the tab and its project.
  const text = document.createElement('span');
  text.className = 'notif-text';
  const title = document.createElement('span');
  title.className = 'notif-title';
  title.textContent = tab.session.title || tab.session.firstMessage || tab.session.id.slice(0, 8);
  const proj = document.createElement('span');
  proj.className = 'notif-proj';
  proj.textContent = projName(tab.session.repoRoot);
  text.append(title, proj);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'notif-close';
  close.textContent = '×';
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

// A real transition into waiting/idle on a tab you're not looking at -> toast it. Never for busy, a
// cleared status, a no-op repeat, or the tab you're already on.
function maybeAttentionToast(id: string, status: string | undefined, prev: string | undefined): void {
  if ((status !== 'waiting' && status !== 'idle') || status === prev) return;
  const tab = tabs.find((t) => t.session.id === id);
  if (!tab || tab === activeTab) return;
  showAttentionToast(tab, status);
}

// Jump to a tab from a toast: scope to its project if we're viewing a different one, then activate it.
function jumpToTab(tab: Tab): void {
  if (activeFolder !== null && activeFolder !== tab.session.repoRoot) {
    selectFolder(tab.session.repoRoot);
  }
  activateTab(tab);
}

function setLoading(on: boolean): void {
  loadingEl.classList.toggle('active', on);
}

let pinned = new Set<string>();
let archived = new Map<string, number>();
let projectNames = new Map<string, string>(); // repoRoot -> user rename override
const projName = (repoRoot: string): string => displayName(repoRoot, projectNames);
// Conversations whose delete is in flight: hidden from the list until that delete resolves, so a
// concurrent delete's disk re-read can't briefly resurrect them.
const pendingDeletes = new Set<string>();
let statuses = new Map<string, string>();
// Session ids whose dot the user has marked "read": shown dimmed (no pulse) instead of the live
// colour. In-memory only, so a restart re-lights everything. Any incoming status event clears it.
const acked = new Set<string>();
let allSessions: SessionSummary[] = [];
let filterText = '';
let showPinnedOnly = false;
let showWorktreeOnly = false;
let showSiblingsOnly = false;
let showArchivedOnly = false;
// The project the switcher is scoped to; null = "All" (the grouped overview). In-memory for now;
// Phase 3 persists it.
let activeFolder: string | null = null;
// Date filter, as an inclusive [from, to] window in epoch ms; null means unbounded on that side.
let datePreset = 'any';
let dateFromMs: number | null = null;
let dateToMs: number | null = null;
// Structure of the last rendered list, so disk changes that only grow a transcript (new
// lastActivity/eventCount) don't trigger a rebuild — we re-render only on structural change.
let lastSignature = '';
// Status dots by tip session id; rebuilt each render (a status event names a session id).
const statusDots = new Map<string, HTMLElement>();
// Row elements by entity key (a sibling's own id, else conversationId), reused across renders so a
// re-render moves nodes instead of recreating them — no flicker, no scroll jump, hover/focus kept.
const sessionRows = new Map<string, HTMLElement>();
const collapsedGroups = new Set<string>();

interface GroupEls {
  section: HTMLElement;
  caret: HTMLElement;
  count: HTMLElement;
  label: HTMLElement;
  /** The new-session split-button's dropdown caret (present only for a folder group). */
  addCaret?: HTMLElement;
}
// Group sections by group name, reused across renders (same reason as sessionRows).
const groupSections = new Map<string, GroupEls>();
// The session each row currently shows, by entity key, so a reused row's click/pin handlers act on
// the live tip even after the conversation branches.
let currentTips = new Map<string, SessionSummary>();

function isOpen(id: string): boolean {
  return tabs.some((t) => t.session.id === id);
}

function updateSidebarHighlight(): void {
  for (const row of sessionRows.values()) {
    const id = row.dataset.sid ?? '';
    row.classList.toggle('open', isOpen(id));
    row.classList.toggle('active-session', activeTab?.session.id === id);
  }
}

// Keep open tabs' titles in sync with the freshly-read session list: a new session's first
// message / AI title, a rename, or a regenerated AI title all land here on the next read.
function reconcileOpenTabs(): void {
  const byId = new Map(allSessions.map((s) => [s.id, s]));
  let changed = false;
  for (const tab of tabs) {
    const fresh = byId.get(tab.session.id);
    if (!fresh) continue;
    if (fresh.title !== tab.session.title || fresh.firstMessage !== tab.session.firstMessage) {
      tab.session = fresh;
      changed = true;
    }
    if (fresh.title || fresh.firstMessage) tab.needsTitle = false;
  }
  if (changed) renderTabBar();
}

function setStatus(id: string, status: string | undefined): void {
  const prev = statuses.get(id);
  if (status) statuses.set(id, status);
  else statuses.delete(id);
  // A new status event is fresh activity: drop any "read" mark so the dot re-lights (and, for a
  // new waiting, re-pulses) even if the user had acked the previous state.
  acked.delete(id);
  renderStatusDot(id);
  refreshSwitcher(); // keep the folder roll-up badges live
  maybeAttentionToast(id, status, prev);
}

// Repaint a session's dot wherever it shows (sidebar row + open tab) from the current status/ack.
function renderStatusDot(id: string): void {
  const dot = statusDots.get(id);
  if (dot) applyStatus(dot, statuses.get(id), acked.has(id));
  if (tabs.some((t) => t.session.id === id)) renderTabBar();
}

// Toggle the "read" mark on a session's dot: mutes a live status (dimmed, no pulse) without
// closing the tab or replying. Only the attention states are ackable — idle (done) and waiting
// (needs you). Busy (working) and closed/hollow have nothing to acknowledge, so acking them is a
// no-op.
function toggleAck(id: string): void {
  const status = statuses.get(id);
  if (status !== 'idle' && status !== 'waiting') return;
  if (acked.has(id)) acked.delete(id);
  else acked.add(id);
  renderStatusDot(id);
  refreshSwitcher(); // an acked/un-acked session changes its folder's roll-up badge
}

// You've attended to a session by viewing it, so drop its "needs you" nudge.
function clearNudge(id: string): void {
  window.claudeUi.clearStatus(id);
  setStatus(id, undefined);
}

interface Tab {
  session: SessionSummary;
  terminalId: number;
  term: Terminal;
  fitAddon: FitAddon;
  el: HTMLElement;
  // Unique per terminal; the status hook echoes it so we can learn a new session's real id.
  token: string;
  // A new session has no title on disk yet; keep re-reading on status events until it does.
  needsTitle: boolean;
  // When claude was launched, to tell a real exit from a failed-to-start one.
  startedAt: number;
  // Bumped on each activation, so a workspace switch can restore a project's most-recent tab.
  activatedSeq: number;
}

const tabs: Tab[] = [];
let activeTab: Tab | null = null;
let activationSeq = 0;
let restoring = false;
// Set once the app is quitting. Shutdown kills every terminal, and each pty exit closes its tab; we
// must not let those closes persist an empty open-tabs list over the real one (it would wipe the
// tabs to restore next launch). Set via onQuitting, below.
let shuttingDown = false;

// Collapse sessions to one entry per conversation: the active tip (latest activity).
function persistOpenTabs(): void {
  if (restoring || shuttingDown) return;
  // Persist entity keys so a tab reopens on the current tip even if the conversation branched out of
  // band; a fork keys by its own id so it reopens as the fork, not its parent. Fall back to the
  // tab's own conversationId before it has reconciled to disk.
  const idToKey = new Map(allSessions.map((s) => [s.id, entityKey(s)]));
  window.claudeUi.setOpenSessions(tabs.map((t) => idToKey.get(t.session.id) ?? t.session.conversationId));
}

async function restoreOpenTabs(): Promise<void> {
  restoring = true;
  try {
    const [sessions, openKeys] = await Promise.all([
      window.claudeUi.listSessions(),
      window.claudeUi.getOpenSessions(),
    ]);
    const tips = tipsByConversation(sessions);
    for (const key of openKeys) {
      const session = tips.get(key);
      if (session) await openSession(session);
    }
  } finally {
    restoring = false;
    persistOpenTabs();
  }
}

// --- Sidebar ---

async function renderSessions(showLoading = true): Promise<void> {
  if (showLoading) setLoading(true);
  try {
    const [sessions, pinnedList, archivedList, statusMap, namesMap] = await Promise.all([
      window.claudeUi.listSessions(),
      window.claudeUi.getPinned(),
      window.claudeUi.getArchived(),
      window.claudeUi.getAllStatuses(),
      window.claudeUi.getProjectNames(),
    ]);
    allSessions = sessions;
    applyDatePickerMinDate();
    pinned = new Set(pinnedList);
    archived = new Map(Object.entries(archivedList));
    projectNames = new Map(Object.entries(namesMap));
    statuses = new Map(Object.entries(statusMap));
    lastSignature = structuralSignature(sessions);
    reconcileOpenTabs();
    renderList();
  } finally {
    if (showLoading) setLoading(false);
  }
}

// A disk change fired: re-read sessions but only re-render when the structure actually changed
// (a new/removed session, a rename, or a new branch becoming the tip). Statuses and pins arrive
// on their own channels, so we don't refetch them here.
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

// Any filter active? Used to auto-expand groups with matches and to show the filter status.
function isFiltering(): boolean {
  return filterText.length > 0 || showPinnedOnly || showWorktreeOnly || showSiblingsOnly || showArchivedOnly || datePreset !== 'any';
}

// Adapt the current filter state to the pure predicate.
function passesFilters(session: SessionSummary): boolean {
  return sessionPasses(session, {
    text: filterText,
    pinnedOnly: showPinnedOnly,
    worktreeOnly: showWorktreeOnly,
    siblingOnly: showSiblingsOnly,
    archivedOnly: showArchivedOnly,
    dateFrom: dateFromMs,
    dateTo: dateToMs,
    pinned,
    archived,
    pendingDeletes,
  });
}

// The custom-range calendar is an inline popover; its open state is independent of the active preset,
// so a picked range stays applied while the calendar is dismissed.
let datePopoverOpen = false;
function setDatePopover(open: boolean): void {
  datePopoverOpen = open;
  dateCustom.hidden = !open;
}

// Translate the date presets into the [from, to] window. Presets are rolling from now; custom reads
// the calendar selection.
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

// Bound the picker to real data: min = the oldest session's date (max stays today, set at
// construction). Runs whenever the session set changes; silent so it doesn't fire onSelect.
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
  worktreeFilter.classList.toggle('active', showWorktreeOnly);
  worktreeFilter.setAttribute('aria-pressed', String(showWorktreeOnly));
  siblingFilter.classList.toggle('active', showSiblingsOnly);
  siblingFilter.setAttribute('aria-pressed', String(showSiblingsOnly));
  archivedFilter.classList.toggle('active', showArchivedOnly);
  archivedFilter.setAttribute('aria-pressed', String(showArchivedOnly));
  // The toggle carries the accent when any filter is on, so an active filter is visible even
  // with the panel closed.
  filterToggle.classList.toggle('active', filtering);
  if (filtering) filterCount.textContent = `Showing ${matches} of ${total}`;
}

function clearFilter(): void {
  searchInput.value = '';
  filterText = '';
  showPinnedOnly = false;
  showWorktreeOnly = false;
  showSiblingsOnly = false;
  showArchivedOnly = false;
  suppressPickerSelect = true;
  datePicker.clear();
  suppressPickerSelect = false;
  applyDatePreset('any');
  renderList();
  container.scrollTop = 0;
}

// --- Folder switcher ---

// Update the switcher header + popover from the visible project pool. The pool is every project's
// tips (see renderList); the switcher is independent of search/folder so you can always navigate.
function renderSwitcher(pool: SessionSummary[]): void {
  const model = foldersForSwitcher(pool, statuses, acked, projectNames);
  const active = activeFolder ? model.folders.find((f) => f.repoRoot === activeFolder) : null;
  switcherName.textContent = active ? active.name : 'All';

  // Header nudge: the overall roll-up across ALL projects (incl. the active one and busy), so any
  // attention is visible at a glance even when scoped to a project or scrolled down a long list.
  const headerBadge = model.all.badge;
  switcherBadge.className = headerBadge ? `folder-badge ${headerBadge}` : 'folder-badge';
  switcherBadge.hidden = !headerBadge;
  setTooltip(switcherBadge, headerBadge ? `A project is ${headerBadge}` : null);

  switcherPopover.replaceChildren(
    switcherItem('All', null, model.all.count, null, activeFolder === null),
    ...model.folders.map((f) => switcherItem(f.name, f.repoRoot, f.count, f.badge, f.repoRoot === activeFolder)),
  );

  renderFooter(model, pool);
}

const NUDGE_ORDER: Record<'waiting' | 'idle' | 'busy', number> = { waiting: 0, idle: 1, busy: 2 };
let footerExpanded = false;

// A session's contribution to the roll-up: its live status, but an acked idle/waiting counts as
// nothing (muted), same rule as the switcher badges.
function sessionNudge(id: string): NudgeStatus {
  const st = statuses.get(id);
  if (st === 'waiting' || st === 'idle') return acked.has(id) ? null : st;
  if (st === 'busy') return 'busy';
  return null;
}

// Jump to a specific session from the footer: scope to its project if needed, then open/focus its tab.
function jumpToSession(session: SessionSummary): void {
  if (activeFolder !== null && activeFolder !== session.repoRoot) selectFolder(session.repoRoot);
  void openSession(session);
}

// A session's siblings (the other members of its family), most recent first. Shared by the count
// badge and the kebab submenu.
function siblingsOf(session: SessionSummary): SessionSummary[] {
  return allSessions
    .filter((s) => session.siblingIds.includes(s.id))
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
}

// Menu items for a sibling list; siblings often share a title, so each shows title + when.
function siblingMenuItems(siblings: SessionSummary[]): MenuItem[] {
  return siblings.map((sibling) => ({
    label: `${sibling.title || sibling.firstMessage || sibling.id.slice(0, 8)} · ${relativeTime(sibling.lastActivity)}`,
    onSelect: () => jumpToSession(sibling),
  }));
}

// List a session's siblings in the shared popover; click one to jump to it.
function openSiblingsMenu(anchor: HTMLElement, session: SessionSummary): void {
  const siblings = siblingsOf(session);
  // The mark can briefly outlive its siblings (a delete between refreshes); nothing to list then.
  if (siblings.length === 0) return;
  openMenu(anchor, siblingMenuItems(siblings));
}

// Cross-project attention strip in the sidebar footer. The toggle badge is the same overall roll-up
// as the switcher header; expanded, it lists the nudged SESSIONS grouped under their project (each a
// row: state dot + session title), click one to jump to it. Muted "all clear" when nothing pending.
function renderFooter(model: SwitcherModel, pool: SessionSummary[]): void {
  const overall = model.all.badge;
  footerBadge.className = overall ? `folder-badge ${overall}` : 'folder-badge';
  footerBadge.hidden = !overall;

  // Nudged sessions grouped by project; projects and sessions ordered attention-first.
  const groups = new Map<string, { name: string; items: { session: SessionSummary; badge: NudgeStatus }[] }>();
  for (const session of pool) {
    const badge = sessionNudge(session.id);
    if (!badge) continue;
    let group = groups.get(session.repoRoot);
    if (!group) {
      group = { name: projName(session.repoRoot), items: [] };
      groups.set(session.repoRoot, group);
    }
    group.items.push({ session, badge });
  }
  for (const group of groups.values()) {
    group.items.sort((a, b) => NUDGE_ORDER[a.badge!] - NUDGE_ORDER[b.badge!]);
  }
  const ordered = [...groups.values()].sort((a, b) => NUDGE_ORDER[a.items[0].badge!] - NUDGE_ORDER[b.items[0].badge!]);
  const total = ordered.reduce((n, g) => n + g.items.length, 0);

  if (total === 0) {
    footerExpanded = false;
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
    ...ordered.flatMap((group) => {
      const heading = document.createElement('div');
      heading.className = 'footer-group';
      heading.textContent = group.name;
      const rows = group.items.map(({ session, badge }) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'footer-item';
        const dot = document.createElement('span');
        dot.className = `folder-badge ${badge}`;
        const name = document.createElement('span');
        name.className = 'footer-item-name';
        name.textContent = session.title || session.firstMessage || session.id.slice(0, 8);
        row.append(dot, name);
        setTooltip(row, session.title || session.firstMessage || null);
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
  dot.className = badge ? `folder-badge ${badge}` : 'folder-badge';

  const cnt = document.createElement('span');
  cnt.className = 'switcher-item-count';
  cnt.textContent = String(count);

  btn.append(label, dot, cnt);
  btn.addEventListener('click', () => selectFolder(repoRoot));
  return btn;
}

function selectFolder(repoRoot: string | null): void {
  activeFolder = repoRoot;
  // Open a project expanded even if its folder was collapsed in the All view.
  if (repoRoot) collapsedGroups.delete(repoRoot);
  window.claudeUi.setActiveFolder(repoRoot);
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

// The sessions the sidebar can show: one tip per conversation, plus new-but-unsaved tabs (so a
// fresh session appears in its folder immediately, before it is written to disk).
function visibleSessions(): SessionSummary[] {
  const tips = tipsByConversation(allSessions);
  const knownIds = new Set(allSessions.map((s) => s.id));
  const pending = tabs.filter((t) => t.needsTitle && !knownIds.has(t.session.id)).map((t) => t.session);
  return [...pending, ...tips.values()];
}

// The switcher's project pool: every project's tips minus archived/pending-delete, independent of
// the search text and active folder so you can always navigate to any project.
function switcherPool(all: SessionSummary[]): SessionSummary[] {
  return all.filter((s) => !archived.has(entityKey(s)) && !pendingDeletes.has(entityKey(s)));
}

// Repaint just the switcher (header + popover badges) — used when a status/ack change should update
// the roll-up badges without re-rendering the whole list.
function refreshSwitcher(): void {
  renderSwitcher(switcherPool(visibleSessions()));
}

// Render from the cached session list, applying the current search filter. Keystrokes call
// this directly so filtering never re-reads disk. Reuses group/row nodes by key so a re-render
// moves elements into place instead of rebuilding the sidebar (no flicker, scroll stays put).
function renderList(): void {
  const scroll = container.scrollTop;
  statusDots.clear();

  // Include new sessions not yet written to disk (from their open tabs) so they appear in the
  // list immediately, in the right folder group; they reconcile to the real entry once created.
  const all = visibleSessions();
  currentTips = new Map(all.map((s) => [entityKey(s), s]));
  // The switcher lists every project, independent of search/folder, so you can always navigate. If
  // the active folder no longer has any sessions, fall back to All (and persist that).
  const pool = switcherPool(all);
  if (activeFolder && !pool.some((s) => s.repoRoot === activeFolder)) {
    activeFolder = null;
    window.claudeUi.setActiveFolder(null);
  }
  renderSwitcher(pool);

  const filtered = all.filter(passesFilters);
  // Folder scope applies in the normal view; the archived view shows all archived (ignores it).
  const scoped = activeFolder && !showArchivedOnly ? filtered.filter((s) => s.repoRoot === activeFolder) : filtered;
  updateFilterStatus(scoped.length, all.length);

  if (scoped.length === 0) {
    clearList();
    const message = document.createElement('div');
    message.className = 'empty-message';
    message.textContent = all.length === 0 ? 'No sessions found in ~/.claude/projects.' : 'No matches.';
    container.append(message);
    return;
  }
  container.querySelector(':scope > .empty-message')?.remove();

  // Pinned sessions float to the top of their group (a stable sort keeps activity order otherwise).
  const pinFirst = (a: SessionSummary, b: SessionSummary): number =>
    (pinned.has(entityKey(b)) ? 1 : 0) - (pinned.has(entityKey(a)) ? 1 : 0);

  // One group per repo. A specific project scopes `scoped` to that folder, so this yields its single
  // group (heading + "+" and all); "All" shows every project.
  const desired: DesiredGroup[] = [];
  for (const [repoRoot, list] of groupByRepo(scoped)) {
    list.sort(pinFirst);
    // A repo group can host worktree sessions; a plain-folder group can't (gates the split-button).
    desired.push({ name: repoRoot, folderCwd: repoRoot, sessions: list, isRepo: list.some((s) => s.isRepo) });
  }

  reconcileGroups(desired);
  pruneRows(new Set(scoped.map((s) => entityKey(s))));

  container.scrollTop = scroll;
  updateSidebarHighlight();
  reflowAllMeta();
}

// Meta shows on one row when it fits and wraps into its two groups (dropping the middle separator via
// CSS) when it doesn't. Overflow is width-dependent, so measure each visible row here and re-run
// whenever the sidebar is resized.
function reflowAllMeta(): void {
  for (const row of sessionRows.values()) {
    if (!row.isConnected) continue;
    const els = rowEls.get(row);
    if (!els || els.meta.classList.contains('solo')) continue;
    els.meta.classList.remove('stacked');
    if (els.meta.scrollWidth > els.meta.clientWidth) els.meta.classList.add('stacked');
  }
}

let reflowScheduled = false;
new ResizeObserver(() => {
  if (reflowScheduled) return;
  reflowScheduled = true;
  requestAnimationFrame(() => {
    reflowScheduled = false;
    reflowAllMeta();
  });
}).observe(container);

// Reset to a blank list: drop every cached node so the next non-empty render rebuilds fresh.
function clearList(): void {
  container.replaceChildren();
  sessionRows.clear();
  groupSections.clear();
  statusDots.clear();
}

interface DesiredGroup {
  name: string;
  folderCwd?: string;
  sessions: SessionSummary[];
  /** Whether the group's folder is a git repo (so it can offer worktree sessions). */
  isRepo?: boolean;
}

// Bring the group sections in line with `desired`: drop gone groups, create missing ones, and
// order both groups and their rows via appendChild (which moves an existing node into place).
function reconcileGroups(desired: DesiredGroup[]): void {
  const wanted = new Set(desired.map((g) => g.name));
  for (const [name, els] of groupSections) {
    if (!wanted.has(name)) {
      els.section.remove();
      groupSections.delete(name);
    }
  }
  for (const group of desired) {
    let els = groupSections.get(group.name);
    if (!els) {
      els = createGroup(group.name, group.folderCwd);
      groupSections.set(group.name, els);
    }
    // While filtering, force groups open so matches inside a collapsed group are visible; the
    // stored collapse state is left untouched, so it returns when the filter clears.
    const collapsed = !isFiltering() && collapsedGroups.has(group.name);
    els.section.classList.toggle('collapsed', collapsed);
    els.caret.textContent = collapsed ? '▸' : '▾';
    els.count.textContent = String(group.sessions.length);
    els.label.textContent = projName(group.name); // keep the heading name current (e.g. after a rename)
    if (els.addCaret) els.addCaret.hidden = !group.isRepo; // worktree option only for git-repo groups
    for (const session of group.sessions) {
      const row = getOrCreateRow(entityKey(session));
      updateRow(row, session);
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

// In-app confirm modal (a native dialog flickers under WSLg). Resolves true on Delete, false on
// Cancel / Esc / backdrop click.
function confirmDelete(title: string): Promise<boolean> {
  confirmMessage.textContent = `Delete "${title}"?`;
  confirmDetail.textContent = 'Its transcript files move to the trash, so you can restore them from there if needed.';
  confirmOverlay.hidden = false;
  // Focus Cancel, not Delete: safer default for a destructive action, and it keeps the accent
  // focus ring off the red button.
  confirmCancel.focus();
  return new Promise((resolve) => {
    const close = (result: boolean): void => {
      confirmOverlay.hidden = true;
      confirmOk.removeEventListener('click', onOk);
      confirmCancel.removeEventListener('click', onCancel);
      confirmOverlay.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onOk = (): void => close(true);
    const onCancel = (): void => close(false);
    const onBackdrop = (event: MouseEvent): void => {
      if (event.target === confirmOverlay) close(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close(false);
    };
    confirmOk.addEventListener('click', onOk);
    confirmCancel.addEventListener('click', onCancel);
    confirmOverlay.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
  });
}

// A small modal text prompt (Promise-resolving): OK/Enter resolves the value, Cancel/Esc/backdrop
// resolves null. Shared by project rename, fork naming, and worktree naming; okLabel names the
// confirm button. An optional async `validate` runs on submit: return an error string to show it
// inline and keep the dialog open (so the user can fix the value), or null to accept.
function promptText(
  title: string,
  context: string,
  initialValue: string,
  okLabel = 'Save',
  validate?: (value: string) => Promise<string | null> | string | null,
): Promise<string | null> {
  renameTitle.textContent = title;
  renamePath.textContent = context;
  renamePath.hidden = !context; // no empty context line (e.g. the fork dialog puts it in the title)
  renameError.hidden = true;
  renameOk.textContent = okLabel;
  renameInput.value = initialValue;
  renameOverlay.hidden = false;
  renameInput.focus();
  renameInput.select();
  return new Promise((resolve) => {
    const close = (result: string | null): void => {
      renameOverlay.hidden = true;
      renameOk.removeEventListener('click', onOk);
      renameCancel.removeEventListener('click', onCancel);
      renameOverlay.removeEventListener('click', onBackdrop);
      renameInput.removeEventListener('keydown', onKey);
      resolve(result);
    };
    // Validate before accepting; on an error, show it inline and leave the dialog open.
    const submit = async (): Promise<void> => {
      const value = renameInput.value;
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
    const onBackdrop = (event: MouseEvent): void => {
      if (event.target === renameOverlay) close(null);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Enter') void submit();
      else if (event.key === 'Escape') close(null);
    };
    renameOk.addEventListener('click', onOk);
    renameCancel.addEventListener('click', onCancel);
    renameOverlay.addEventListener('click', onBackdrop);
    renameInput.addEventListener('keydown', onKey);
  });
}

async function renameProject(repoRoot: string): Promise<void> {
  const name = await promptText('Rename project', repoRoot, projName(repoRoot));
  if (name === null) return;
  // Typing the folder name back clears the override rather than storing a redundant one.
  const canonical = name.trim() === groupName(repoRoot) ? '' : name;
  projectNames = new Map(Object.entries(await window.claudeUi.setProjectName(repoRoot, canonical)));
  renderList();
  renderTabBar();
}

// A small floating kebab menu, generic over its items so the group-heading and session-row kebabs
// share the open/close/outside-click machinery. An item may carry a `submenu`: it then opens a child
// list on hover (one level deep) instead of running an action.
interface MenuItem {
  label: string;
  onSelect?: () => void;
  submenu?: MenuItem[];
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
  // A click on the trigger itself is left to its own handler (which toggles the menu shut); closing
  // here too would close-then-reopen and the menu would never toggle off. A click inside the open
  // submenu counts as inside too, so it isn't dismissed before its own handler runs.
  if (
    openMenuEl &&
    !openMenuEl.contains(target) &&
    !openSubmenuEl?.contains(target) &&
    !openMenuAnchor?.contains(target)
  )
    closeMenu();
}

// Render `items` as buttons into `menu`. A leaf runs its onSelect and closes everything; a
// submenu-parent opens its child list on hover (and on click, for non-hover input). `isRoot` marks
// the top menu: only its leaves close an open submenu on hover — a submenu's own leaves must not,
// or hovering toward them would close the very submenu being reached for.
function fillMenu(menu: HTMLElement, items: MenuItem[], isRoot: boolean): void {
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = item.label;
    if (item.submenu) {
      button.className = 'has-submenu';
      const chev = document.createElement('span');
      chev.className = 'submenu-chev';
      chev.textContent = '▸';
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
  const left = r.right + menu.offsetWidth + 8 > window.innerWidth ? r.left - menu.offsetWidth - 4 : r.right + 4;
  menu.style.top = `${Math.max(8, Math.min(r.top, window.innerHeight - menu.offsetHeight - 8))}px`;
  menu.style.left = `${Math.max(8, left)}px`;
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
  menu.className = 'kebab-menu';
  fillMenu(menu, items, true);
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 4}px`;
  menu.style.left = `${Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
  openMenuEl = menu;
  openMenuAnchor = anchor;
  anchor.classList.add('menu-open'); // trigger shows an open/active state while its menu is up
  // Defer so the click that opened it doesn't immediately close it.
  setTimeout(() => document.addEventListener('click', onMenuOutside, true));
}

// Reveal a session's row in the sidebar (expanding its group if collapsed), so clicking a tab
// scrolls to where it lives and shows which group it belongs to.
function revealSessionInSidebar(session: SessionSummary): void {
  if (collapsedGroups.has(session.repoRoot)) {
    collapsedGroups.delete(session.repoRoot);
    renderList();
  }
  const row = sessionRows.get(entityKey(session));
  if (!row) return;
  // Scroll only the sidebar list (scrollIntoView would also scroll the page and shift the whole
  // app). Land the row just below the sticky heading.
  const headingOffset = 44;
  container.scrollTop += row.getBoundingClientRect().top - container.getBoundingClientRect().top - headingOffset;
}

// Scroll the (All-view) session list to a project's folder heading — used by the project name in the
// tab bar, so it links to where that project's sessions live.
function revealFolderInSidebar(repoRoot: string): void {
  if (collapsedGroups.has(repoRoot)) {
    collapsedGroups.delete(repoRoot);
    renderList();
  }
  const els = groupSections.get(repoRoot);
  if (!els) return;
  container.scrollTop += els.section.getBoundingClientRect().top - container.getBoundingClientRect().top;
}

// Build a group section once; contents (count, caret, rows) are updated on later renders.
function createGroup(name: string, folderCwd?: string): GroupEls {
  const section = document.createElement('section');
  section.className = 'group';

  const heading = document.createElement('h2');
  const caret = document.createElement('span');
  caret.className = 'caret';
  const icon = document.createElement('span');
  icon.className = 'group-icon';
  icon.innerHTML = FOLDER_ICON;
  const label = document.createElement('span');
  label.className = 'label';
  setTooltip(label, name); // full path on hover
  label.textContent = projName(name);
  const count = document.createElement('span');
  count.className = 'group-count';
  heading.append(caret, icon, label, count);
  let addCaret: HTMLElement | undefined;
  if (folderCwd) {
    // Split button: the "+" is one-click "New session"; the caret opens a dropdown with worktree
    // options. reconcileGroups shows the caret only for git-repo groups.
    const split = document.createElement('div');
    split.className = 'split-button';
    const add = document.createElement('button');
    add.className = 'group-add';
    add.textContent = '+';
    setTooltip(add, 'New session in this folder');
    add.addEventListener('click', (event) => {
      event.stopPropagation();
      void openNewSession(folderCwd);
    });
    const caret = document.createElement('button');
    caret.className = 'group-add-caret';
    caret.textContent = '▾';
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
  kebab.className = 'group-kebab';
  kebab.textContent = '⋮';
  setTooltip(kebab, 'Project options');
  kebab.addEventListener('click', (event) => {
    event.stopPropagation();
    openMenu(kebab, [{ label: 'Rename…', onSelect: () => void renameProject(name) }]);
  });
  heading.append(kebab);
  // Toggle in place (CSS hides the rows) so the sidebar doesn't rebuild and flicker. Keep the
  // clicked heading anchored: a sticky heading otherwise snaps between stuck and natural
  // position as its rows appear/disappear, which reads as a jump.
  heading.addEventListener('click', () => {
    const before = heading.getBoundingClientRect().top;
    const collapsed = !collapsedGroups.has(name);
    if (collapsed) collapsedGroups.add(name);
    else collapsedGroups.delete(name);
    section.classList.toggle('collapsed', collapsed);
    caret.textContent = collapsed ? '▸' : '▾';
    container.scrollTop += heading.getBoundingClientRect().top - before;
  });
  section.appendChild(heading);

  return { section, caret, count, label, addCaret };
}

function getOrCreateRow(key: string): HTMLElement {
  const existing = sessionRows.get(key);
  if (existing) return existing;
  const row = createSessionRow(key);
  sessionRows.set(key, row);
  return row;
}

// A box with a slot (put away) vs a box with an up-arrow (take back out).
const ARCHIVE_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><rect x="2" y="3" width="12" height="3" /><path d="M3 6v7h10V6" /><line x1="6.5" y1="9" x2="9.5" y2="9" stroke-linecap="round" /></svg>';
const UNARCHIVE_ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>';

interface RowEls {
  dot: HTMLElement;
  title: HTMLElement;
  badge: HTMLElement;
  siblingsBadge: HTMLElement;
  meta: HTMLElement;
  metaWhen: HTMLElement;
  metaStats: HTMLElement;
  pin: HTMLButtonElement;
  archiveBtn: HTMLButtonElement;
  deleteBtn: HTMLButtonElement;
  kebab: HTMLButtonElement;
}
// Each row's child elements, cached so updateRow reads them directly instead of re-querying the
// DOM every render (same idea as the session summary cache, applied to rendering).
const rowEls = new WeakMap<HTMLElement, RowEls>();

// Build a row once. Its click/pin handlers read the live tip from `currentTips` by the entity key
// (a sibling's own id, else the conversationId), so a reused row stays correct after it branches.
function createSessionRow(key: string): HTMLElement {
  const item = document.createElement('article');
  item.className = 'session';
  item.dataset.cid = key;

  const dot = document.createElement('span');
  // Click the dot to toggle "read": mute a done/waiting session without opening or replying to it.
  dot.addEventListener('click', (event) => {
    event.stopPropagation();
    const session = currentTips.get(key);
    if (session) toggleAck(session.id);
  });
  const content = document.createElement('div');
  content.className = 'session-content';
  const title = document.createElement('p');
  title.className = 'session-title';
  const badge = document.createElement('span');
  badge.className = 'worktree-badge';
  badge.hidden = true;
  // A family member's mark: `⑂ N` counts its siblings and opens a list of them to jump into. Shown
  // only when session.isSibling (set in updateRow).
  const siblingsBadge = document.createElement('span');
  siblingsBadge.className = 'fork-badge forks-count';
  siblingsBadge.hidden = true;
  siblingsBadge.addEventListener('click', (event) => {
    event.stopPropagation();
    const session = currentTips.get(key);
    if (session) openSiblingsMenu(siblingsBadge, session);
  });
  const meta = document.createElement('p');
  meta.className = 'session-meta';
  // Two logical groups (when · model / events · id) plus a separator that CSS hides when the meta
  // wraps to two lines (see reflowMeta). One line when it fits, two grouped lines when it doesn't.
  const metaWhen = document.createElement('span');
  metaWhen.className = 'meta-when';
  const metaSep = document.createElement('span');
  metaSep.className = 'meta-sep';
  metaSep.textContent = ' · ';
  const metaStats = document.createElement('span');
  metaStats.className = 'meta-stats';
  meta.append(metaWhen, metaSep, metaStats);
  content.append(title, badge, siblingsBadge, meta);

  const pin = document.createElement('button');
  pin.className = 'pin';
  pin.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (pin.disabled) return;
    pin.disabled = true;
    pin.classList.add('loading');
    pinned = new Set(await window.claudeUi.togglePin(key));
    renderList();
  });

  const archiveBtn = document.createElement('button');
  archiveBtn.className = 'archive-btn';
  archiveBtn.addEventListener('click', async (event) => {
    event.stopPropagation();
    archived = new Map(Object.entries(await window.claudeUi.toggleArchive(key)));
    // Archiving puts the session away, so close any open tab for it (unarchive leaves tabs alone).
    if (archived.has(key)) {
      for (const tab of [...tabs]) if (entityKey(tab.session) === key) closeTab(tab);
    }
    renderList();
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
    const session = currentTips.get(key);
    const title = session?.title || session?.firstMessage || key.slice(0, 8);
    if (!(await confirmDelete(title))) return;
    // Delete only this entity's files: a sibling is its own file; a lone conversation may span
    // same-conversationId files (same entityKey). Siblings are separate entities and stay untouched.
    const ids = allSessions.filter((s) => entityKey(s) === key).map((s) => s.id);
    // Hide it right away so deletion feels instant; trashing files (slow under WSL) and the meta
    // purge run in the background. It stays hidden via pendingDeletes until its files are gone
    // from disk (see renderSessions), so a concurrent delete's re-read can't resurrect it.
    pendingDeletes.add(key);
    renderList();
    try {
      // Guard against a delete that never settles (e.g. a hung OS-trash call): after 30s treat
      // it as failed so the row can't stay hidden forever within a session.
      await Promise.race([
        window.claudeUi.deleteConversation({ conversationId: key, ids }),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('delete timed out')), 30_000)),
      ]);
    } catch {
      showToast(`Couldn't delete "${title}". It's still here.`);
    } finally {
      // Stop hiding once this delete resolves: on success the re-read finds it gone; on failure
      // the file is still on disk, so the row reappears.
      pendingDeletes.delete(key);
      await renderSessions(false);
    }
  });

  // Per-session actions menu: fork this session, and (for a family member) list its siblings.
  const kebab = document.createElement('button');
  kebab.className = 'session-kebab';
  kebab.textContent = '⋮';
  setTooltip(kebab, 'Session options');
  kebab.addEventListener('click', (event) => {
    event.stopPropagation();
    const session = currentTips.get(key);
    if (!session) return;
    const items: MenuItem[] = [{ label: 'Fork this session', onSelect: () => { void forkSession(session); } }];
    const siblings = siblingsOf(session);
    if (siblings.length > 0) {
      items.push({ label: `Siblings (${siblings.length})`, submenu: siblingMenuItems(siblings) });
    }
    openMenu(kebab, items);
  });

  item.append(dot, content, pin, archiveBtn, deleteBtn, kebab);
  rowEls.set(item, { dot, title, badge, siblingsBadge, meta, metaWhen, metaStats, pin, archiveBtn, deleteBtn, kebab });
  item.addEventListener('click', () => {
    // Archived sessions are inert: manage them (unarchive/delete), don't resume them.
    if (showArchivedOnly) return;
    const session = currentTips.get(key);
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

  els.title.textContent = session.title || session.firstMessage || '(no prompt yet)';
  setTooltip(els.title, session.title || session.firstMessage || null);

  els.badge.hidden = !session.worktree;
  if (session.worktree) {
    // The glyph sits in its own span so .wt-icon can size the heavier ⎇ down to match the fork badge.
    const wtIcon = document.createElement('span');
    wtIcon.className = 'wt-icon';
    wtIcon.textContent = '⎇';
    els.badge.replaceChildren(wtIcon, document.createTextNode(' worktree'));
    setTooltip(els.badge, `Linked git worktree: ${session.worktree}`);
  }

  els.siblingsBadge.hidden = !session.isSibling;
  if (session.isSibling) {
    const count = session.siblingIds.length;
    els.siblingsBadge.textContent = `⑂ ${count}`;
    const label = count === 1 ? '1 sibling' : `${count} siblings`;
    setTooltip(els.siblingsBadge, `${label} in this session's family — click to list them`);
  }

  if (showArchivedOnly) {
    const ts = archived.get(entityKey(session));
    els.metaWhen.textContent = ts ? `archived ${relativeTime(new Date(ts).toISOString())}` : 'archived';
    els.metaStats.textContent = '';
    els.meta.classList.add('solo'); // one group only: no separator, never stacks
    els.meta.classList.remove('stacked');
  } else {
    const model = modelLabel(session.model);
    const when = relativeTime(session.lastActivity);
    els.metaWhen.textContent = model ? `${when} · ${model}` : when;
    els.metaStats.textContent = `${session.eventCount} events · ${session.id.slice(0, 8)}`;
    els.meta.classList.remove('solo');
  }

  // The archived view is a management view: no pinning, and delete replaces it there.
  const isPinned = pinned.has(entityKey(session));
  els.pin.textContent = isPinned ? '★' : '☆';
  setTooltip(els.pin, isPinned ? 'Unpin' : 'Pin');
  els.pin.disabled = false;
  els.pin.classList.remove('loading');
  els.pin.hidden = showArchivedOnly;

  setTooltip(els.archiveBtn, showArchivedOnly ? 'Unarchive' : 'Archive');
  els.archiveBtn.innerHTML = showArchivedOnly ? UNARCHIVE_ICON : ARCHIVE_ICON;
  els.deleteBtn.hidden = !showArchivedOnly;
  // The kebab (fork actions) is a normal-view affordance; the archived view is manage-only.
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

// Start a brand-new claude session in `cwd`. It has no real id until claude creates it, so
// the tab uses a placeholder; the real session appears in the sidebar on the next refresh.
async function openNewSession(cwd: string): Promise<void> {
  const folder = cwd.split('/').filter(Boolean).pop() ?? cwd;
  const id = `new-${Date.now()}-${newSessionCounter++}`;
  const session: SessionSummary = {
    id,
    conversationId: id,
    cwd,
    repoRoot: cwd,
    isRepo: false,
    worktree: '',
    title: `New: ${folder}`,
    firstMessage: '',
    model: '',
    lastActivity: new Date().toISOString(),
    eventCount: 0,
    isSibling: false,
    siblingIds: [],
    postCompactHeads: [],
  };
  // Land where the new session's tab will be visible: stay in its own project, else drop to All.
  if (activeFolder !== null && session.repoRoot !== activeFolder) {
    activeFolder = null;
    window.claudeUi.setActiveFolder(null);
  }
  await createTab(session, undefined);
  renderList();
}

// Start a new session in a fresh git worktree of `repoRoot`: `claude -w [name]`. Prompts for an
// optional name (blank -> claude auto-names). Like openNewSession, the tab starts on a placeholder
// and adopts the real id via its token; the worktree session appears (badged) on the next refresh.
async function openWorktreeSession(repoRoot: string): Promise<void> {
  const folder = repoRoot.split('/').filter(Boolean).pop() ?? repoRoot;
  // claude's `-w` name must be a slug (letters/digits/dots/underscores/dashes); turn the free-text
  // label into one. A blank slug means auto-name, which can't collide.
  const slugify = (value: string): string => value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  const label = await promptText(
    'New worktree session',
    `Worktree of "${projName(repoRoot)}"`,
    '',
    'Create',
    // Validate in the dialog so a duplicate name is caught without closing it — claude -w would
    // otherwise silently switch to the existing worktree instead of creating one.
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
  const id = `new-${Date.now()}-${newSessionCounter++}`;
  const session: SessionSummary = {
    id,
    conversationId: id,
    cwd: repoRoot,
    repoRoot,
    isRepo: true,
    // Show the worktree badge right away (optimistic); it reconciles to the real name on refresh.
    worktree: slug || 'new worktree',
    // The name you typed becomes the title (it's also what --name sets); the badge already says it's
    // a worktree, so no prefix. Blank name falls back to a plain new-session label.
    title: friendly || `New: ${folder}`,
    firstMessage: '',
    model: '',
    lastActivity: new Date().toISOString(),
    eventCount: 0,
    isSibling: false,
    siblingIds: [],
    postCompactHeads: [],
  };
  if (activeFolder !== null && session.repoRoot !== activeFolder) {
    activeFolder = null;
    window.claudeUi.setActiveFolder(null);
  }
  await createTab(session, undefined, false, friendly || undefined, slug);
  renderList();
}

// Fork an existing session: `claude --resume <id> --fork-session` copies its transcript into a new
// session in the same cwd. Like openNewSession, the tab starts on a placeholder and adopts the real
// fork id via its token; the fork then appears in the sidebar (as a sibling) on the next disk refresh.
async function forkSession(parent: SessionSummary): Promise<void> {
  const parentTitle = parent.title || parent.firstMessage || 'session';
  // Forks copy the parent's title, so offer a fresh name up front (via claude's --name). Cancel
  // aborts the fork; keeping/clearing the field just inherits the parent title.
  const name = await promptText('Create fork', `Fork from "${parentTitle}"`, parentTitle, 'Fork');
  if (name === null) return;
  const trimmed = name.trim();
  const id = `new-${Date.now()}-${newSessionCounter++}`;
  const session: SessionSummary = {
    id,
    conversationId: id,
    cwd: parent.cwd,
    repoRoot: parent.repoRoot,
    isRepo: parent.isRepo,
    worktree: parent.worktree,
    title: trimmed || parentTitle,
    firstMessage: '',
    model: '',
    lastActivity: new Date().toISOString(),
    eventCount: 0,
    // Mark the placeholder as a family member right away (we know its parent is a sibling), so the
    // row shows the sibling mark immediately instead of waiting for claude to write the transcript.
    // It reconciles to the real row once that file lands and grouping runs on the next refresh.
    isSibling: true,
    siblingIds: [parent.id],
    postCompactHeads: [],
  };
  // Land where the fork's tab will be visible: stay in its project, else drop to All.
  if (activeFolder !== null && session.repoRoot !== activeFolder) {
    activeFolder = null;
    window.claudeUi.setActiveFolder(null);
  }
  await createTab(session, parent.id, true, trimmed || undefined);
  renderList();
}

async function createTab(session: SessionSummary, resumeId: string | undefined, fork = false, name?: string, worktree?: string): Promise<void> {
  const token = crypto.randomUUID();
  const terminalId = await window.claudeUi.startTerminal(session.cwd, resumeId, token, fork, name, worktree);

  const el = document.createElement('div');
  el.className = 'term';
  terminalsEl.appendChild(el);

  const term = new Terminal({
    fontFamily: 'monospace',
    fontSize: 13,
    // Neutral (hue-less) default foreground: claude's selected-item accent is a periwinkle, so a
    // neutral grey fg makes it pop by HUE (the old lavender-white #cdd6f4 shared its hue and merged).
    // The fix was the hue, not the brightness, so it can be a light near-white for comfortable
    // reading. The select-menu contrast bug (28a); proper per-user terminal colours are item 28.
    theme: { background: '#11111b', foreground: '#d8d8d8' },
  });
  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(el);

  // Canvas renderer for smoother scrolling/paste than the default DOM renderer; fall back to DOM
  // if it can't initialize (e.g. a WSLg GPU quirk) so the terminal always works.
  try {
    term.loadAddon(new CanvasAddon());
  } catch {
    // DOM renderer stays in place.
  }

  // Make http(s) URLs clickable; open them in the OS browser via the main process.
  term.loadAddon(new WebLinksAddon((_event, uri) => window.claudeUi.openExternal(uri)));

  // Ctrl+Enter and Shift+Enter insert a newline (send \n, which claude reads as a newline) rather
  // than submitting — matching the terminal (Ctrl+Enter) and Claude Desktop (Shift+Enter) habits.
  // Plain Enter still submits; Ctrl+J and Alt+Enter already produce \n on their own.
  term.attachCustomKeyEventHandler((event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.shiftKey)) {
      // Send the newline once (on keydown), and swallow BOTH keydown and keypress so xterm never
      // turns the accompanying keypress into a submit \r. Shift+Enter emits that keypress (Ctrl+
      // Enter does not), which is why only Shift+Enter was flaky.
      if (event.type === 'keydown') window.claudeUi.sendTerminalInput(terminalId, '\n');
      return false;
    }
    return true;
  });

  const tab: Tab = {
    session,
    terminalId,
    term,
    fitAddon,
    el,
    token,
    // A fork mints a NEW session id despite resuming one, so it also needs to adopt its real id via
    // the token (like a fresh session) — a plain resume already carries its final id.
    needsTitle: resumeId === undefined || fork,
    startedAt: Date.now(),
    activatedSeq: 0,
  };

  // Ctrl-C twice in the terminal closes the tab instead of dropping to the leftover shell.
  let lastCtrlC = 0;
  term.onData((data) => {
    // Swallow Ctrl+Z: claude binds it to self-suspend, which strands the tab (no shell prompt to
    // `fg` back from). You background a session by switching tabs, so suspend has no use here.
    // claude advertises the key, so a silent no-op is confusing — say why.
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
    window.claudeUi.sendTerminalInput(terminalId, data);
  });

  tabs.push(tab);
  activateTab(tab);
  persistOpenTabs();
}

function activateTab(tab: Tab): void {
  // Viewing a tab no longer clears its nudge: a waiting dot persists until you actually reply
  // (submitting fires UserPromptSubmit -> busy) or you mark it read by clicking the dot.
  tab.activatedSeq = ++activationSeq;
  activeTab = tab;
  for (const other of tabs) other.el.classList.toggle('active', other === tab);
  renderTabBar();
  updatePlaceholder();
  updateSidebarHighlight();
  tab.fitAddon.fit();
  window.claudeUi.resizeTerminal(tab.terminalId, tab.term.cols, tab.term.rows);
  tab.term.focus();
}

// Full workspace switch: bring the active terminal in line with the current scope (a project, or
// All). Keeps the current tab if it's in scope; otherwise activates the scope's most-recent tab, or
// clears the terminal if the scope has no open tabs. Always re-renders the (filtered) tab bar.
function switchWorkspaceTerminal(repoRoot: string | null): void {
  const scoped = repoRoot ? tabs.filter((t) => t.session.repoRoot === repoRoot) : tabs;
  if (!(activeTab && scoped.includes(activeTab))) {
    const target = scoped.length
      ? scoped.reduce((best, t) => (t.activatedSeq > best.activatedSeq ? t : best))
      : null;
    if (target) {
      activateTab(target);
      return;
    }
    activeTab = null;
    for (const t of tabs) t.el.classList.remove('active');
  }
  renderTabBar();
  updatePlaceholder();
  updateSidebarHighlight();
}

// Drop a tab from the UI. Idempotent (a user close and the terminal's own exit can both fire).
// It does not touch the terminal process; callers terminate it when they need to.
function removeTab(tab: Tab): void {
  const index = tabs.indexOf(tab);
  if (index === -1) return;
  clearNudge(tab.session.id);
  tab.term.dispose();
  tab.el.remove();
  tabs.splice(index, 1);
  if (activeTab === tab) activeTab = null;
  // Re-establish the active tab within the current workspace scope (or clear); this re-renders too.
  switchWorkspaceTerminal(activeFolder);
  persistOpenTabs();
}

// User-initiated close: terminate the session (claude persists per turn, so its context is on
// disk) and drop the tab. closeTerminal sends Ctrl-C twice to exit claude cleanly, then kills it.
function closeTab(tab: Tab): void {
  window.claudeUi.closeTerminal(tab.terminalId);
  removeTab(tab);
}

function renderTabBar(): void {
  // A project view shows only that project's tabs; All shows every tab, grouped by project with a
  // muted label + divider before each group (grouped only in the render; tab order is unchanged).
  const shown = activeFolder ? tabs.filter((t) => t.session.repoRoot === activeFolder) : tabs;
  if (activeFolder) {
    tabbar.replaceChildren(...shown.map(tabElement));
    initTabSortables();
    return;
  }
  const byRoot = new Map<string, Tab[]>();
  const rootOrder: string[] = [];
  for (const tab of shown) {
    let group = byRoot.get(tab.session.repoRoot);
    if (!group) {
      group = [];
      byRoot.set(tab.session.repoRoot, group);
      rootOrder.push(tab.session.repoRoot);
    }
    group.push(tab);
  }
  const children: HTMLElement[] = [];
  for (const root of rootOrder) {
    const group = document.createElement('div');
    group.className = 'tab-group';
    const label = document.createElement('span');
    label.className = 'tab-group-label';
    label.textContent = projName(root);
    setTooltip(label, root);
    label.addEventListener('click', () => revealFolderInSidebar(root));
    group.append(label, ...byRoot.get(root)!.map(tabElement));
    children.push(group);
  }
  tabbar.replaceChildren(...children);
  initTabSortables();
}

function tabElement(tab: Tab): HTMLElement {
  const el = document.createElement('div');
  el.className = tab === activeTab ? 'tab active' : 'tab';

  const dot = document.createElement('span');
  applyStatus(dot, statuses.get(tab.session.id), acked.has(tab.session.id));
  // Toggle "read" from the tab too; stopPropagation so it doesn't also switch tabs.
  dot.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleAck(tab.session.id);
  });

  // Siblings often share a title, so mark the tab too — keyed on isSibling, the same signal as the
  // sidebar row's badge, so tab and row always agree.
  const siblingMark = document.createElement('span');
  siblingMark.className = 'tab-fork';
  siblingMark.textContent = '⑂';
  if (tab.session.isSibling) {
    const count = tab.session.siblingIds.length;
    setTooltip(siblingMark, `Has ${count} ${count === 1 ? 'sibling' : 'siblings'} in its session family`);
  }

  // A worktree session's tab gets the same ⎇ marker as its sidebar badge.
  const worktreeMark = document.createElement('span');
  worktreeMark.className = 'tab-worktree';
  worktreeMark.textContent = '⎇';
  if (tab.session.worktree) setTooltip(worktreeMark, `Linked git worktree: ${tab.session.worktree}`);

  const label = document.createElement('span');
  label.className = 'tab-label';
  const text = tab.session.title || tab.session.firstMessage || tab.session.id.slice(0, 8);
  label.textContent = text;
  setTooltip(label, `${projName(tab.session.repoRoot)} · ${text}`);

  const close = document.createElement('button');
  close.className = 'tab-close';
  close.textContent = '×';
  setTooltip(close, 'Close tab');
  close.addEventListener('click', (event) => {
    event.stopPropagation();
    closeTab(tab);
  });

  el.dataset.sid = tab.session.id; // used by the Sortable onEnd to find the moved tab
  const marks = [...(tab.session.isSibling ? [siblingMark] : []), ...(tab.session.worktree ? [worktreeMark] : [])];
  el.append(dot, ...marks, label, close);
  el.addEventListener('click', () => {
    activateTab(tab);
    revealSessionInSidebar(tab.session);
  });
  el.addEventListener('mousedown', (event) => {
    if (event.button === 1) {
      event.preventDefault();
      closeTab(tab);
    }
  });
  return el;
}

// Drag-to-reorder tabs via SortableJS. One Sortable per project container (the whole tab bar in a
// project view, each .tab-group in All), so a drag stays within its project by construction.
// forceFallback uses pointer-based dragging instead of native HTML5 DnD (flaky under WSLg). Re-created
// on every renderTabBar since it rebuilds the DOM; old instances destroyed first to avoid leaks.
let tabSortables: Sortable[] = [];
let tabDragActive = false;

function initTabSortables(): void {
  for (const s of tabSortables) s.destroy();
  const containers = activeFolder ? [tabbar] : [...tabbar.querySelectorAll<HTMLElement>('.tab-group')];
  tabSortables = containers.map((container) =>
    Sortable.create(container, {
      draggable: '.tab', // never the group label
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
        // Index among the destination's tabs (ignores the group label), mapped onto the tabs array.
        const newIndex = [...(evt.to as HTMLElement).querySelectorAll<HTMLElement>('.tab')].indexOf(el);
        if (!moved || newIndex < 0) return;
        tabs.splice(0, tabs.length, ...reorderWithinGroup(tabs, (t) => t.session.repoRoot, moved, newIndex));
        persistOpenTabs();
      },
    }),
  );
}

// Alt-tabbing away mid-drag never delivers a pointerup, so SortableJS can leave a drag stuck. On blur,
// synthesise the release so it ends cleanly (dropping the tab where it currently is).
window.addEventListener('blur', () => {
  if (!tabDragActive) return;
  document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
});

function updatePlaceholder(): void {
  placeholder.style.display = activeTab ? 'none' : 'flex';
}

// --- Wiring ---

window.claudeUi.onTerminalData((id, data) => {
  const tab = tabs.find((t) => t.terminalId === id);
  if (tab) tab.term.write(data);
});
window.claudeUi.onTerminalExit((id, exitCode) => {
  const tab = tabs.find((t) => t.terminalId === id);
  if (!tab) return; // Already closed by the user.
  // A near-instant exit almost always means claude failed to start (bad env, not found, rc
  // error). Keep the tab so the error stays visible instead of flashing away. Otherwise claude
  // exited normally, so close the tab — no leftover shell.
  if (Date.now() - tab.startedAt < 1500) {
    tab.term.writeln(`\r\n[claude exited immediately (code ${exitCode}) — the session did not start]`);
    return;
  }
  removeTab(tab);
});
window.claudeUi.onSessionStatus((id, status, tab) => {
  // A new-session tab learns its real session id the first time claude reports for it, so it
  // then matches the sidebar entry (clicking it focuses the tab instead of opening a duplicate).
  if (tab) {
    const owner = tabs.find((t) => t.token === tab);
    if (owner && owner.session.id !== id) {
      owner.session = { ...owner.session, id };
      persistOpenTabs();
    }
  }
  setStatus(id, status);
  // A new session's title isn't on disk immediately; re-read on its status events until it is
  // (this also makes the new session appear in the sidebar).
  if (tabs.some((t) => t.needsTitle && t.session.id === id)) void refreshFromDisk();
});

// The sidebar keeps itself current: a transcript created or changed on disk re-renders it.
window.claudeUi.onSessionsChanged(() => void refreshFromDisk());

// Stop persisting open tabs once shutdown starts, so the terminal-exit closes it triggers don't
// overwrite the saved tab list with an empty one (see the shuttingDown note above).
window.claudeUi.onQuitting(() => {
  shuttingDown = true;
});

function fitActive(): void {
  if (!activeTab) return;
  activeTab.fitAddon.fit();
  window.claudeUi.resizeTerminal(activeTab.terminalId, activeTab.term.cols, activeTab.term.rows);
}

window.addEventListener('resize', fitActive);
// Re-fit when the terminal area itself changes height (e.g. the tab bar wrapping to a new row),
// not just on window resize, so the terminal always fills its pane instead of being clipped.
// The ResizeObserver also covers sidebar resizing, since that changes the terminal pane's width.
new ResizeObserver(() => fitActive()).observe(terminalsEl);

// Drag the divider between the sidebar and the terminal to resize the session list; the width
// is remembered across launches.
const sidebar = document.getElementById('sidebar')!;
const sidebarResizer = document.getElementById('sidebar-resizer')!;
const SIDEBAR_MIN = 220;
const SIDEBAR_MAX = 640;
const savedWidth = Number(localStorage.getItem('sidebarWidth'));
if (savedWidth >= SIDEBAR_MIN && savedWidth <= SIDEBAR_MAX) sidebar.style.flexBasis = `${savedWidth}px`;
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
    localStorage.setItem('sidebarWidth', String(parseInt(sidebar.style.flexBasis, 10)));
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
});

newButton.addEventListener('click', async () => {
  // Show an active state while the folder picker is open (it has no persistent menu of its own),
  // matching how the other header buttons look while their panel/menu is up.
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
pinnedFilter.addEventListener('click', () => {
  showPinnedOnly = !showPinnedOnly;
  renderList();
  container.scrollTop = 0;
});
worktreeFilter.addEventListener('click', () => {
  showWorktreeOnly = !showWorktreeOnly;
  renderList();
  container.scrollTop = 0;
});
siblingFilter.addEventListener('click', () => {
  showSiblingsOnly = !showSiblingsOnly;
  renderList();
  container.scrollTop = 0;
});
archivedFilter.addEventListener('click', () => {
  showArchivedOnly = !showArchivedOnly;
  renderList();
  container.scrollTop = 0;
});
filterToggle.addEventListener('click', () => {
  const opening = filterPanel.hidden;
  filterPanel.hidden = !opening;
  filterToggle.setAttribute('aria-expanded', String(opening));
  // Opening hands focus to the search box; closing drops focus so the ring doesn't linger.
  if (opening) searchInput.focus();
  else filterToggle.blur();
});
datePresets.addEventListener('click', (event) => {
  const preset = (event.target as HTMLElement).dataset.range;
  if (!preset) return;
  applyDatePreset(preset);
  renderList();
  container.scrollTop = 0;
});
// Dismiss the calendar on an outside press or Escape; the picked range stays applied. Uses mousedown,
// not click, so it fires before air-datepicker re-renders on a view switch (a click handler would see
// the just-clicked nav element already detached and wrongly treat it as an outside click). The presets
// row, the range line, and the calendar itself keep it open (each has its own toggle handler).
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
installTooltips();
// Restore the last-active project and open tabs, then scope the tab bar + terminal to that project.
void (async () => {
  activeFolder = await window.claudeUi.getActiveFolder();
  await renderSessions();
  await restoreOpenTabs();
  switchWorkspaceTerminal(activeFolder);
})();
updatePlaceholder();
