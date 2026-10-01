import { store } from '../../../state/app';
// In the order the sidebar's stylesheets take in the bundle, which test/unit/renderer/renderer.test.ts pins: the switcher's and the strip's ahead of the filter's and the list's.
import { railStatusFollowsSessions } from './index';
import { fallBackIfEmptied, refreshSwitcher } from './switcher';
import { refreshStrip } from './attention-strip';
import { applyDatePickerMinDate, filterPanelFollows } from './filter';
import { watchList } from './list';

/**
 * What the sidebar follows in the store, registered by renderer.ts beside the terminal area's (docs/architecture.md § The store): its rules, which set state as they are told, before any repaint, then its repaints.
 * Inside each block the order is the type's own; no order across the two types matters (measured in 08a6ac4).
 */
export const sessionsWatch = {
  rules(): void {
    // What the switcher's projects are made of changed, and the project on show may have none left.
    // The tabs are among them: a session with no transcript yet is in its project only through its tab.
    store.watch(['sessions', 'archived', 'pendingDeletes', 'tabs'], fallBackIfEmptied, { reads: ['activeProject'] });
  },

  repaints(): void {
    // The listing moved: the calendar's first day is the oldest session's.
    store.watch(['sessions'], applyDatePickerMinDate);
    // The list, its tabs' marks and its dots, each told of only what it draws again (list.ts).
    watchList();
    // The filter panel opened or shut: it follows, with the chips that stand in for it while it is shut.
    store.watch(['filterPanelOpen'], filterPanelFollows, { reads: ['filter'] });
    // The switcher counts every project's sessions, rolls up their statuses and names the project on show.
    // A session with no transcript yet is in its project only through its tab, so the tabs are among what it counts.
    store.watch(['sessions', 'statuses', 'acked', 'archived', 'pendingDeletes', 'projectNames', 'projectOrder', 'activeProject', 'tabs'], refreshSwitcher);
    // The sidebar's rail icon waits while any session anywhere waits for you: the switcher's roll-up, from the same sessions.
    store.watch(['sessions', 'statuses', 'acked', 'archived', 'pendingDeletes', 'tabs'], railStatusFollowsSessions, { reads: ['projectNames', 'projectOrder'] });
    // The strip lists what runs, in the bar's order, each row with a stop button in the tab's state, under a line badged with the switcher's roll-up; it shows those rows or folds to its line as you left it.
    store.watch(['sessions', 'statuses', 'acked', 'archived', 'pendingDeletes', 'groupState', 'projectNames', 'projectOrder', 'tabs', 'footerExpanded'], refreshStrip);
  },
};
