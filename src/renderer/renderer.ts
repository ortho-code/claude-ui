// The bundle's stylesheets come in the order of these imports: what every module draws with, then the services' and the panel tree's own, then the rules no module has taken yet, which build on all of them.
import './base.css';
// The services the sidebar's list draws with are imported here for their stylesheets' place in that order, ahead of every panel.
import './menu';
import './unavailable';
import { hideToast, showToast } from './toast';
import './notifications';
import './dialogs';
import { openSettings } from './settings';
import './projectgone';
import { startChrome } from './chrome';
import './flash';
import { initTree, loadLayout, startPanels, restoreTreeState, treeState, treeContextChanged, treeSessionsChanged } from './panels/tree';
import { railStatusFollowsTabs } from './panels/types/claude/index';
import { history, paneFollows } from './panels/types/claude/pane';
import { adoptReplacement, reconcileOpenTabs, restoreOpenTabs, switchWorkspaceTerminal } from './panels/types/claude/terminals';
import { renderTabBar, tabBarFollowsStatuses } from './panels/types/claude/tab-bar';
import { railStatusFollowsSessions } from './panels/types/sessions/index';
import { fallBackIfEmptied, refreshSwitcher } from './panels/types/sessions/switcher';
import { refreshStrip } from './panels/types/sessions/attention-strip';
import { applyDatePickerMinDate, filterPanelFollows } from './panels/types/sessions/filter';
import { container, dotsFollowStatuses, listChanged, listFollowsTabs, renderList, renderSessions } from './panels/types/sessions/list';
import { forgetDeletedGroupFolds, restoreSidebar, sidebarSnapshot } from './panels/types/sessions/stored-view';
import { claudeAnswers } from './panels/types/claude/asks';
import { toastAttention } from './panels/types/claude/attention';
import { sessionsAnswers } from './panels/types/sessions/asks';
import './styles.css';
import { store, withEntry, type StoredView } from './state/app';
import { tabOnShow, tabWith } from './state/views';
import { setStatus } from './state/statuses';
import type { UiState } from '../shared/types';
import { installTooltips } from './tooltip';
import { strokeIcon } from './svg';
import { routeTerminals } from './terminal';
import { hostOf } from './panels/types/builtin';

const newButton = document.getElementById('new-session') as HTMLButtonElement;

// Settings as two sliders, each with its knob.
const settingsIcon = (size: number): string =>
  strokeIcon(size, '<path d="M2 4.6h8.1M13.1 4.6h.9M2 11.4h2.9M7.9 11.4h6.1" /><circle cx="11.7" cy="4.6" r="1.6" /><circle cx="6.4" cy="11.4" r="1.6" />');
const settingsToggle = document.getElementById('settings-toggle') as HTMLButtonElement;

// A disk change fired: re-read sessions; the store tells the list and the tabs only when the structure actually changed (a new/removed session, a rename, or a new branch becoming the tip).
// Statuses and pins arrive on their own channels, so we don't refetch them here.
async function refreshFromDisk(): Promise<void> {
  store.set({ sessions: await window.claudeUi.listSessions() });
}

// --- View state that survives a restart ---
// Search, filters, folds, width and scroll are one answer to one question — put the sidebar back the way it was — so they are snapshotted, stored and restored together rather than as a setting each.

// Nothing is written until the start-up read has put the stored view back in the store (`startSavingUi`), or a save in between would write an empty sidebar straight over the real one.
let uiRestored = false;
let uiSaveTimer: number | undefined;
// The last snapshot actually sent. Renders happen for reasons that have nothing to do with the view — a transcript growing, a status dot changing — and without this each one would cost a full read-modify-write of meta.json.
let lastUiSignature = '';

/** The view to store: the sidebar's part and the layout tree's, in the one shape `meta.json` keeps. */
function uiSnapshot(view: StoredView = store.get()): UiState {
  return {
    ...sidebarSnapshot(view),
    // Adopted into the layout tree's sizes on the first launch that has them, and not written again: the tree owns the sidebar's width now.
    sidebarWidth: null,
    panelState: treeState(),
  };
}

