import { element, fromMarkup } from '../../../dom';
import { openSettings } from '../../../settings';
import { store, type View } from '../../../state/app';
import { switcherModel } from '../../../state/views';
import { strokeIcon } from '../../../svg';
import { builtinType, hostOf } from '../builtin';
import type { PanelStatus } from '../../contract';
import './index.css';
import { switcherEl } from './switcher';
import { filterPanel, filterStatus, filterToggle } from './filter';
import { collapseToggle } from './folding';
import { container } from './drawn';
import { loadingEl } from './read';
import { sidebarFooter } from './attention-strip';

/**
 * THE SIDEBAR as a panel type: the project switcher and the header's actions over the filter panel, the session list and the attention strip.
 * One element for the run: built once, parked until the layout places it, and put back by every mount (`builtinType`), so a layout change that remounts its entry keeps its scroll, its folds and what is typed in its search.
 * Each part builds its own markup as it loads — the switcher (switcher.ts), the filter (filter.ts), the list (list.ts), the attention strip (attention-strip.ts) — and this module puts them together, with the header's Settings and + New, which are the type's own.
 */

// The header's two actions that are the type's own; the filter's toggle and collapse-all go with the filter and the list.
const settingsToggle = fromMarkup(`<button id="settings-toggle" class="icon-btn large" data-tooltip="Settings" aria-label="Settings" aria-haspopup="dialog"></button>`, HTMLButtonElement);
const newButton = fromMarkup(`<button id="new-session" data-tooltip="New session in a folder…">+ New</button>`, HTMLButtonElement);

const actions = element('div', 'header-actions');
actions.append(settingsToggle, collapseToggle, filterToggle, newButton);
const header = element('header');
header.append(switcherEl, actions);
const sidebar = element('aside');
sidebar.id = 'sidebar';
sidebar.append(header, filterPanel, filterStatus, loadingEl, container, sidebarFooter);
document.getElementById('parked')!.append(sidebar);

export const sessionsType = builtinType('sessions', sidebar, 'Sessions', 'sessions', () => railStatus(store.get()));

/** What the sidebar's rail icon says while it is folded or behind another panel: waiting while any session anywhere waits for you, by the switcher's badge (`switcherModel`). */
function railStatus(view: View<'sessions' | 'statuses' | 'acked' | 'archived' | 'pendingDeletes' | 'projectNames' | 'projectOrder' | 'tabs'>): PanelStatus {
  return switcherModel(view).all.badge === 'waiting' ? 'wait' : null;
}

/** The rail icon follows the sessions and their statuses: a watcher the sidebar registers (watch.ts). */
export function railStatusFollowsSessions(view: View<'sessions' | 'statuses' | 'acked' | 'archived' | 'pendingDeletes' | 'projectNames' | 'projectOrder' | 'tabs'>): void {
  hostOf('sessions').setStatus(railStatus(view));
}

// Settings as two sliders, each with its knob.
const settingsIcon = (size: number): string =>
  strokeIcon(size, '<path d="M2 4.6h8.1M13.1 4.6h.9M2 11.4h2.9M7.9 11.4h6.1" /><circle cx="11.7" cy="4.6" r="1.6" /><circle cx="6.4" cy="11.4" r="1.6" />');

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
