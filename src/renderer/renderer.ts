import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { ClaudeUiApi, SessionSummary } from '../shared/types';

declare global {
  interface Window {
    claudeUi: ClaudeUiApi;
  }
}

const container = document.getElementById('sessions')!;
const refreshButton = document.getElementById('refresh') as HTMLButtonElement;
const searchInput = document.getElementById('search') as HTMLInputElement;
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
const statusDots = new Map<string, HTMLElement>();
const sessionRows = new Map<string, HTMLElement>();

function isOpen(id: string): boolean {
  return tabs.some((t) => t.session.id === id);
}

function updateSidebarHighlight(): void {
  for (const [id, row] of sessionRows) {
    row.classList.toggle('open', isOpen(id));
    row.classList.toggle('active-session', activeTab?.session.id === id);
  }
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
}

const tabs: Tab[] = [];
let activeTab: Tab | null = null;
let restoring = false;

function persistOpenTabs(): void {
  if (restoring) return;
  window.claudeUi.setOpenSessions(tabs.map((t) => t.session.id));
}

async function restoreOpenTabs(): Promise<void> {
  restoring = true;
  try {
    const [sessions, openIds] = await Promise.all([
      window.claudeUi.listSessions(),
      window.claudeUi.getOpenSessions(),
    ]);
    const byId = new Map(sessions.map((s) => [s.id, s]));
    for (const id of openIds) {
      const session = byId.get(id);
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
    renderList();
  } finally {
    if (showLoading) setLoading(false);
  }
}

function matchesFilter(session: SessionSummary): boolean {
  if (!filterText) return true;
  return `${session.title} ${session.firstMessage} ${session.cwd} ${session.id}`
    .toLowerCase()
    .includes(filterText);
}

// Render from the cached session list, applying the current search filter. Keystrokes call
// this directly so filtering never re-reads disk.
function renderList(): void {
  const scroll = container.scrollTop;
  statusDots.clear();
  sessionRows.clear();

  const sessions = allSessions.filter(matchesFilter);
  if (sessions.length === 0) {
    container.textContent = allSessions.length === 0 ? 'No sessions found in ~/.claude/projects.' : 'No matches.';
    return;
  }

  const groups: HTMLElement[] = [];
  const pinnedSessions = sessions.filter((s) => pinned.has(s.id));
  if (pinnedSessions.length > 0) groups.push(renderGroup('📌 Pinned', pinnedSessions));

  const rest = sessions.filter((s) => !pinned.has(s.id));
  for (const [cwd, list] of groupByCwd(rest)) groups.push(renderGroup(cwd, list));

  container.replaceChildren(...groups);
  container.scrollTop = scroll;
  updateSidebarHighlight();
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

function renderGroup(name: string, sessions: SessionSummary[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'group';

  const heading = document.createElement('h2');
  heading.textContent = name;
  section.appendChild(heading);

  for (const session of sessions) section.appendChild(renderSession(session));
  return section;
}

function renderSession(session: SessionSummary): HTMLElement {
  const item = document.createElement('article');
  item.className = 'session';

  const dot = document.createElement('span');
  applyStatus(dot, statuses.get(session.id));
  statusDots.set(session.id, dot);

  const content = document.createElement('div');
  content.className = 'session-content';

  const title = document.createElement('p');
  title.className = 'session-title';
  title.textContent = session.title || session.firstMessage || '(no prompt yet)';

  const meta = document.createElement('p');
  meta.className = 'session-meta';
  meta.textContent = `${relativeTime(session.lastActivity)} · ${session.eventCount} events · ${session.id.slice(0, 8)}`;

  content.append(title, meta);

  const pin = document.createElement('button');
  pin.className = 'pin';
  const isPinned = pinned.has(session.id);
  pin.textContent = isPinned ? '📌' : '☆';
  pin.title = isPinned ? 'Unpin' : 'Pin';
  pin.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (pin.disabled) return;
    pin.disabled = true;
    pin.classList.add('loading');
    pinned = new Set(await window.claudeUi.togglePin(session.id));
    renderList();
  });

  item.append(dot, content, pin);
  item.addEventListener('click', () => openSession(session));
  sessionRows.set(session.id, item);
  return item;
}

function applyStatus(dot: HTMLElement, status: string | undefined): void {
  dot.className = status ? `status-dot ${status}` : 'status-dot';
  dot.title = status ?? '';
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
  const terminalId = await window.claudeUi.startTerminal(session.cwd, session.id);

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

  const tab: Tab = { session, terminalId, term, fitAddon, el };

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
window.claudeUi.onSessionStatus((id, status) => setStatus(id, status));

window.addEventListener('resize', () => {
  if (!activeTab) return;
  activeTab.fitAddon.fit();
  window.claudeUi.resizeTerminal(activeTab.terminalId, activeTab.term.cols, activeTab.term.rows);
});

refreshButton.addEventListener('click', () => renderSessions());
searchInput.addEventListener('input', () => {
  filterText = searchInput.value.trim().toLowerCase();
  renderList();
});
renderSessions();
updatePlaceholder();
restoreOpenTabs();