/**
 * Store the view, on a debounce: a watcher of the view's slices, and called by what the store does not hold — the list's scroll, and the layout tree's sizes, folds and picks.
 * Typing in the search box and dragging the scrollbar both change this state continuously, and every write is a read-modify-write of meta.json plus an audit line, so what is wanted is one write per pause rather than one per keystroke.
 */
function persistUi(): void {
  if (!uiRestored) return;
  if (uiSaveTimer !== undefined) clearTimeout(uiSaveTimer);
  uiSaveTimer = window.setTimeout(() => {
    uiSaveTimer = undefined;
    const state = uiSnapshot();
    const signature = JSON.stringify(state);
    if (signature === lastUiSignature) return;
    lastUiSignature = signature;
    window.claudeUi.setUiState(state);
  }, 400);
}

/**
 * Put the sidebar back the way it was left, and hand back what the start-up read sets in the store with the listing (`renderSessions`), and the scroll offset to apply once there is a list to scroll.
 *
 * Runs before the first render on purpose, and the view goes into the store in the same change as the listing: restoring filters afterwards would draw the full list and then visibly cut it down.
 * What is drawn straight from what was stored — the search box, the calendar, the chosen preset, the panel — is put back by the sidebar (`restoreSidebar`), before the layout places it; the tree puts back its own part.
 */
async function restoreUiState(): Promise<{ scrollTop: number; view: StoredView }> {
  const state = await window.claudeUi.getUiState();
  // The sidebar's width lived in localStorage, then in `sidebarWidth`; either is adopted once into the layout tree's sizes, so an existing install keeps its sidebar, and the tree owns it from here.
  restoreTreeState(state.panelState, state.sidebarWidth ?? Number(localStorage.getItem('sidebarWidth')));
  const restored = await restoreSidebar(state);
  // Seed the signature from what was just restored, so an opening render that changed nothing writes nothing.
  lastUiSignature = JSON.stringify(uiSnapshot(restored.view));
  return restored;
}

/** From the start-up read on, the view in the store is the one you left, so it can be saved; anything asked for meanwhile — the layout dropping a stale split's sizes, say — is written now, if it changed anything. */
function startSavingUi(): void {
  uiRestored = true;
  persistUi();
}

settingsToggle.addEventListener('click', () => void openSettings());

// --- Wiring ---

// Output and exits reach a tab through the sink it bound when it started (terminal.ts routes them by terminal id, for tabs and panels alike).
routeTerminals();

// --- What the store tells ---
// Subscribed before start-up sets anything, and told in this order.

// What the switcher's projects are made of changed, and the project on show may have none left: first, so everything after draws All rather than the empty project.
// The tabs are among them: a session with no transcript yet is in its project only through its tab.
store.watch(['sessions', 'archived', 'pendingDeletes', 'tabs'], fallBackIfEmptied, { reads: ['activeProject'] });

// The listing moved: the open tabs adopt their sessions' fresh summaries, before the list draws them, and the calendar's first day is the oldest session's.
store.watch(['sessions'], reconcileOpenTabs, { reads: ['tabs'] });
store.watch(['sessions'], applyDatePickerMinDate);

// Something the list draws changed — the listing, a model switch, a pin, the archive, a note, a delete in flight, the groups, a project's name or place, the project on show, the filter — and the list follows, with the filter's count and chips it draws.
// The list paints every dot it draws, but a status change repaints only the dots, below.
store.watch(
  ['sessions', 'switchedModel', 'pinned', 'archived', 'notes', 'pendingDeletes', 'groupState', 'projectNames', 'projectOrder', 'activeProject', 'filter'],
  listChanged,
  // The folds are read, never told: a heading's click folds in place without drawing the list, and whoever else folds draws it.
  { reads: ['statuses', 'acked', 'tabs', 'activeTab', 'folds', 'filterPanelOpen'] },
);

