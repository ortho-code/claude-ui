import { element } from '../../../ui/dom';
import { store, type View } from '../../../state/app';
import { sessionNudge, strengthNow, visibleTabs } from '../../../state/views';
import { strongestNudge, type NudgeStatus } from '../../../status/rollup';
import { builtinType, hostOf, tellRail } from '../builtin';
import './index.css';
import { tabbar, tabbarEdge } from './tab-bar';
import { paneEl, stepHistory } from './pane';

/**
 * THE TERMINAL AREA as a panel type: the tab bar over the terminals, on a line that folds it, with the history's bar beside them.
 * One pane for the run: built once, parked until the layout places it, and put back by every mount (`builtinType`), so a layout change that remounts its entry — a new id, an option — keeps a running session and its terminal as they were.
 * Each part builds its own markup as it loads — the tab bar and its line (tab-bar.ts), the pane with the terminals and the history's bar (pane.ts, tabstate.ts) — and this module puts them together.
 */
const terminalPane = element('section');
terminalPane.id = 'terminal-pane';
// The tab bar's end holds the full-screen button, beside the tabs rather than among them, so it stays put as they wrap.
const tabbarEnd = element('div', 'tabbar-end');
const tabbarRow = element('div', 'tabbar-row');
tabbarRow.append(tabbar, tabbarEnd);
terminalPane.append(tabbarRow, tabbarEdge, paneEl);
document.getElementById('parked')!.append(terminalPane);

export const claudeType = builtinType('claude', terminalPane, 'Claude', 'claude', { fullScreenSlot: tabbarEnd, buttonSize: 'compact' }, () => railStatus(store.get()));

// Ctrl+Shift+↑ / ↓ step through the history (`stepHistory`) while anything in the terminal area has focus, the tab bar included.
// Caught on the window, before xterm, which would otherwise send them to claude as keys.
// App shortcuts take Ctrl+Shift, since a bare Ctrl+letter belongs to the terminal.
window.addEventListener(
  'keydown',
  (event) => {
    const up = event.key === 'ArrowUp';
    if ((!up && event.key !== 'ArrowDown') || !event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return;
    if (store.get().activeTab === null || !terminalPane.contains(document.activeElement)) return;
    event.preventDefault();
    event.stopPropagation();
    stepHistory(up);
  },
  true,
);

/** What the terminal area's rail icon says while it is folded or behind another panel: waiting while a tab on show waits for you, else needs while one is marked as needing you, by the roll-up's rule, so a tab marked read counts as nothing. */
function railStatus(view: View<'activeProject' | 'tabs' | 'statuses' | 'acked' | 'needsYou' | 'setAside' | 'settings' | 'needsYouTypes'>): NudgeStatus {
  return strongestNudge(
    visibleTabs(view).map((tab) => sessionNudge(tab.session.id, view)),
    strengthNow(view),
  );
}

/** The rail icon follows the tabs and their statuses: a watcher the terminal area registers (watch.ts). */
export function railStatusFollowsTabs(view: View<'activeProject' | 'tabs' | 'statuses' | 'acked' | 'needsYou' | 'setAside' | 'settings' | 'needsYouTypes'>): void {
  tellRail(hostOf('claude'), railStatus(view));
}
