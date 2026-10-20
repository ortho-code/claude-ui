import { sessionLabel } from '../../../logic';
import { store } from '../../../state/app';
import { tabOnShow } from '../../../state/views';
import { showToast } from '../../../toast';
import { jumpToSession } from './asks';
import { toastAttention } from './attention';
import { railStatusFollowsTabs } from './index';
import { history, paneFollows } from './pane';
import { renderTabBar, tabBarFollowsStatuses } from './tab-bar';
import { adoptReplacement, reconcileOpenTabs, stopCalledOff } from './terminals';

/**
 * What the terminal area follows, in the store and from main, registered by renderer.ts beside the sidebar's (docs/architecture.md § The store): its rules, which set state as they are told, before any repaint, then its repaints; and its part of what main sends, which renderer.ts's one handler per event calls ahead of the app's own.
 * Inside each block the order is the type's own; no order across the two types matters (measured in 08a6ac4).
 */
/** A tab's claude went on in session `id`: the tab takes it over, or, where another tab already runs it, that tab comes on show, saying why. */
function followSwitch(tabToken: string, id: string, source: string): void {
  const runningIt = adoptReplacement(tabToken, id, source);
  if (!runningIt) return;
  jumpToSession(runningIt.session);
  showToast(`"${sessionLabel(runningIt.session)}" is already running in another tab`);
}

export const claudeWatch = {
  rules(): void {
    // The listing moved: the open tabs adopt their sessions' fresh summaries.
    store.watch(['sessions'], reconcileOpenTabs, { reads: ['tabs'] });
  },

  repaints(): void {
    // A tab not on show turned waiting or finished: a toast says so.
    store.watch(['statuses'], toastAttention, { reads: ['tabs', 'activeTab', 'projectNames'] });
    // The tab bar clusters its tabs by group, places its projects by the order under their names, and shows the project on show's tabs, as the list does: it follows the same changes, every change to a tab or to which one is on show, and its fold.
    store.watch(['groupState', 'projectNames', 'projectOrder', 'activeProject', 'tabs', 'activeTab', 'tabBarExpanded'], renderTabBar, { reads: ['sessions', 'statuses', 'backgroundTasks', 'acked', 'archived'] });
    // And a status, the work behind one, or a mark read of one of its tabs' sessions, which its fold's dot follows too.
    store.watch(['statuses', 'backgroundTasks', 'acked'], tabBarFollowsStatuses, { reads: ['sessions', 'archived', 'groupState', 'projectNames', 'projectOrder', 'activeProject', 'tabs', 'activeTab', 'tabBarExpanded'] });
    // The terminal area's rail icon waits while a tab on show waits for you.
    store.watch(['activeProject', 'tabs', 'statuses', 'acked'], railStatusFollowsTabs);
    // The pane shows the tab on show, or says why there is none, which turns on the listing and the project on show too.
    store.watch(['sessions', 'activeProject', 'tabs', 'activeTab'], paneFollows);
  },

  /** A claude starting on a session in a tab: the session the tab runs from now, and why. */
  sessionStart(id: string, tabToken: string, source: string): void {
    // `/clear` gives a tab a session of Claude Code's choosing, and its own `/resume` one that already exists, which the tab takes over.
    if (tabToken) followSwitch(tabToken, id, source);
  },

  /** A status event, before the app sets the status: a session the tab did not know it runs is the tab's first. */
  sessionStatus(id: string, tabToken: string, event: string): void {
    // Its start says so too, and why (`sessionStart`); this catches an id whose start has not reached the app first, and does not know why.
    // Not a SessionStart's own status: it can arrive before the start that says why, and the take-over would then not know the clear it was.
    // Nor a SessionEnd: it says the reporting tab's claude has left that session, so it is never what that tab runs, and the one the tab just left can report its end after the start of the next, since main reads each file as it changes and the reads can finish in either order.
    if (tabToken && event !== 'SessionStart' && event !== 'SessionEnd') followSwitch(tabToken, id, '');
    // A prompt, and only a prompt: a session asked to leave that submits one has stayed.
    // Any busy would not do, since a tool call's report still on its way when the stop was pressed would call off a stop that is going ahead.
    // A prompt's own report can be on its way the same way, from one submitted just before the stop; that narrower case closes the tab at the exit instead of cooling it.
    if (tabToken && event === 'UserPromptSubmit') stopCalledOff(tabToken);
    // What claude just did is in the transcript, and the history of the session on show reads it.
    if (tabOnShow(store.get())?.session.id === id) void history.refresh();
  },

  /** A transcript created or changed on disk: the history on show reads only what was added. */
  sessionsChanged(): void {
    void history.refresh();
  },
};
