import type { SessionGroup, SessionSummary } from '../../shared/types';
import { displayName, entityKey, inView, projectRootExists, sessionsByKey, type NudgeStatus } from '../logic';
import { store, type TabState, type View } from './app';

/** What more than one surface reads out of the store: each takes the view it reads, so a repaint that calls one names those slices too. */

/** A project's name: the one you gave it, or its folder's. */
export const projName = (repoRoot: string, view: View<'projectNames'>): string => displayName(repoRoot, view.projectNames);

/** The groups belonging to one project, in registry order. */
export function projectGroups(repoRoot: string, { groupState }: View<'groupState'>): SessionGroup[] {
  return groupState.groups.filter((g) => g.repoRoot === repoRoot);
}

/** The tab a session is open in, if any. */
export function tabWith(sessionId: string, view: View<'tabs'> = store.get()): TabState | undefined {
  return view.tabs.find((t) => t.session.id === sessionId);
}

/** The tab on show, from the token the store keeps. */
export function tabOnShow(view: View<'tabs' | 'activeTab'>): TabState | null {
  return view.activeTab === null ? null : (view.tabs.find((t) => t.token === view.activeTab) ?? null);
}

/** The session behind an id, from its tab or the list; null for one the app no longer has. */
export function sessionById(id: string, view: View<'sessions' | 'tabs'> = store.get()): SessionSummary | null {
  return tabWith(id, view)?.session ?? view.sessions.find((s) => s.id === id) ?? null;
}

/**
 * The sessions the sidebar can show: every session on disk, plus the open tabs whose session has not written a transcript yet (so a fresh session appears in its project immediately).
 * A tab's id is the session's real id from the moment it is created, so this adds a row that the transcript later fills in — never a second row beside it.
 */
export function visibleSessions(view: View<'sessions' | 'tabs'>): SessionSummary[] {
  const tips = sessionsByKey(view.sessions);
  const knownIds = new Set(view.sessions.map((s) => s.id));
  const pending = view.tabs.filter((t) => !knownIds.has(t.session.id)).map((t) => t.session);
  return [...pending, ...tips.values()];
}

/** The switcher's project pool: every project's tips minus archived/pending-delete, independent of the search text and active project so you can always navigate to any project. */
export function switcherPool(all: SessionSummary[], view: View<'archived' | 'pendingDeletes'>): SessionSummary[] {
  return viewPool(all, false, view);
}

/** The sessions a view holds before any filter, archived or not (see inView). */
export function viewPool(all: SessionSummary[], archivedView: boolean, view: View<'archived' | 'pendingDeletes'>): SessionSummary[] {
  return all.filter((s) => inView(entityKey(s), archivedView, view.archived, view.pendingDeletes));
}

/** The tabs actually on screen: a project view shows only its own. */
export function visibleTabs({ activeProject, tabs }: View<'activeProject' | 'tabs'>): readonly TabState[] {
  return activeProject ? tabs.filter((t) => t.session.repoRoot === activeProject) : tabs;
}

/** Whether a project is dead, by the rule the session list and the switcher use, for the surfaces that hold only a repo root: the tab bar and the empty pane. A root with no sessions to ask is not called dead. */
export function projectGone(repoRoot: string, view: View<'sessions' | 'tabs'>): boolean {
  const sessions = visibleSessions(view).filter((s) => s.repoRoot === repoRoot);
  return sessions.length > 0 && !projectRootExists(sessions);
}

/** A session's contribution to the roll-up: its live status, but an acked idle/waiting counts as nothing (muted), same rule as the switcher badges. */
export function sessionNudge(id: string, view: View<'statuses' | 'acked'>): NudgeStatus {
  const st = view.statuses.get(id);
  if (st === 'waiting' || st === 'idle') return view.acked.has(id) ? null : st;
  if (st === 'busy') return 'busy';
  return null;
}
