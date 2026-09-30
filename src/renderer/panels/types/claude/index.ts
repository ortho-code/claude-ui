import type { View } from '../../../state/app';
import { sessionNudge, visibleTabs } from '../../../state/views';
import { builtinType, reportBuiltinStatus } from '../builtin';
import './index.css';

/**
 * THE TERMINAL AREA as a panel type: the tab bar over the terminals, with the history's bar beside them.
 * One pane for the run: built once, parked until the layout places it, and put back by every mount (`builtinType`), so a layout change that remounts its entry — a new id, an option — keeps a running session and its terminal as they were.
 * Built when this module loads rather than on its first mount, because the code that draws its elements reads them as it loads: the tabs' terminals (terminals.ts), the pane (pane.ts) and the tab bar (tab-bar.ts).
 */
document.getElementById('parked')!.insertAdjacentHTML(
  'beforeend',
  `<section id="terminal-pane">
    <div id="tabbar"></div>
    <!-- The terminals, with the history's bar beside them (history/bar.ts), which pane.ts appends. -->
    <div id="terminal-body">
      <div id="terminals">
        <div id="term-placeholder" class="pane-placeholder">Pick a tab above, or a session in the sidebar, to resume it.</div>
      </div>
    </div>
  </section>`,
);

export const claudeType = builtinType('claude', document.getElementById('terminal-pane')!, 'Claude', 'claude');

/** Where the tabs' terminals go, under the tab bar. */
export const terminalsEl = document.getElementById('terminals')!;

/**
 * What the terminal area's rail icon says while it is folded or behind another panel: waiting while a tab on show waits for you, by the roll-up's rule, so a tab marked read counts as nothing.
 * A watcher of the tabs and their statuses, which renderer.ts registers with the others.
 */
export function railStatusFollowsTabs(view: View<'activeProject' | 'tabs' | 'statuses' | 'acked'>): void {
  reportBuiltinStatus('claude', visibleTabs(view).some((tab) => sessionNudge(tab.session.id, view) === 'waiting') ? 'wait' : null);
}
