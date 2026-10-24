import { clockOf, clockText, notLeftWords, sessionLabel } from '../../../logic';
import { showAttentionToast } from '../../../notifications';
import type { View } from '../../../state/app';
import { projName, tabWith } from '../../../state/views';
import { jumpToSession } from './asks';
import { tabOf } from './terminals';

/**
 * The terminal area's attention toasts: a tab not on show that turns waiting or finished says so in a toast (drawn by notifications.ts), and so does one whose claude has not left a stop, and a click on it goes to that tab.
 * Watchers of the statuses (`toastAttention`) and of the tabs (`toastNotLeft`), which the terminal area registers (watch.ts).
 */

/**
 * A real transition into waiting/idle on a tab you're not looking at -> toast it.
 * Never for busy, a cleared status, a no-op repeat, or the tab you're already on.
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

/** The toast up for each tab whose claude has not left a stop, by its token, as the function that takes it down. */
const notLeftToasts = new Map<string, () => void>();

/**
 * A stop claude has not left a while after the ask (`notLeftWords`) on a tab not on show -> a toast that stays, saying so with what the session has scheduled, since claude may be asking about it, out of sight.
 * Not raised for the tab on show, whose question is on screen, until another tab comes on show, and one up already stays when its tab comes on show; once only per stop, so a toast dismissed stays dismissed; taken down when the stop ends, however it ends.
 */
export function toastNotLeft(view: View<'tabs' | 'activeTab' | 'scheduledTasks' | 'projectNames'>): void {
  for (const [token, takeDown] of notLeftToasts) {
    const tab = view.tabs.find((t) => t.token === token);
    if (tab && notLeftWords(tab)) continue;
    takeDown();
    notLeftToasts.delete(token);
  }
  for (const tab of view.tabs) {
    if (!notLeftWords(tab) || tab.token === view.activeTab || notLeftToasts.has(tab.token)) continue;
    const { token } = tab;
    const tasks = clockText(clockOf(view.scheduledTasks.get(tab.session.id), tab));
    const detail = ["Claude hasn't left — it may be asking you something", ...(tasks ? [tasks] : [])].join('\n');
    notLeftToasts.set(token, showAttentionToast({ status: 'waiting', label: sessionLabel(tab.session), project: projName(tab.session.repoRoot, view), detail, open: () => jumpToTab(token) }, true));
  }
}

// Jump to a tab from a toast as the strip jumps to a session: its project, its tab, and its row in the list.
function jumpToTab(token: string): void {
  const tab = tabOf(token);
  // Closed since the toast went up: there is nothing left to go to.
  if (!tab) return;
  jumpToSession(tab.session);
}
