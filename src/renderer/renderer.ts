// The bundle's stylesheets come in the order of these imports: what every module draws with, then the services', then the panel tree's and the panel types' own, each module's beside it.
import './base.css';
// The services the sidebar's list draws with are imported here for their stylesheets' place in that order, ahead of every panel.
import './menu';
import './unavailable';
import { hideToast, showToast } from './toast';
import './notifications';
import './dialogs';
import './settings';
import './projectgone';
import { startChrome } from './chrome';
import './flash';
import { initTree, loadLayout, startPanels, treeContextChanged, treeSessionsChanged } from './panels/tree';
import { history, paneFollows } from './panels/types/claude/pane';
import { restoreOpenTabs, switchWorkspaceTerminal } from './panels/types/claude/terminals';
import { claudeWatch } from './panels/types/claude/watch';
import { sessionsWatch } from './panels/types/sessions/watch';
import { container, renderSessions } from './panels/types/sessions/list';
import { forgetDeletedGroupFolds } from './panels/types/sessions/stored-view';
import { claudeAnswers } from './panels/types/claude/asks';
import { sessionsAnswers } from './panels/types/sessions/asks';
import { persistUi, restoreUiState, startSavingUi } from './view-saving';
import { store, withEntry } from './state/app';
import { tabOnShow, tabWith } from './state/views';
import { setStatus } from './state/statuses';
import { installTooltips } from './tooltip';
import { routeTerminals } from './terminal';

// A disk change fired: re-read sessions; the store tells the list and the tabs only when the structure actually changed (a new/removed session, a rename, or a new branch becoming the tip).
// Statuses and pins arrive on their own channels, so we don't refetch them here.
// As of when it asked: changes close together send reads that can land out of order, and the listing asked first must not land over one asked after it.
async function refreshFromDisk(): Promise<void> {
  const readAt = store.stamp();
  store.set({ sessions: await window.claudeUi.listSessions() }, { readAt });
}

// --- Wiring ---

// Output and exits reach a tab through the sink it bound when it started (terminal.ts routes them by terminal id, for tabs and panels alike).
routeTerminals();

// --- What the store tells ---
// Subscribed before start-up sets anything, and told in this order.

// Each built-in's own, in blocks (panels/types/*/watch.ts): the rules, which set state as they are told, before any repaint that draws it; no order across the two types matters (measured in 08a6ac4).
sessionsWatch.rules();
claudeWatch.rules();
sessionsWatch.repaints();
claudeWatch.repaints();

// The view you are leaving behind — the filter, the folds, the panel, the strip — is kept for the next launch; the snapshot is compared before it is written, so a change that ends where it began costs nothing.
store.watch(['filter', 'folds', 'filterPanelOpen', 'footerExpanded'], () => persistUi());

// The panels run where you are: in the tab on show's folder, or without one in the project's root, or in nothing in the All view.
store.watch(['activeProject', 'activeTab'], treeContextChanged);

// A panel's rows mark the sessions they started — each one's title, status dot, mark read, and whether it runs — so the panels hear of every change to those, and to which sessions a panel's rows started (its data, panels/links.ts).
store.watch(['sessions', 'statuses', 'acked', 'tabs', 'panelData'], treeSessionsChanged);

window.claudeUi.onSessionStatus((id, status, tabToken) => {
  // The terminal area's part first: a cleared session's successor is the tab's, and the history on show reads what was added.
  claudeWatch.sessionStatus(id, tabToken);
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
// So does the history on show.
window.claudeUi.onSessionsChanged(() => {
  void refreshFromDisk();
  claudeWatch.sessionsChanged();
});

// Without the CLI every tab would open on "command not found", which reads as this app being broken rather than as a missing prerequisite. Say which one, and stay on screen until dismissed.
window.claudeUi.onClaudeMissing(() => {
  showToast('The claude CLI was not found on your PATH. Install it and restart claude-ui.', true);
});

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
  asks: { ...claudeAnswers, ...sessionsAnswers },
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
  // The list follows the tabs as they come (`listFollowsTabs`): drawn again for a restored "open" or "live" filter, which are questions about the tabs, and its rows marked open otherwise.
  await restoreOpenTabs();
  // Last, because there is nothing to scroll until the rows are on screen. Later renders carry the offset along themselves.
  container.scrollTop = scrollTop;
  switchWorkspaceTerminal(store.get().activeProject);
  // After the tabs, so a panel's first run is in the restored tab's folder rather than once for the project and again for the tab.
  startPanels();
})();
paneFollows(store.get());