// A tab opened, started, stopped, closed or came on show: the rows' marks, and the list itself when what it draws from the tabs moved.
store.watch(['tabs', 'activeTab'], listFollowsTabs, {
  reads: ['sessions', 'statuses', 'acked', 'switchedModel', 'pinned', 'archived', 'notes', 'pendingDeletes', 'groupState', 'projectNames', 'projectOrder', 'activeProject', 'filter', 'folds', 'filterPanelOpen'],
});

// The filter panel opened or shut: it follows, with the chips that stand in for it while it is shut.
store.watch(['filterPanelOpen'], filterPanelFollows, { reads: ['filter'] });

// A status or a mark read changed: the rows' dots that differ.
store.watch(['statuses', 'acked'], dotsFollowStatuses);

// A tab not on show turned waiting or finished: a toast says so.
store.watch(['statuses'], toastAttention, { reads: ['tabs', 'activeTab', 'projectNames'] });

// The tab bar clusters its tabs by group, places its projects by the order under their names, and shows the project on show's tabs, as the list does: it follows the same changes, and every change to a tab or to which one is on show.
store.watch(['groupState', 'projectNames', 'projectOrder', 'activeProject', 'tabs', 'activeTab'], renderTabBar, { reads: ['sessions', 'statuses', 'acked'] });
// And a status or a mark read of one of its tabs' sessions.
store.watch(['statuses', 'acked'], tabBarFollowsStatuses, { reads: ['sessions', 'groupState', 'projectNames', 'projectOrder', 'activeProject', 'tabs', 'activeTab'] });

// The switcher counts every project's sessions, rolls up their statuses and names the project on show.
// A session with no transcript yet is in its project only through its tab, so the tabs are among what it counts.
store.watch(['sessions', 'statuses', 'acked', 'archived', 'pendingDeletes', 'projectNames', 'projectOrder', 'activeProject', 'tabs'], refreshSwitcher);

// The sidebar's rail icon waits while any session anywhere waits for you: the switcher's roll-up, from the same sessions.
store.watch(['sessions', 'statuses', 'acked', 'archived', 'pendingDeletes', 'tabs'], railStatusFollowsSessions, { reads: ['projectNames', 'projectOrder'] });

// The strip lists what runs, in the bar's order, each row with a stop button in the tab's state, under a line badged with the switcher's roll-up; it shows those rows or folds to its line as you left it.
store.watch(['sessions', 'statuses', 'acked', 'archived', 'pendingDeletes', 'groupState', 'projectNames', 'projectOrder', 'tabs', 'footerExpanded'], refreshStrip);

// The terminal area's rail icon waits while a tab on show waits for you.
store.watch(['activeProject', 'tabs', 'statuses', 'acked'], railStatusFollowsTabs);

// The pane shows the tab on show, or says why there is none, which turns on the listing and the project on show too.
store.watch(['sessions', 'activeProject', 'tabs', 'activeTab'], paneFollows);

// The view you are leaving behind — the filter, the folds, the panel, the strip — is kept for the next launch; the snapshot is compared before it is written, so a change that ends where it began costs nothing.
store.watch(['filter', 'folds', 'filterPanelOpen', 'footerExpanded'], () => persistUi());

// The panels run where you are: in the tab on show's folder, or without one in the project's root, or in nothing in the All view.
store.watch(['activeProject', 'activeTab'], treeContextChanged);

// A panel's rows mark the sessions they started — each one's title, status dot, mark read, and whether it runs — so the panels hear of every change to those, and to which sessions a panel's rows started (its data, panels/links.ts).
store.watch(['sessions', 'statuses', 'acked', 'tabs', 'panelData'], treeSessionsChanged);

