import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { ClaudeUiApi, SessionSummary } from '../shared/types';

declare global {
  interface Window {
    claudeUi: ClaudeUiApi;
  }
}

const container = document.getElementById('sessions')!;
const newButton = document.getElementById('new-session') as HTMLButtonElement;
const pinnedFilter = document.getElementById('pinned-filter') as HTMLButtonElement;
const searchInput = document.getElementById('search') as HTMLInputElement;
const filterStatus = document.getElementById('filter-status')!;
const filterCount = document.getElementById('filter-count')!;
const filterClear = document.getElementById('filter-clear') as HTMLButtonElement;
const loadingEl = document.getElementById('loading')!;
const tabbar = document.getElementById('tabbar')!;
const terminalsEl = document.getElementById('terminals')!;
const placeholder = document.getElementById('term-placeholder')!;

function setLoading(on: boolean): void {
  loadingEl.classList.toggle('active', on);
}

let pinned = new Set<string>();
let statuses = new Map<string, string>();
let allSessions: SessionSummary[] = [];
let filterText = '';
let showPinnedOnly = false;
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
}

const tabs: Tab[] = [];
let activeTab: Tab | null = null;
let restoring = false;

// Collapse sessions to one entry per conversation: the active tip (latest activity).
function tipsByConversation(sessions: SessionSummary[]): Map<string, SessionSummary> {
  const tips = new Map<string, SessionSummary>();
  for (const s of sessions) {
    const prev = tips.get(s.conversationId);
    if (!prev || s.lastActivity > prev.lastActivity) tips.set(s.conversationId, s);
  }
  return tips;
}

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
    const [sessions, pinnedList, statusMap] = await Promise.all([
      window.claudeUi.listSessions(),
      window.claudeUi.getPinned(),
      window.claudeUi.getAllStatuses(),
    ]);
    allSessions = sessions;
    pinned = new Set(pinnedList);
    statuses = new Map(Object.entries(statusMap));
    lastSignature = structuralSignature(sessions);
    reconcileOpenTabs();
    renderList();
  } finally {
    if (showLoading) setLoading(false);
  }
}

