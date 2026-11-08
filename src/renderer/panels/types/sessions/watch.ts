import { store } from '../../../state/app';
import { railStatusFollowsSessions } from './index';
import { fallBackIfEmptied, refreshSwitcher } from './switcher';
import { applyDatePickerMinDate, filterPanelFollows } from './filter';
import { watchList } from './list';
import { watchReviewButton } from './review';
import { watchArrangement } from './arrangement';
import { watchPrStatus } from './pr-status';

/**
 * What the sidebar follows in the store, registered by renderer.ts beside the terminal area's (docs/architecture.md § The store): its rules, which set state as they are told, before any repaint, then its repaints.
 * Inside each block the order is the type's own; no order across the two types matters (measured in 08a6ac4).
 */
export const sessionsWatch = {
  rules(): void {
    // What the switcher's projects are made of changed, and the project on show may have none left.
    // The tabs are among them: a session with no transcript yet is in its project only through its tab.
    store.watch(['sessions', 'finished', 'pendingDeletes', 'tabs'], fallBackIfEmptied, { reads: ['activeProject'] });
    // What GitHub says of the PRs the listing links, asked as they change and on a timer after.
    watchPrStatus();
  },

  repaints(): void {
    // The listing moved: the calendar's first day is the oldest session's.
    store.watch(['sessions'], applyDatePickerMinDate);
    // The list, its tabs' marks and its dots, each told of only what it draws again (list.ts).
    watchList();
    // The Review button counts the review in scope, as the store and the clock move (review.ts).
    watchReviewButton();
    // The switch between Grouped and Recent follows the arrangement, unavailable while the review is open (arrangement.ts).
    watchArrangement();
    // The filter panel opened or shut: it follows, with the chips that stand in for it while it is shut.
    store.watch(['filterPanelOpen'], filterPanelFollows, { reads: ['filter'] });
    // The switcher counts every project's sessions, rolls up their statuses and names the project on show.
    // A session with no transcript yet is in its project only through its tab, so the tabs are among what it counts.
    // The strength order, and the categories that place a reason in it, decide which state each roll-up shows.
    store.watch(['sessions', 'statuses', 'acked', 'needsYou', 'setAside', 'finished', 'pendingDeletes', 'projectNames', 'projectOrder', 'activeProject', 'tabs', 'settings', 'needsYouTypes'], refreshSwitcher);
    // The sidebar's rail icon waits while any session anywhere waits for you: the switcher's roll-up, from the same sessions.
    store.watch(['sessions', 'statuses', 'acked', 'needsYou', 'setAside', 'finished', 'pendingDeletes', 'tabs', 'settings', 'needsYouTypes'], railStatusFollowsSessions, { reads: ['projectNames', 'projectOrder'] });
  },
};