window.claudeUi.onSessionStatus((id, status, tabToken) => {
  // `/clear` gives a tab a session of Claude Code's choosing, which the tab takes over.
  if (tabToken) adoptReplacement(tabToken, id);
  // What claude just did is in the transcript, and the history of the session on show reads it.
  if (tabOnShow(store.get())?.session.id === id) void history.refresh();
  // 'start' reports which session a tab is running, not a state it is in — and it fires mid-session on clear and compact, where setting a status would wipe a live one.
  // The one SessionStart that does mean a state (a compaction ending) reaches us as 'idle', not as this.
  if (status === 'start') return;
  setStatus(id, status);
  // A new session's title isn't on disk immediately; re-read on its status events until it is (this also replaces the tab's own stand-in row with the real one).
  if (tabWith(id) && !store.get().sessions.some((s) => s.id === id)) void refreshFromDisk();
});

window.claudeUi.onSessionModel((id, model) => {
  store.set({ switchedModel: withEntry(store.get().switchedModel, id, model) });
});

// The sidebar keeps itself current: a transcript created or changed on disk re-renders it.
// So does the history on show, which reads only what was added.
window.claudeUi.onSessionsChanged(() => {
  void refreshFromDisk();
  void history.refresh();
});

// Without the CLI every tab would open on "command not found", which reads as this app being broken rather than as a missing prerequisite. Say which one, and stay on screen until dismissed.
window.claudeUi.onClaudeMissing(() => {
  showToast('The claude CLI was not found on your PATH. Install it and restart claude-ui.', true);
});

async function pickFolderAndOpen(): Promise<void> {
  // Show an active state while the folder picker is open (it has no persistent menu of its own), matching how the other header buttons look while their panel/menu is up.
  newButton.classList.add('active');
  try {
    const dir = await window.claudeUi.pickFolder();
    if (dir) void hostOf('sessions').openNewSession(dir);
  } finally {
    newButton.classList.remove('active');
  }
}
newButton.addEventListener('click', () => void pickFolderAndOpen());
// The header's Settings icon comes from here too, rather than inline in the sidebar's markup, so it is drawn through the same helper as the rest.
settingsToggle.innerHTML = settingsIcon(14);
// Where the list was scrolled to is remembered, so a scroll of your own is a change to remember too.
container.addEventListener('scroll', persistUi);

// The window's own title bar, where the app draws its chrome (chrome.ts).
void startChrome();

installTooltips();
// The window's layout, drawn now so the first paint is already the window: the default layout until the file has been read, which the start-up below does before it draws a single row.
initTree({
  where: () => {
    const state = store.get();
    const tab = tabOnShow(state);
    return { tab: tab ? { cwd: tab.session.cwd, repoRoot: tab.session.repoRoot, id: tab.session.id } : null, project: state.activeProject };
  },
  showToast,
  hideToast,
  persist: persistUi,
  // The asks each panel can make, answered by the terminal area and by the sidebar.
  ...claudeAnswers,
  ...sessionsAnswers,
});
// Restore the last-active project and open tabs, then scope the tab bar + terminal to that project.
void (async () => {
  void window.claudeUi.getHistoryPins().then((pins) => history.setPins(pins));
  // Before the first render: restoring filters afterwards would draw the whole list and then visibly cut it down.
  const { scrollTop, view } = await restoreUiState();
  // Before the rows and the tabs too: placing the layout moves the sidebar and the terminal area into it, and a move is cheapest, and invisible, while they are still empty.
  await loadLayout();
  // With the project you were in and the view you left, which scope and filter the first draw.
  await renderSessions({ startUp: view });
  forgetDeletedGroupFolds(store.get());
  startSavingUi();
  await restoreOpenTabs();
  // Again, now that the tabs exist. Two filters — open, and running — are questions about the TABS, and the render above happened while there were none, so a restored "open" filter would otherwise show an empty list next to a full tab bar. It also puts the open marker on the rows, which used to wait for the next render for its own reasons.
  renderList(store.get());
  // Last, because there is nothing to scroll until the rows are on screen. Later renders carry the offset along themselves.
  container.scrollTop = scrollTop;
  switchWorkspaceTerminal(store.get().activeProject);
  // After the tabs, so a panel's first run is in the restored tab's folder rather than once for the project and again for the tab.
  startPanels();
})();
paneFollows(store.get());
