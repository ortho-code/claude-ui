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
  relativeTime,
  sessionPasses,
  datePresetRange,
} from './logic';

declare global {
  interface Window {
    claudeUi: ClaudeUiApi;
  }
}

const container = document.getElementById('sessions')!;
const newButton = document.getElementById('new-session') as HTMLButtonElement;
const pinnedFilter = document.getElementById('pinned-filter') as HTMLButtonElement;
const worktreeFilter = document.getElementById('worktree-filter') as HTMLButtonElement;
const archivedFilter = document.getElementById('archived-filter') as HTMLButtonElement;
const filterToggle = document.getElementById('filter-toggle') as HTMLButtonElement;
const filterPanel = document.getElementById('filter-panel')!;
const datePresets = document.getElementById('date-presets')!;
const dateCustom = document.getElementById('date-custom')!;
const dateFrom = document.getElementById('date-from') as HTMLInputElement;
const dateTo = document.getElementById('date-to') as HTMLInputElement;
const searchInput = document.getElementById('search') as HTMLInputElement;
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

function setLoading(on: boolean): void {
  loadingEl.classList.toggle('active', on);
}

let pinned = new Set<string>();
let archived = new Map<string, number>();
// Conversations whose delete is in flight: hidden from the list until that delete resolves, so a
// concurrent delete's disk re-read can't briefly resurrect them.
const pendingDeletes = new Set<string>();
let statuses = new Map<string, string>();
let allSessions: SessionSummary[] = [];
let filterText = '';
let showPinnedOnly = false;
let showWorktreeOnly = false;
let showArchivedOnly = false;
// Date filter, as an inclusive [from, to] window in epoch ms; null means unbounded on that side.
let datePreset = 'any';
let dateFromMs: number | null = null;
let dateToMs: number | null = null;
// Structure of the last rendered list, so disk changes that only grow a transcript (new
// lastActivity/eventCount) don't trigger a rebuild — we re-render only on structural change.
let lastSignature = '';
// Status dots by tip session id; rebuilt each render (a status event names a session id).
const statusDots = new Map<string, HTMLElement>();
// Row elements by conversationId, reused across renders so a re-render moves nodes instead of
// recreating them — no flicker, no scroll jump, hover/focus preserved.
const sessionRows = new Map<string, HTMLElement>();
const collapsedGroups = new Set<string>();

interface GroupEls {
  section: HTMLElement;
  caret: HTMLElement;
  count: HTMLElement;
}
// Group sections by group name, reused across renders (same reason as sessionRows).
const groupSections = new Map<string, GroupEls>();
// The session each row currently shows, by conversationId, so a reused row's click/pin handlers
// act on the live tip even after the conversation branches.
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
  if (status) statuses.set(id, status);
  else statuses.delete(id);
  const dot = statusDots.get(id);
  if (dot) applyStatus(dot, status);
  if (tabs.some((t) => t.session.id === id)) renderTabBar();
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
}

const tabs: Tab[] = [];
let activeTab: Tab | null = null;
let restoring = false;

// Collapse sessions to one entry per conversation: the active tip (latest activity).
function persistOpenTabs(): void {
  if (restoring) return;
  // Persist conversation keys so a tab reopens on the current tip even if the conversation
  // branched out of band. Fall back to the tab's own key before it has reconciled to disk.
  const idToConv = new Map(allSessions.map((s) => [s.id, s.conversationId]));
  window.claudeUi.setOpenSessions(tabs.map((t) => idToConv.get(t.session.id) ?? t.session.conversationId));
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
    const [sessions, pinnedList, archivedList, statusMap] = await Promise.all([
      window.claudeUi.listSessions(),
      window.claudeUi.getPinned(),
      window.claudeUi.getArchived(),
      window.claudeUi.getAllStatuses(),
    ]);
    allSessions = sessions;
    pinned = new Set(pinnedList);
    archived = new Map(Object.entries(archivedList));
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
  reconcileOpenTabs();
  renderList();
}

// Any filter active? Used to auto-expand groups with matches and to show the filter status.
function isFiltering(): boolean {
  return filterText.length > 0 || showPinnedOnly || showWorktreeOnly || showArchivedOnly || datePreset !== 'any';
}

// Adapt the current filter state to the pure predicate.
function passesFilters(session: SessionSummary): boolean {
  return sessionPasses(session, {
    text: filterText,
    pinnedOnly: showPinnedOnly,
    worktreeOnly: showWorktreeOnly,
    archivedOnly: showArchivedOnly,
    dateFrom: dateFromMs,
    dateTo: dateToMs,
    pinned,
    archived,
    pendingDeletes,
  });
}

