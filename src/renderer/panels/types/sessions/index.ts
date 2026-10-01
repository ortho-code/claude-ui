import { openSettings } from '../../../settings';
import { store, type View } from '../../../state/app';
import { switcherModel } from '../../../state/views';
import { strokeIcon } from '../../../svg';
import { builtinType, hostOf } from '../builtin';
import type { PanelStatus } from '../../contract';
import './index.css';

/**
 * THE SIDEBAR as a panel type: the project switcher and the header's actions over the filter panel, the session list and the attention strip.
 * One element for the run: built once, parked until the layout places it, and put back by every mount (`builtinType`), so a layout change that remounts its entry keeps its scroll, its folds and what is typed in its search.
 * Built when this module loads rather than on its first mount, because the code that draws its elements reads them as it loads: the switcher (switcher.ts), the filter (filter.ts), the list (list.ts), the attention strip (attention-strip.ts), and this module for the header's + New and Settings.
 */
document.getElementById('parked')!.insertAdjacentHTML(
  'beforeend',
  `<aside id="sidebar">
    <header>
      <div id="project-switcher">
        <button id="switcher-current" type="button" aria-haspopup="true" aria-expanded="false" data-tooltip="Switch project">
          <span id="switcher-name">All</span>
          <span id="switcher-gone" class="gone-mark" hidden></span>
          <span class="switcher-right">
            <span id="switcher-badge" class="nudge" hidden></span>
            <span class="switcher-chev" aria-hidden="true"></span>
          </span>
        </button>
        <div id="switcher-popover" role="menu" hidden></div>
      </div>
      <div class="header-actions">
        <button id="settings-toggle" class="icon-btn large" data-tooltip="Settings" aria-label="Settings" aria-haspopup="dialog"></button>
        <button id="collapse-toggle" class="icon-btn large" data-tooltip="Collapse all" aria-label="Collapse all"></button>
        <button id="filter-toggle" class="icon-btn large" data-tooltip="Filter sessions" aria-label="Filter sessions" aria-expanded="false"></button>
        <button id="new-session" data-tooltip="New session in a folder…">+ New</button>
      </div>
    </header>
    <div id="filter-panel" hidden>
      <input id="search" type="search" placeholder="Search sessions…" aria-label="Search sessions" />
      <div id="filters">
        <button id="pinned-filter" data-tooltip="Show only pinned sessions" aria-label="Show only pinned sessions" aria-pressed="false"></button>
        <button id="open-filter" type="button" data-tooltip="Show only sessions with a tab open" aria-label="Show only sessions with a tab open" aria-pressed="false"></button>
        <button id="live-filter" type="button" data-tooltip="Show only live sessions" aria-label="Show only live sessions" aria-pressed="false"></button>
        <button id="worktree-filter" type="button" data-tooltip="Show only worktree sessions" aria-label="Show only worktree sessions" aria-pressed="false"></button>
        <button id="sibling-filter" type="button" data-tooltip="Show only sessions with siblings" aria-label="Show only sessions with siblings" aria-pressed="false"></button>
        <button id="note-filter" type="button" data-tooltip="Show only sessions with a note" aria-label="Show only sessions with a note" aria-pressed="false"></button>
        <button id="archived-filter" type="button" data-tooltip="Show archived sessions" aria-label="Show archived sessions" aria-pressed="false"></button>
        <button id="gone-filter" type="button" data-tooltip="Show only sessions whose folder is gone" aria-label="Show only sessions whose folder is gone" aria-pressed="false"></button>
        <div id="date-presets">
          <button type="button" data-range="any" class="active">Any</button>
          <button type="button" data-range="today">Today</button>
          <button type="button" data-range="7d">7d</button>
          <button type="button" data-range="30d">30d</button>
          <button type="button" data-range="custom">Custom</button>
        </div>
      </div>
      <button type="button" id="date-range-label" hidden>Pick a start and end date</button>
      <div id="date-custom" hidden>
        <div id="date-range"></div>
        <div id="date-range-caption"></div>
      </div>
    </div>
    <div id="filter-status" hidden>
      <div id="filter-chips" hidden></div>
      <span id="filter-count"></span>
      <button id="filter-clear" type="button">Clear</button>
    </div>
    <div id="loading"></div>
    <div id="sessions" aria-live="polite"></div>
    <div id="sidebar-footer" hidden>
      <div id="footer-list" hidden></div>
      <button id="footer-toggle" type="button" aria-expanded="false">
        <span id="footer-badge" class="nudge" hidden></span>
        <span id="footer-label"></span>
        <span class="footer-chev" aria-hidden="true"></span>
      </button>
    </div>
  </aside>`,
);

export const sessionsType = builtinType('sessions', document.getElementById('sidebar')!, 'Sessions', 'sessions', () => railStatus(store.get()));

/** What the sidebar's rail icon says while it is folded or behind another panel: waiting while any session anywhere waits for you, by the switcher's badge (`switcherModel`). */
function railStatus(view: View<'sessions' | 'statuses' | 'acked' | 'archived' | 'pendingDeletes' | 'projectNames' | 'projectOrder' | 'tabs'>): PanelStatus {
  return switcherModel(view).all.badge === 'waiting' ? 'wait' : null;
}

/** The rail icon follows the sessions and their statuses: a watcher renderer.ts registers with the others. */
export function railStatusFollowsSessions(view: View<'sessions' | 'statuses' | 'acked' | 'archived' | 'pendingDeletes' | 'projectNames' | 'projectOrder' | 'tabs'>): void {
  hostOf('sessions').setStatus(railStatus(view));
}

// The header's two actions that are the type's own; the filter's toggle and collapse-all go with the filter and the list.
const newButton = document.getElementById('new-session') as HTMLButtonElement;

// Settings as two sliders, each with its knob.
const settingsIcon = (size: number): string =>
  strokeIcon(size, '<path d="M2 4.6h8.1M13.1 4.6h.9M2 11.4h2.9M7.9 11.4h6.1" /><circle cx="11.7" cy="4.6" r="1.6" /><circle cx="6.4" cy="11.4" r="1.6" />');
const settingsToggle = document.getElementById('settings-toggle') as HTMLButtonElement;

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
// The Settings icon comes from here too, rather than inline in the sidebar's markup, so it is drawn through the same helper as the rest.
settingsToggle.innerHTML = settingsIcon(14);
settingsToggle.addEventListener('click', () => void openSettings());
