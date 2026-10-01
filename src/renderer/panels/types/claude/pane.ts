import { projectGoneReason, sessionLabel, unstartableReason } from '../../../logic';
import { store, type TabState, type View } from '../../../state/app';
import { projectGone, tabOnShow, visibleTabs } from '../../../state/views';
import { setUnavailable, unavailable } from '../../../unavailable';
import { element, fromMarkup } from '../../../dom';
import { HistoryBar } from './history/bar';
import { HistoryView } from './history/view';
import { activateTab, isOnShow, terminalOf, terminalsEl } from './terminals';
// Its Resume, in its own actions and in the history's note.
import '../../../decisive-button.css';
import './pane.css';

/**
 * The terminal area's pane: the tab on show's live terminal, its history over it or standing in for it, or the sentence that says why there is neither, with the next move it names.
 * The pane follows the store (`paneFollows`): the tabs and the tab on show, and the listing and the project on show, since its sentence depends on whether there are sessions at all and whether the project's folder is still there.
 */

const placeholder = fromMarkup(`<div id="term-placeholder" class="pane-placeholder">Pick a tab above, or a session in the sidebar, to resume it.</div>`);
terminalsEl.prepend(placeholder);
// The active tab's history, over the terminal area (history/view.ts): one view, pointed at whichever session the pane shows.
export const history = new HistoryView({
  getHistory: (id, known, generation) => window.claudeUi.getHistory(id, known, generation),
  toggleHistoryPin: (id, pin) => window.claudeUi.toggleHistoryPin(id, pin),
  openExternal: (url) => window.claudeUi.openExternal(url),
  leave: () => showHistory(false),
  open: () => openHistory(),
});
terminalsEl.append(history.scrim, history.el);
// Its bar, beside the terminal area: picking an entry on it opens the history there, from live or not.
const historyBar = new HistoryBar(
  history,
  (entry) => {
    openHistory();
    history.goTo(entry.k, entry.part);
  },
  openHistory,
);
history.onLayout = () => historyBar.refresh();
history.onScroll = () => historyBar.moveBand();

/** The pane, built here and placed by the terminal area (index.ts) under the tab bar: the terminals, with the history over them, and the history's bar beside them. */
export const paneEl = element('div');
paneEl.id = 'terminal-body';
paneEl.append(terminalsEl, historyBar.el);

/** Ctrl+Shift+↑ / ↓, which the terminal area catches (index.ts): the previous / next request. From live, ↑ opens the history at your last request and ↓ does nothing; in the history they step, and ↓ past the last request goes back to live. */
export function stepHistory(up: boolean): void {
  if (!history.shown) {
    if (up) historyBar.pickLast();
  } else if (!history.step(up ? -1 : 1) && !up && !history.standing) showHistory(false);
}

/**
 * Hand the pane to the history, or back to the live terminal.
 * Only ever on purpose — the bar, its foot arrow, Ctrl+Shift+↑ — and never from the wheel, which scrolls claude's own view: the point is to work in the session, and a scroll that turned into another mode was a surprise.
 */
function showHistory(shown: boolean): void {
  const tab = tabOnShow(store.get());
  if (history.setShown(shown) && !shown && tab) terminalOf(tab.token).term.focus();
}

/** What the pane draws from the store. */
type PaneView = View<'sessions' | 'activeProject' | 'tabs' | 'activeTab'>;

/** The tab on show, and whether it is cold (no claude behind it) or booting (claude on its way, nothing printed yet). */
function shownTab(view: PaneView): { activeTab: TabState | null; cold: boolean; booting: boolean } {
  const activeTab = tabOnShow(view);
  return { activeTab, cold: activeTab !== null && activeTab.terminalId === null, booting: activeTab?.booting === true };
}

/** What the pane last drew: the tab on show as it was, and the sentence it said. */
let drawnTab: TabState | null = null;
let drawnSentence: string | null = null;

