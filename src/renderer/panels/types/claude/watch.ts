import { store } from '../../../state/app';
import { tabOnShow } from '../../../state/views';
import { toastAttention } from './attention';
import { railStatusFollowsTabs } from './index';
import { history, paneFollows } from './pane';
import { renderTabBar, tabBarFollowsStatuses } from './tab-bar';
import { adoptReplacement, reconcileOpenTabs, stopCalledOff } from './terminals';

/**
 * What the terminal area follows, in the store and from main, registered by renderer.ts beside the sidebar's (docs/architecture.md § The store): its rules, which set state as they are told, before any repaint, then its repaints; and its part of what main sends, which renderer.ts's one handler per event calls ahead of the app's own.
 * Inside each block the order is the type's own; no order across the two types matters (measured in 08a6ac4).
 */
export const claudeWatch = {
  rules(): void {
    // The listing moved: the open tabs adopt their sessions' fresh summaries.
    store.watch(['sessions'], reconcileOpenTabs, { reads: ['tabs'] });
  },

  repaints(): void {
    // A tab not on show turned waiting or finished: a toast says so.
    store.watch(['statuses'], toastAttention, { reads: ['tabs', 'activeTab', 'projectNames'] });
    // The tab bar clusters its tabs by group, places its projects by the order under their names, and shows the project on show's tabs, as the list does: it follows the same changes, and every change to a tab or to which one is on show.
    store.watch(['groupState', 'projectNames', 'projectOrder', 'activeProject', 'tabs', 'activeTab'], renderTabBar, { reads: ['sessions', 'statuses', 'acked'] });
    // And a status or a mark read of one of its tabs' sessions.
    store.watch(['statuses', 'acked'], tabBarFollowsStatuses, { reads: ['sessions', 'groupState', 'projectNames', 'projectOrder', 'activeProject', 'tabs', 'activeTab'] });
    // The terminal area's rail icon waits while a tab on show waits for you.
    store.watch(['activeProject', 'tabs', 'statuses', 'acked'], railStatusFollowsTabs);
    // The pane shows the tab on show, or says why there is none, which turns on the listing and the project on show too.
    store.watch(['sessions', 'activeProject', 'tabs', 'activeTab'], paneFollows);
  },

  /** A status event, before the app sets the status: a cleared session's successor is the tab's first. */
  sessionStatus(id: string, tabToken: string, event: string): void {
    // `/clear` gives a tab a session of Claude Code's choosing, which the tab takes over.
    if (tabToken) adoptReplacement(tabToken, id);
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