// The list's structure: one line per session that affects what the sidebar shows. Excludes
// lastActivity/eventCount so a running session writing its transcript isn't a "change".
function structuralSignature(sessions: SessionSummary[]): string {
  return sessions
    .map((s) => `${s.conversationId}\0${s.id}\0${s.cwd}\0${s.title}\0${s.firstMessage}`)
    .sort()
    .join('\n');
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

// A session passes when it matches the text search and, if the pinned-only toggle is on, is
// pinned.
function passesFilters(session: SessionSummary): boolean {
  if (showPinnedOnly && !pinned.has(session.conversationId)) return false;
  if (!filterText) return true;
  return `${session.title} ${session.firstMessage} ${session.cwd} ${session.id}`
    .toLowerCase()
    .includes(filterText);
}

// Make an active filter obvious: show "N of M" with a clear button and flag the active controls.
function updateFilterStatus(matches: number, total: number): void {
  const filtering = filterText.length > 0 || showPinnedOnly;
  filterStatus.hidden = !filtering;
  searchInput.classList.toggle('active', filterText.length > 0);
  pinnedFilter.classList.toggle('active', showPinnedOnly);
  pinnedFilter.setAttribute('aria-pressed', String(showPinnedOnly));
  if (filtering) filterCount.textContent = `Showing ${matches} of ${total}`;
}

function clearFilter(): void {
  searchInput.value = '';
  filterText = '';
  showPinnedOnly = false;
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

  // One group per folder; pinned sessions float to the top of their own group (a stable sort
  // keeps the within-group activity order otherwise).
  const desired: DesiredGroup[] = [];
  for (const [cwd, list] of groupByCwd(sessions)) {
    list.sort((a, b) => (pinned.has(b.conversationId) ? 1 : 0) - (pinned.has(a.conversationId) ? 1 : 0));
    desired.push({ name: cwd, folderCwd: cwd, sessions: list });
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
    const collapsed = collapsedGroups.has(group.name);
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

function groupByCwd(sessions: SessionSummary[]): [string, SessionSummary[]][] {
  const groups = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    const list = groups.get(session.cwd) ?? [];
    list.push(session);
    groups.set(session.cwd, list);
  }
  return [...groups.entries()];
}

// Build a group section once; contents (count, caret, rows) are updated on later renders.
function createGroup(name: string, folderCwd?: string): GroupEls {
  const section = document.createElement('section');
  section.className = 'group';

  const heading = document.createElement('h2');
  const caret = document.createElement('span');
  caret.className = 'caret';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = shortenPath(name);
  label.title = name;
  const count = document.createElement('span');
  count.className = 'group-count';
  heading.append(caret, label, count);
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
  const meta = document.createElement('p');
  meta.className = 'session-meta';
  content.append(title, meta);

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

  item.append(dot, content, pin);
  item.addEventListener('click', () => {
    const session = currentTips.get(conversationId);
    if (session) void openSession(session);
  });
  return item;
}

// Refresh a reused row's content for the tip it now shows.
function updateRow(row: HTMLElement, session: SessionSummary): void {
  row.dataset.sid = session.id;

  const dot = row.firstElementChild as HTMLElement;
  applyStatus(dot, statuses.get(session.id));
  statusDots.set(session.id, dot);

  const title = row.querySelector('.session-title') as HTMLElement;
  title.textContent = session.title || session.firstMessage || '(no prompt yet)';
  title.title = session.title || session.firstMessage || '';

  const meta = row.querySelector('.session-meta') as HTMLElement;
  meta.textContent = `${relativeTime(session.lastActivity)} · ${session.eventCount} events · ${session.id.slice(0, 8)}`;

  const pin = row.querySelector('.pin') as HTMLButtonElement;
  const isPinned = pinned.has(session.conversationId);
  pin.textContent = isPinned ? '📌' : '☆';
  pin.title = isPinned ? 'Unpin' : 'Pin';
  pin.disabled = false;
  pin.classList.remove('loading');
}

function applyStatus(dot: HTMLElement, status: string | undefined): void {
  dot.className = status ? `status-dot ${status}` : 'status-dot';
  dot.title = status ?? '';
}

// Folder paths share a long common prefix, so show the last two segments (the part that
// distinguishes them); the full path is available on hover.
function shortenPath(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts.length <= 2 ? p : `…/${parts.slice(-2).join('/')}`;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
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

  const tab: Tab = { session, terminalId, term, fitAddon, el, token, needsTitle: resumeId === undefined };

  // Ctrl-C twice in the terminal closes the tab instead of dropping to the leftover shell.
  let lastCtrlC = 0;
  term.onData((data) => {
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

function closeTab(tab: Tab): void {
  // Terminate the session; claude persists per turn, so its context is already on disk.
  // closeTerminal sends Ctrl-C twice to exit claude cleanly, then kills the shell.
  clearNudge(tab.session.id);
  window.claudeUi.closeTerminal(tab.terminalId);
  tab.term.dispose();
  tab.el.remove();
  const index = tabs.indexOf(tab);
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

function renderTabBar(): void {
  tabbar.replaceChildren(
    ...tabs.map((tab) => {
        const el = document.createElement('div');
        el.className = tab === activeTab ? 'tab active' : 'tab';

        const dot = document.createElement('span');
        applyStatus(dot, statuses.get(tab.session.id));

        const label = document.createElement('span');
        label.className = 'tab-label';
        label.textContent = tab.session.title || tab.session.firstMessage || tab.session.id.slice(0, 8);
        label.title = tab.session.title || tab.session.firstMessage || tab.session.id;

        const close = document.createElement('button');
        close.className = 'tab-close';
        close.textContent = '×';
        close.title = 'Close tab';
        close.addEventListener('click', (event) => {
          event.stopPropagation();
          closeTab(tab);
        });

        el.append(dot, label, close);
        el.addEventListener('click', () => activateTab(tab));
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
  if (tab) tab.term.writeln(`\r\n[process exited with code ${exitCode}]`);
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

window.addEventListener('resize', () => {
  if (!activeTab) return;
  activeTab.fitAddon.fit();
  window.claudeUi.resizeTerminal(activeTab.terminalId, activeTab.term.cols, activeTab.term.rows);
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
renderSessions();
updatePlaceholder();
restoreOpenTabs();