function updatePlaceholder(view: PaneView): void {
  const { activeTab, cold, booting } = shownTab(view);
  // The history follows the tab from here, since every change to what the pane shows passes through this function; a tab switch shows the new tab as you left it, live or in its history.
  history.follow(activeTab?.session.id ?? null);
  // Shown for a COLD selected tab as well as for no tab at all: its terminal exists but is empty, so without this a restored session would look like a session that had nothing in it.
  // A booting tab HAS a terminal, but it is still empty: keep the pane covered rather than showing the black rectangle that the wait would otherwise be.
  placeholder.style.display = activeTab && !cold && !booting ? 'none' : 'flex';
  historyBar.setLive(activeTab !== null && !cold && !booting);
  const sentence = paneSentence(view);
  drawnTab = activeTab;
  drawnSentence = sentence;
  // A tab on show with no claude behind it — restored, or refused a start — says so, and offers the two things to do about it: resume it, or read what it said.
  const standing = activeTab && cold && !booting ? activeTab : null;
  if (standing) {
    const actions = document.createElement('div');
    actions.className = 'pane-actions';
    const show = document.createElement('button');
    show.type = 'button';
    show.textContent = 'Show history';
    show.addEventListener('click', openHistory);
    actions.append(resumeButton(standing), show);
    const line = document.createElement('div');
    line.textContent = sentence;
    placeholder.replaceChildren(line, actions);
  } else placeholder.textContent = sentence;
  // The history, once asked for on such a tab, stands under the same sentence; a tab that is no longer cold takes the pane back.
  if (!standing) history.setStandalone(null);
  else if (history.standing) history.setStandalone(sentence, resumeButton(standing));
}

/** The session each open tab held when the pane last looked, by token, so it knows whose history to forget when a tab closes. */
let paneSessions: ReadonlyMap<string, string> = new Map();

/**
 * The tab on show changed, or changed state, or what the pane says without one changed: the pane follows.
 * Another tab starting, printing or stopping leaves it alone: a change to one tab is a new entry for that tab only.
 * A tab that closed has its history forgotten, so opening its session again starts with it closed — after the follow, which is what remembers how the tab on show was left.
 * A watcher the terminal area registers (watch.ts), and start-up's first draw, before anything is told.
 */
export function paneFollows(view: PaneView): void {
  const before = paneSessions;
  paneSessions = new Map(view.tabs.map((t) => [t.token, t.session.id]));
  if (tabOnShow(view) !== drawnTab || paneSentence(view) !== drawnSentence) updatePlaceholder(view);
  for (const [token, id] of before) if (!paneSessions.has(token)) history.forget(id);
}

/** Resume the tab on show, as a click on it does; unavailable, with the reason, when its folder has gone. */
function resumeButton(tab: TabState): HTMLButtonElement {
  const { token } = tab;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary';
  button.textContent = 'Resume';
  setUnavailable(button, unstartableReason(tab.session), 'Start claude in this session again');
  button.addEventListener('click', () => {
    if (!unavailable(button) && isOnShow(token)) activateTab(token);
  });
  return button;
}

/**
 * Open the history of the tab on show: over its live terminal, or, for a tab with no claude behind it, standing under the sentence the pane says, since there is no live view to go back to.
 * Every way in comes here — the bar, its foot arrow, Ctrl+Shift+↑, a cold tab's "Show history", a tab reopening its history where it was left — so they cannot disagree about which.
 */
function openHistory(): void {
  const activeTab = tabOnShow(store.get());
  if (!activeTab) return;
  if (activeTab.terminalId === null && !activeTab.booting) history.setStandalone(paneSentence(store.get()), resumeButton(activeTab));
  else showHistory(true);
}

/** What the pane says when there is no live claude to show: one sentence, and the next move it names. */
function paneSentence(view: PaneView): string {
  const { activeProject } = view;
  const { activeTab, cold, booting } = shownTab(view);
  if (booting) return `Starting “${sessionLabel(activeTab!.session)}”…`;
  // A start that was REFUSED says why, in place of "click its tab to resume it" — which would be telling you to do the thing that just failed.
  if (activeTab?.failure) return activeTab.failure;
  // Four different situations reach this pane, and each has a different next move — one sentence covering all of them tells someone with no sessions to pick one, and someone with no tabs to pick a tab that isn't there.
  return cold
    ? `“${sessionLabel(activeTab!.session)}” isn’t running.`
    : view.sessions.length === 0
      ? 'No sessions yet — start one with + New.'
      : // Nothing in a dead project can be opened or resumed, so pointing at its sessions or tabs would send you to a click that is refused.
        activeProject !== null && projectGone(activeProject, view)
        ? projectGoneReason(activeProject)
        : // visibleTabs, not tabs: a project view shows only its own, so "pick a tab above" was being offered next to an empty bar whenever the open tabs all belonged to other projects.
          visibleTabs(view).length === 0
          ? 'Pick a session in the sidebar to open it.'
          : 'Pick a tab above, or a session in the sidebar, to resume it.';
}
