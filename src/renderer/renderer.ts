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

const term = new Terminal({
  fontFamily: 'monospace',
  fontSize: 13,
  theme: { background: '#11111b', foreground: '#cdd6f4' },
});
const fitAddon = new FitAddon();
let activeTerminalId: number | null = null;
let pinned = new Set<string>();

async function renderSessions(): Promise<void> {
  container.textContent = 'Loading…';
  const [sessions, pinnedList] = await Promise.all([
    window.claudeUi.listSessions(),
    window.claudeUi.getPinned(),
  ]);
  pinned = new Set(pinnedList);

  if (sessions.length === 0) {
    container.textContent = 'No sessions found in ~/.claude/projects.';
    return;
  }

  const groups: HTMLElement[] = [];
  const pinnedSessions = sessions.filter((s) => pinned.has(s.id));
  if (pinnedSessions.length > 0) groups.push(renderGroup('📌 Pinned', pinnedSessions));

  const rest = sessions.filter((s) => !pinned.has(s.id));
  for (const [cwd, list] of groupByCwd(rest)) groups.push(renderGroup(cwd, list));

  container.replaceChildren(...groups);
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

  const content = document.createElement('div');
  content.className = 'session-content';

  const title = document.createElement('p');
  title.className = 'session-title';
  title.textContent = session.firstMessage || '(no prompt yet)';

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
    pinned = new Set(await window.claudeUi.togglePin(session.id));
    renderSessions();
  });

  item.append(content, pin);
  item.addEventListener('click', () => openSession(session));
  return item;
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

function initTerminal(): void {
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal')!);
  fitAddon.fit();

  window.addEventListener('resize', () => {
    fitAddon.fit();
    sendResize();
  });

  term.onData((data) => {
    if (activeTerminalId !== null) window.claudeUi.sendTerminalInput(activeTerminalId, data);
  });
  window.claudeUi.onTerminalData((id, data) => {
    if (id === activeTerminalId) term.write(data);
  });
  window.claudeUi.onTerminalExit((id, exitCode) => {
    if (id === activeTerminalId) term.writeln(`\r\n[process exited with code ${exitCode}]`);
  });

  term.writeln('Select a session on the left to resume it.');
}

function sendResize(): void {
  if (activeTerminalId !== null) window.claudeUi.resizeTerminal(activeTerminalId, term.cols, term.rows);
}

async function openSession(session: SessionSummary): Promise<void> {
  if (activeTerminalId !== null) window.claudeUi.killTerminal(activeTerminalId);
  term.reset();
  fitAddon.fit();
  activeTerminalId = await window.claudeUi.startTerminal(session.cwd, session.id);
  sendResize();
  term.focus();
}

refreshButton.addEventListener('click', renderSessions);
initTerminal();
renderSessions();