// Translate the date dropdown into the [from, to] window. Presets are rolling from now; custom
// reads the two date inputs (parsed as local day bounds).
function applyDatePreset(preset: string): void {
  datePreset = preset;
  dateCustom.hidden = preset !== 'custom';
  for (const chip of datePresets.querySelectorAll('button')) {
    chip.classList.toggle('active', (chip as HTMLElement).dataset.range === preset);
  }
  if (preset === 'custom') {
    applyCustomDates();
  } else {
    const range = datePresetRange(preset, Date.now());
    dateFromMs = range.from;
    dateToMs = range.to;
  }
}

function applyCustomDates(): void {
  dateFromMs = dateFrom.value ? new Date(`${dateFrom.value}T00:00:00`).getTime() : null;
  dateToMs = dateTo.value ? new Date(`${dateTo.value}T23:59:59.999`).getTime() : null;
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
  showArchivedOnly = false;
  dateFrom.value = '';
  dateTo.value = '';
  applyDatePreset('any');
  renderList();
  container.scrollTop = 0;
}

// Render from the cached session list, applying the current search filter. Keystrokes call
// this directly so filtering never re-reads disk. Reuses group/row nodes by key so a re-render
// moves elements into place instead of rebuilding the sidebar (no flicker, scroll stays put).
function renderList(): void {
  const scroll = container.scrollTop;
  statusDots.clear();

  // Include new sessions not yet written to disk (from their open tabs) so they appear in the
  // list immediately, in the right folder group; they reconcile to the real entry once created.
  // Collapse conversation branches to the active tip (latest activity).
  const tips = tipsByConversation(allSessions);
  const knownIds = new Set(allSessions.map((s) => s.id));
  const pending = tabs.filter((t) => t.needsTitle && !knownIds.has(t.session.id)).map((t) => t.session);
  const all = [...pending, ...tips.values()];
  currentTips = new Map(all.map((s) => [s.conversationId, s]));
  const sessions = all.filter(passesFilters);
  updateFilterStatus(sessions.length, all.length);

  if (sessions.length === 0) {
    clearList();
    const message = document.createElement('div');
    message.className = 'empty-message';
    message.textContent = all.length === 0 ? 'No sessions found in ~/.claude/projects.' : 'No matches.';
    container.append(message);
    return;
  }
  container.querySelector(':scope > .empty-message')?.remove();

  // One group per repo; pinned sessions float to the top of their own group (a stable sort
  // keeps the within-group activity order otherwise).
  const desired: DesiredGroup[] = [];
  for (const [repoRoot, list] of groupByRepo(sessions)) {
    list.sort((a, b) => (pinned.has(b.conversationId) ? 1 : 0) - (pinned.has(a.conversationId) ? 1 : 0));
    desired.push({ name: repoRoot, folderCwd: repoRoot, sessions: list });
  }

  reconcileGroups(desired);
  pruneRows(new Set(sessions.map((s) => s.conversationId)));

  container.scrollTop = scroll;
  updateSidebarHighlight();
}

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
    for (const session of group.sessions) {
      const row = getOrCreateRow(session.conversationId);
      updateRow(row, session);
      els.section.appendChild(row);
    }
    container.appendChild(els.section);
  }
}

