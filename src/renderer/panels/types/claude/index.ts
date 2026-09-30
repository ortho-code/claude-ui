import { builtinType } from '../builtin';
import './index.css';

/**
 * THE TERMINAL AREA as a panel type: the tab bar over the terminals, with the history's bar beside them.
 * One pane for the run: built once, parked until the layout places it, and put back by every mount (`builtinType`), so a layout change that remounts its entry — a new id, an option — keeps a running session and its terminal as they were.
 * Built when this module loads rather than on its first mount, because renderer.ts still reads its elements as it loads; the code that draws them follows them here.
 */
document.getElementById('parked')!.insertAdjacentHTML(
  'beforeend',
  `<section id="terminal-pane">
    <div id="tabbar"></div>
    <!-- The terminals, with the history's bar beside them (history/bar.ts), which renderer.ts appends. -->
    <div id="terminal-body">
      <div id="terminals">
        <div id="term-placeholder" class="pane-placeholder">Pick a tab above, or a session in the sidebar, to resume it.</div>
      </div>
    </div>
  </section>`,
);

export const claudeType = builtinType('claude', document.getElementById('terminal-pane')!, 'Claude', 'claude');
