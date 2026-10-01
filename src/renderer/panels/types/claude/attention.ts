import { sessionLabel } from '../../../logic';
import { showAttentionToast } from '../../../notifications';
import { store, type View } from '../../../state/app';
import { projName, tabWith } from '../../../state/views';
import { hostOf } from '../builtin';
import { activateTab, tabOf } from './terminals';

/**
 * The terminal area's attention toasts: a tab not on show that turns waiting or finished says so in a toast (drawn by notifications.ts), and a click on it goes to that tab.
 * A watcher of the statuses (`toastAttention`), which the terminal area registers (watch.ts).
 */

/**
 * A real transition into waiting/idle on a tab you're not looking at -> toast it. Never for busy, a cleared status, a no-op repeat, or the tab you're already on.
 * Only a change of state is news: against the statuses as the toasts last saw them (`before`).
 * Start-up's read of every status toasts nothing: it lands before the tabs are restored, so no session in it has a tab yet.
 */
export function toastAttention(view: View<'statuses' | 'tabs' | 'activeTab' | 'projectNames'>, { statuses: before }: View<'statuses'>): void {
  for (const [id, status] of view.statuses) {
    if ((status !== 'waiting' && status !== 'idle') || status === before.get(id)) continue;
    const tab = tabWith(id, view);
    if (!tab || tab.token === view.activeTab) continue;
    const { token } = tab;
    showAttentionToast({ status, label: sessionLabel(tab.session), project: projName(tab.session.repoRoot, view), open: () => jumpToTab(token) });
  }
}

// Jump to a tab from a toast: scope to its project if we're viewing a different one, then activate it.
function jumpToTab(token: string): void {
  const tab = tabOf(token);
  // Closed since the toast went up: there is nothing left to go to.
  if (!tab) return;
  const { activeProject } = store.get();
  if (activeProject !== null && activeProject !== tab.session.repoRoot) {
    hostOf('claude').selectProject(tab.session.repoRoot);
  }
  activateTab(token);
}
