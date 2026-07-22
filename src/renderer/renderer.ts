import type { ClaudeUiApi, SessionSummary } from '../shared/types';

declare global {
  interface Window {
    claudeUi: ClaudeUiApi;
  }
}

const container = document.getElementById('sessions')!;
const refreshButton = document.getElementById('refresh') as HTMLButtonElement;

async function render(): Promise<void> {
  container.textContent = 'Loading…';
  const sessions = await window.claudeUi.listSessions();

  if (sessions.length === 0) {
    container.textContent = 'No sessions found in ~/.claude/projects.';
    return;
  }

  container.replaceChildren(...groupByCwd(sessions).map(renderGroup));
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

function renderGroup([cwd, sessions]: [string, SessionSummary[]]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'group';

  const heading = document.createElement('h2');
  heading.textContent = cwd;
  section.appendChild(heading);

  for (const session of sessions) section.appendChild(renderSession(session));
  return section;
}

function renderSession(session: SessionSummary): HTMLElement {
  const item = document.createElement('article');
  item.className = 'session';

  const title = document.createElement('p');
  title.className = 'session-title';
  title.textContent = session.firstMessage || '(no prompt yet)';

  const meta = document.createElement('p');
  meta.className = 'session-meta';
  meta.textContent = `${relativeTime(session.lastActivity)} · ${session.eventCount} events · ${session.id.slice(0, 8)}`;

  item.append(title, meta);
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

refreshButton.addEventListener('click', render);
render();
