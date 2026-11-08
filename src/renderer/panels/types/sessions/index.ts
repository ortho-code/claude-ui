import { element, fromMarkup } from '../../../dom';
import { openSettings } from '../../../settings';
import { store, type View } from '../../../state/app';
import { switcherModel } from '../../../state/views';
import { strokeIcon } from '../../../svg';
import type { NudgeStatus } from '../../../logic';
import { builtinType, hostOf, tellRail } from '../builtin';
import './index.css';
import { switcherEl } from './switcher';
import { filterPanel, filterStatus, filterToggle } from './filter';
import { collapseToggle } from './folding';
import { container } from './drawn';
import { loadingEl } from './read';
import { bulkBar, bulkLine } from './bulk';
import { arrangementMounted, listRow, listRowEnd } from './arrangement';

/**
 * THE SIDEBAR as a panel type: the project switcher and the header's actions over the filter panel and the session list.
 * One element for the run: built once, parked until the layout places it, and put back by every mount (`builtinType`), so a layout change that remounts its entry keeps its scroll, its folds and what is typed in its search.
 * Each part builds its own markup as it loads — the switcher (switcher.ts), the filter (filter.ts), the list (drawn.ts, with its collapse-all from folding.ts and its loading bar from read.ts) — and this module puts them together, with the header's Settings and + New, which are the type's own.
 */

// The header's two actions that are the type's own.
const settingsToggle = fromMarkup(`<button id="settings-toggle" class="icon-btn large" data-tooltip="Settings" aria-label="Settings" aria-haspopup="dialog"></button>`, HTMLButtonElement);
const newButton = fromMarkup(`<button id="new-session" data-tooltip="New session in a folder…">+ New</button>`, HTMLButtonElement);

const actions = element('div', 'header-actions');
actions.append(settingsToggle, newButton);
const header = element('header');
header.append(switcherEl, actions);
// The filter and collapse-all are the list's, so they sit on the list's row after Review, the filter over the panel it opens; the header keeps its room for the switcher, and the full-screen button its corner, as on every panel.
listRowEnd.append(filterToggle, collapseToggle);
const sidebar = element('aside');
sidebar.id = 'sidebar';
sidebar.append(header, listRow, bulkLine, filterPanel, filterStatus, loadingEl, container, bulkBar);
document.getElementById('parked')!.append(sidebar);

export const sessionsType = builtinType('sessions', sidebar, 'Sessions', 'sessions', { fullScreenSlot: actions, buttonSize: 'large' }, () => railStatus(store.get()), arrangementMounted);

/**
 * What the sidebar's rail icon says while it is folded or behind another panel: waiting while any session anywhere waits for you, else needs while one is marked as needing you, by every project's roll-up (`switcherModel`).
 * Every project, the one on show included, where the switcher's title leaves that one out: folded, the sidebar shows no project, so its icon answers whether anything anywhere wants you (decided 2026-11-08).
 */
function railStatus(view: View<'sessions' | 'statuses' | 'acked' | 'needsYou' | 'setAside' | 'finished' | 'pendingDeletes' | 'projectNames' | 'projectOrder' | 'tabs' | 'settings' | 'needsYouTypes'>): NudgeStatus {
  return switcherModel(view).all.badge;
}

/** The rail icon follows the sessions and their statuses: a watcher the sidebar registers (watch.ts). */
export function railStatusFollowsSessions(view: View<'sessions' | 'statuses' | 'acked' | 'needsYou' | 'setAside' | 'finished' | 'pendingDeletes' | 'projectNames' | 'projectOrder' | 'tabs' | 'settings' | 'needsYouTypes'>): void {
  tellRail(hostOf('sessions'), railStatus(view));
}

// Settings as two sliders, each with its knob.
const settingsIcon = (size: number): string =>
  strokeIcon(size, '<path d="M2 4.6h8.1M13.1 4.6h.9M2 11.4h2.9M7.9 11.4h6.1" /><circle cx="11.7" cy="4.6" r="1.6" /><circle cx="6.4" cy="11.4" r="1.6" />');

// A header button shows what it opened as open, from the press until that closes: the folder picker, which is no element of the window, or the Settings dialog, which no markup ties to the button.
// `.active` is the look index.css gives an open header button, as the filter's panel gives its own.
async function heldOpen(button: HTMLElement, open: () => Promise<void>): Promise<void> {
  button.classList.add('active');
  try {
    await open();
  } finally {
    button.classList.remove('active');
  }
}

async function pickFolderAndOpen(): Promise<void> {
  const dir = await window.claudeUi.pickFolder();
  if (dir) void hostOf('sessions').openNewSession(dir);
}
newButton.addEventListener('click', () => void heldOpen(newButton, pickFolderAndOpen));
// The Settings icon comes from here too, rather than inline in the sidebar's markup, so it is drawn through the same helper as the rest.
settingsToggle.innerHTML = settingsIcon(14);
settingsToggle.addEventListener('click', () => void heldOpen(settingsToggle, openSettings));