// Remove rows whose conversation is no longer shown (deleted, or filtered out by search).
function pruneRows(wanted: Set<string>): void {
  for (const [conversationId, row] of sessionRows) {
    if (!wanted.has(conversationId)) {
      row.remove();
      sessionRows.delete(conversationId);
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

// Reveal a session's row in the sidebar (expanding its group if collapsed), so clicking a tab
// scrolls to where it lives and shows which group it belongs to.
function revealSessionInSidebar(session: SessionSummary): void {
  if (collapsedGroups.has(session.repoRoot)) {
    collapsedGroups.delete(session.repoRoot);
    renderList();
  }
  const row = sessionRows.get(session.conversationId);
  if (!row) return;
  // Scroll only the sidebar list (scrollIntoView would also scroll the page and shift the whole
  // app). Land the row just below the sticky heading.
  const headingOffset = 44;
  container.scrollTop += row.getBoundingClientRect().top - container.getBoundingClientRect().top - headingOffset;
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
  icon.innerHTML =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M2 4h4l1.5 1.5H14V13H2z"/></svg>';
  const label = document.createElement('span');
  label.className = 'label';
  label.title = name;
  label.textContent = groupName(name);
  const count = document.createElement('span');
  count.className = 'group-count';
  heading.append(caret, icon, label, count);
  if (folderCwd) {
    const add = document.createElement('button');
    add.className = 'group-add';
    add.textContent = '+';
    add.title = 'New session in this folder';
    add.addEventListener('click', (event) => {
      event.stopPropagation();
      void openNewSession(folderCwd);
    });
    heading.append(add);
  }
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

  return { section, caret, count };
}

function getOrCreateRow(conversationId: string): HTMLElement {
  const existing = sessionRows.get(conversationId);
  if (existing) return existing;
  const row = createSessionRow(conversationId);
  sessionRows.set(conversationId, row);
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
  meta: HTMLElement;
  pin: HTMLButtonElement;
  archiveBtn: HTMLButtonElement;
  deleteBtn: HTMLButtonElement;
}
// Each row's child elements, cached so updateRow reads them directly instead of re-querying the
// DOM every render (same idea as the session summary cache, applied to rendering).
const rowEls = new WeakMap<HTMLElement, RowEls>();

// Build a row once. Its click/pin handlers read the live tip from `currentTips` by
// conversationId, so a reused row stays correct after the conversation branches.
function createSessionRow(conversationId: string): HTMLElement {
  const item = document.createElement('article');
  item.className = 'session';
  item.dataset.cid = conversationId;

  const dot = document.createElement('span');
  const content = document.createElement('div');
  content.className = 'session-content';
  const title = document.createElement('p');
  title.className = 'session-title';
  const badge = document.createElement('span');
  badge.className = 'worktree-badge';
  badge.hidden = true;
  const meta = document.createElement('p');
  meta.className = 'session-meta';
  content.append(title, badge, meta);

  const pin = document.createElement('button');
  pin.className = 'pin';
  pin.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (pin.disabled) return;
    pin.disabled = true;
    pin.classList.add('loading');
    pinned = new Set(await window.claudeUi.togglePin(conversationId));
    renderList();
  });

  const archiveBtn = document.createElement('button');
  archiveBtn.className = 'archive-btn';
  archiveBtn.addEventListener('click', async (event) => {
    event.stopPropagation();
    archived = new Map(Object.entries(await window.claudeUi.toggleArchive(conversationId)));
    // Archiving puts the session away, so close any open tab for it (unarchive leaves tabs alone).
    if (archived.has(conversationId)) {
      for (const tab of [...tabs]) if (tab.session.conversationId === conversationId) closeTab(tab);
    }
    renderList();
  });

  // Delete lives only in the archived view (shown/hidden in updateRow); trash-based + confirmed.
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'delete-btn';
  deleteBtn.title = 'Delete session';
  deleteBtn.hidden = true;
  deleteBtn.innerHTML =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4.5h10" /><path d="M6.5 4.5V3h3v1.5" /><path d="M4.8 4.5l.5 8h5.4l.5-8" /></svg>';
  deleteBtn.addEventListener('click', async (event) => {
    event.stopPropagation();
    const session = currentTips.get(conversationId);
    const title = session?.title || session?.firstMessage || conversationId.slice(0, 8);
    if (!(await confirmDelete(title))) return;
    const ids = allSessions.filter((s) => s.conversationId === conversationId).map((s) => s.id);
    // Hide it right away so deletion feels instant; trashing files (slow under WSL) and the meta
    // purge run in the background. It stays hidden via pendingDeletes until its files are gone
    // from disk (see renderSessions), so a concurrent delete's re-read can't resurrect it.
    pendingDeletes.add(conversationId);
    renderList();
    try {
      // Guard against a delete that never settles (e.g. a hung OS-trash call): after 30s treat
      // it as failed so the row can't stay hidden forever within a session.
      await Promise.race([
        window.claudeUi.deleteConversation({ conversationId, ids }),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('delete timed out')), 30_000)),
      ]);
    } catch {
      showToast(`Couldn't delete "${title}". It's still here.`);
    } finally {
      // Stop hiding once this delete resolves: on success the re-read finds it gone; on failure
      // the file is still on disk, so the row reappears.
      pendingDeletes.delete(conversationId);
      await renderSessions(false);
    }
  });

  item.append(dot, content, pin, archiveBtn, deleteBtn);
  rowEls.set(item, { dot, title, badge, meta, pin, archiveBtn, deleteBtn });
  item.addEventListener('click', () => {
    // Archived sessions are inert: manage them (unarchive/delete), don't resume them.
    if (showArchivedOnly) return;
    const session = currentTips.get(conversationId);
    if (session) void openSession(session);
  });
  return item;
}

