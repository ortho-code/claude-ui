import { element } from '../../../dom';
import { store, type View } from '../../../state/app';
import { sessionNudge, visibleTabs } from '../../../state/views';
import { builtinType, hostOf } from '../builtin';
import type { PanelStatus } from '../../contract';
import './index.css';
import { tabbar } from './tab-bar';
import { paneEl, stepHistory } from './pane';

/**
 * THE TERMINAL AREA as a panel type: the tab bar over the terminals, with the history's bar beside them.
 * One pane for the run: built once, parked until the layout places it, and put back by every mount (`builtinType`), so a layout change that remounts its entry — a new id, an option — keeps a running session and its terminal as they were.
 * Each part builds its own markup as it loads — the tab bar (tab-bar.ts), the pane with the terminals and the history's bar (pane.ts, terminals.ts) — and this module puts them together.
 */
const terminalPane = element('section');
terminalPane.id = 'terminal-pane';
terminalPane.append(tabbar, paneEl);
document.getElementById('parked')!.append(terminalPane);

export const claudeType = builtinType('claude', terminalPane, 'Claude', 'claude', () => railStatus(store.get()));

// Ctrl+Shift+↑ / ↓ step through the history (`stepHistory`) while anything in the terminal area has focus, the tab bar included.
// Caught on the window, before xterm, which would otherwise send them to claude as keys. App shortcuts take Ctrl+Shift, since a bare Ctrl+letter belongs to the terminal.
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

/** What the terminal area's rail icon says while it is folded or behind another panel: waiting while a tab on show waits for you, by the roll-up's rule, so a tab marked read counts as nothing. */
function railStatus(view: View<'activeProject' | 'tabs' | 'statuses' | 'acked'>): PanelStatus {
  return visibleTabs(view).some((tab) => sessionNudge(tab.session.id, view) === 'waiting') ? 'wait' : null;
}

/** The rail icon follows the tabs and their statuses: a watcher the terminal area registers (watch.ts). */
export function railStatusFollowsTabs(view: View<'activeProject' | 'tabs' | 'statuses' | 'acked'>): void {
  hostOf('claude').setStatus(railStatus(view));
}
