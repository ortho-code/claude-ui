import type { UiState } from '../shared/types';
import { restoreTreeState, treeState } from './panels/tree';
import { followListScroll, restoreSidebar, sidebarSnapshot } from './panels/types/sessions/stored-view';
import { store, type StoredView } from './state/app';

/**
 * THE VIEW THAT SURVIVES A RESTART: the sidebar's part (sessions/stored-view.ts) and the layout tree's, saved together in the one shape `meta.json` keeps, and put back together at start-up.
 * Search, filters, folds, width and scroll are one answer to one question — put the window back the way it was — so they are snapshotted, stored and restored together rather than as a setting each.
 * renderer.ts wires it: a watcher of the view's slices, the tree's own changes, and the start-up order; the list's scroll it follows itself, from the moment it starts saving.
 */

// Nothing is written until the start-up read has put the stored view back in the store (`startSavingUi`), or a save in between would write an empty sidebar straight over the real one.
let uiRestored = false;
let uiSaveTimer: number | undefined;
// The last snapshot actually sent.
// Renders happen for reasons that have nothing to do with the view — a transcript growing, a status dot changing — and without this each one would cost a full read-modify-write of meta.json.
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
export function persistUi(): void {
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
 * Put the sidebar back the way it was left, and hand back what the start-up read sets in the store with the listing (`fullRead`), and the scroll offset to apply once there is a list to scroll.
 *
 * Runs before the first render on purpose, and the view goes into the store in the same change as the listing: restoring filters afterwards would draw the full list and then visibly cut it down.
 * What is drawn straight from what was stored — the search box, the calendar, the chosen preset, the panel — is put back by the sidebar (`restoreSidebar`), before the layout places it; the tree puts back its own part.
 */
export async function restoreUiState(): Promise<{ scrollTop: number; view: StoredView }> {
  const state = await window.claudeUi.getUiState();
  // The sidebar's width lived in localStorage, then in `sidebarWidth`; either is adopted once into the layout tree's sizes, so an existing install keeps its sidebar, and the tree owns it from here.
  restoreTreeState(state.panelState, state.sidebarWidth ?? Number(localStorage.getItem('sidebarWidth')));
  const restored = await restoreSidebar(state);
  // Seed the signature from what was just restored, so an opening render that changed nothing writes nothing.
  lastUiSignature = JSON.stringify(uiSnapshot(restored.view));
  return restored;
}

/** From the start-up read on, the view in the store is the one you left, so it can be saved; anything asked for meanwhile — the layout dropping a stale split's sizes, say — is written now, if it changed anything. */
export function startSavingUi(): void {
  uiRestored = true;
  // Where the list was scrolled to is remembered, so a scroll of your own is a change to remember too.
  followListScroll(persistUi);
  persistUi();
}