// Refresh a reused row's content for the tip it now shows.
function updateRow(row: HTMLElement, session: SessionSummary): void {
  row.dataset.sid = session.id;
  const els = rowEls.get(row)!;

  applyStatus(els.dot, statuses.get(session.id));
  statusDots.set(session.id, els.dot);

  els.title.textContent = session.title || session.firstMessage || '(no prompt yet)';
  els.title.title = session.title || session.firstMessage || '';

  els.badge.hidden = !session.worktree;
  if (session.worktree) {
    els.badge.textContent = `worktree: ${session.worktree}`;
    els.badge.title = `Linked git worktree: ${session.worktree}`;
  }

  if (showArchivedOnly) {
    const ts = archived.get(session.conversationId);
    els.meta.textContent = ts ? `archived ${relativeTime(new Date(ts).toISOString())}` : 'archived';
  } else {
    els.meta.textContent = `${relativeTime(session.lastActivity)} · ${session.eventCount} events · ${session.id.slice(0, 8)}`;
  }

  // The archived view is a management view: no pinning, and delete replaces it there.
  const isPinned = pinned.has(session.conversationId);
  els.pin.textContent = isPinned ? '★' : '☆';
  els.pin.title = isPinned ? 'Unpin' : 'Pin';
  els.pin.disabled = false;
  els.pin.classList.remove('loading');
  els.pin.hidden = showArchivedOnly;

  els.archiveBtn.title = showArchivedOnly ? 'Unarchive' : 'Archive';
  els.archiveBtn.innerHTML = showArchivedOnly ? UNARCHIVE_ICON : ARCHIVE_ICON;
  els.deleteBtn.hidden = !showArchivedOnly;
}

function applyStatus(dot: HTMLElement, status: string | undefined): void {
  dot.className = status ? `status-dot ${status}` : 'status-dot';
  dot.title = status ?? '';
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
    worktree: '',
    title: `New: ${folder}`,
    firstMessage: '',
    lastActivity: new Date().toISOString(),
    eventCount: 0,
  };
  await createTab(session, undefined);
  renderList();
}

async function createTab(session: SessionSummary, resumeId: string | undefined): Promise<void> {
  const token = crypto.randomUUID();
  const terminalId = await window.claudeUi.startTerminal(session.cwd, resumeId, token);

  const el = document.createElement('div');
  el.className = 'term';
  terminalsEl.appendChild(el);

  const term = new Terminal({
    fontFamily: 'monospace',
    fontSize: 13,
    theme: { background: '#11111b', foreground: '#cdd6f4' },
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
    needsTitle: resumeId === undefined,
    startedAt: Date.now(),
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
  if (statuses.get(tab.session.id) === 'waiting') clearNudge(tab.session.id);
  activeTab = tab;
  for (const other of tabs) other.el.classList.toggle('active', other === tab);
  renderTabBar();
  updatePlaceholder();
  updateSidebarHighlight();
  tab.fitAddon.fit();
  window.claudeUi.resizeTerminal(tab.terminalId, tab.term.cols, tab.term.rows);
  tab.term.focus();
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
  if (activeTab === tab) {
    activeTab = null;
    const next = tabs[index] ?? tabs[index - 1] ?? null;
    if (next) activateTab(next);
  }
  renderTabBar();
  updatePlaceholder();
  updateSidebarHighlight();
  persistOpenTabs();
}

// User-initiated close: terminate the session (claude persists per turn, so its context is on
// disk) and drop the tab. closeTerminal sends Ctrl-C twice to exit claude cleanly, then kills it.
function closeTab(tab: Tab): void {
  window.claudeUi.closeTerminal(tab.terminalId);
  removeTab(tab);
}

function renderTabBar(): void {
  tabbar.replaceChildren(
    ...tabs.map((tab) => {
        const el = document.createElement('div');
        el.className = tab === activeTab ? 'tab active' : 'tab';

        const dot = document.createElement('span');
        applyStatus(dot, statuses.get(tab.session.id));

        const label = document.createElement('span');
        label.className = 'tab-label';
        const text = tab.session.title || tab.session.firstMessage || tab.session.id.slice(0, 8);
        label.textContent = text;
        label.title = `${groupName(tab.session.repoRoot)} · ${text}`;

        const close = document.createElement('button');
        close.className = 'tab-close';
        close.textContent = '×';
        close.title = 'Close tab';
        close.addEventListener('click', (event) => {
          event.stopPropagation();
          closeTab(tab);
        });

        el.append(dot, label, close);
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
      }),
  );
}

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
  const dir = await window.claudeUi.pickFolder();
  if (dir) openNewSession(dir);
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
const onCustomDateChange = (): void => {
  applyCustomDates();
  renderList();
  container.scrollTop = 0;
};
dateFrom.addEventListener('change', onCustomDateChange);
dateTo.addEventListener('change', onCustomDateChange);
renderSessions();
updatePlaceholder();
restoreOpenTabs();
