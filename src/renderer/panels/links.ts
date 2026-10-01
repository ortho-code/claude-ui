import type { PanelData } from '../../shared/panels';
import { projectFor, projectsForSwitcher, type NudgeStatus } from '../logic';
import { openMenu } from '../menu';
import { askForSession } from '../sessiondialog';
import { showToast } from '../toast';
import { store, withEntry } from '../state/app';
import { projName, projectGroups, switcherPool, tabWith, visibleSessions } from '../state/views';
import type { Asks, LinkedSession, SessionRequest } from './contract';

/**
 * THE PANELS' SESSION LINKS: the sessions each panel's rows started, which a row marks and goes back to, and the dialog a row's action starts one through.
 * The tree's answers to a panel's `linkedSessions`, `pickSession` and `startSession`, beside the host that hands them on; what they go on to ask — open a session, start a new one — is the terminal area's to answer, through the tree's own asks.
 * A panel's data is the store's (`panelData`), so the panels hear of every change to it the way they hear of a session's.
 */

const asked = new Set<string>();

function setPanelData(entryKey: string, data: PanelData): void {
  store.set({ panelData: withEntry(store.get().panelData, entryKey, data) });
}

/** A panel's data, read from main the first time anything asks; null until that read lands. */
function panelDataOf(entryKey: string): PanelData | null {
  const data = store.get().panelData.get(entryKey);
  if (data) return data;
  if (!asked.has(entryKey)) {
    asked.add(entryKey);
    void window.claudeUi.getPanelData(entryKey).then((read) => {
      // A push may have landed first, and is the newer of the two.
      if (!store.get().panelData.has(entryKey)) setPanelData(entryKey, read);
    });
  }
  return null;
}

window.claudeUi.onPanelDataChanged((entryKey, data) => setPanelData(entryKey, data));

/**
 * The sessions a panel's item started that the app still has, latest first, as the session list would draw them.
 * A link whose session is gone — one main has not yet forgotten — is left out rather than shown as something to go to.
 */
export function linkedSessions(entryKey: string, itemKey: string): LinkedSession[] {
  const data = panelDataOf(entryKey);
  if (!data) return [];
  const { sessions, statuses, acked } = store.get();
  return Object.entries(data.sessions)
    .filter(([, link]) => link.key === itemKey)
    .sort(([, a], [, b]) => b.startedAt.localeCompare(a.startedAt))
    .flatMap(([id]) => {
      const tab = tabWith(id);
      const session = tab?.session ?? sessions.find((s) => s.id === id);
      if (!session) return [];
      return [{ id, title: session.title, status: statuses.get(id) ?? null, acked: acked.has(id), running: tab !== undefined && tab.terminalId !== null }];
    });
}

/** Several sessions of one row, in the app's own menu, each with its status dot. */
export function pickSession(anchor: HTMLElement, sessions: LinkedSession[], asks: Pick<Asks, 'openSession'>): void {
  const dot = (status: string | null): NudgeStatus => (status === 'waiting' || status === 'idle' || status === 'busy' ? status : null);
  openMenu(
    anchor,
    sessions.map((session) => ({ label: session.title, badge: dot(session.status), onSelect: () => asks.openSession(session.id) })),
  );
}

/**
 * A panel's item asks for a session: the app's dialog says where it goes and what it starts with, and nothing starts until Start.
 * The projects offered are the switcher's, in its order and without the ones whose folder is gone, since a session cannot start there; the one the panel's folder is in comes first, and that folder is offered itself when it is in no project yet.
 * The session is remembered by the panel under the id minted here BEFORE its tab exists, so the row can lead back to it from the start; then it starts down the same path as any new session.
 * When the row already has a session, the dialog offers to continue the latest one instead, which keeps the context the first one built: stopped, it resumes with the prompt; running, it is brought into view and the prompt is not sent.
 */
export async function startSession(entryKey: string, request: SessionRequest, asks: Pick<Asks, 'openSession' | 'openNewSession'>): Promise<void> {
  const state = store.get();
  const known = projectsForSwitcher(switcherPool(visibleSessions(state), state), state.statuses, state.acked, state.projectNames, state.projectOrder).projects.filter((project) => project.rootExists);
  const roots = known.map((project) => project.repoRoot);
  const found = request.dir ? projectFor(roots, request.dir) : null;
  const preset = found ?? request.dir ?? state.activeProject ?? roots[0] ?? null;
  if (preset === null) {
    showToast('There is no project to start a session in yet.');
    return;
  }
  const choices = roots.includes(preset) ? roots : [preset, ...roots];
  const groupsIn = (root: string): { id: string; name: string }[] => projectGroups(root, state).map(({ id, name }) => ({ id, name }));
  const data = await window.claudeUi.getPanelData(entryKey);
  setPanelData(entryKey, data);
  const latest = linkedSessions(entryKey, request.key)[0] ?? null;
  const answer = await askForSession({
    from: request.from,
    about: request.label,
    continueIn: latest ? { title: latest.title, running: latest.running } : null,
    projects: choices.map((root) => ({ root, name: projName(root, state), groups: groupsIn(root) })),
    project: preset,
    // The last group picked from this panel in that project, while it still exists.
    groupFor: (root) => {
      const last = data.lastGroup[root] ?? null;
      return last !== null && groupsIn(root).some((group) => group.id === last) ? last : null;
    },
    name: request.name ?? '',
    prompt: request.prompt,
  });
  if (!answer) return;
  if (answer.mode === 'continue' && latest) {
    asks.openSession(latest.id, answer.prompt.trim() || undefined);
    return;
  }
  const id = crypto.randomUUID();
  setPanelData(entryKey, await window.claudeUi.linkPanelSession(entryKey, id, { key: request.key, label: request.label, href: request.href }, { repoRoot: answer.root, groupId: answer.groupId }));
  await asks.openNewSession(answer.root, answer.groupId ?? undefined, { name: answer.name.trim(), prompt: answer.prompt.trim() }, id);
}
