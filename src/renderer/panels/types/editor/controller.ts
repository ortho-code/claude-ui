import { store } from '../../../state/app';
import { editorDocked, editorTabsOnShow } from '../../../state/editor-tabs';
import type { Asks } from '../../contract';
import { EditorView } from './view';

/**
 * Where the Editor's one view is: docked in the Editor panel while it is docked and the layout has one to dock in, in the drawer over the terminal area while it is open there, else nowhere.
 * Started with the window (renderer.ts), so the drawer works whatever the layout places; the Editor panel only lends its body to dock in (`dockIn`).
 */

let view: EditorView | null = null;
/** The Editor panel's body, while one is mounted to dock in. */
let dock: { body: HTMLElement; fullScreen: HTMLButtonElement } | null = null;
let drawer: Pick<Asks, 'showInDrawer' | 'hideFromDrawer'> | null = null;

/** Build the view and keep it where the store says, asking the terminal area for its drawer. */
export function startEditor(asks: Pick<Asks, 'showInDrawer' | 'hideFromDrawer'>): void {
  drawer = asks;
  view = new EditorView();
  store.watch(['editorDrawer', 'editorUi', 'editorDock', 'editorTabs', 'tabs', 'activeTab'], place);
  // Any change of the tab on show, a switch, a close, a new one, closes the drawer, so it never opens on its own on a tab whose files were left closed.
  store.watch(['activeTab'], () => store.set({ editorDrawer: false }));
  place();
}

/** The Editor panel lends its body to dock in, with its full-screen button for the view's head; null when it unmounts. */
export function dockIn(lent: { body: HTMLElement; fullScreen: HTMLButtonElement } | null): void {
  dock = lent;
  place();
}

function place(): void {
  if (!view || !drawer) return;
  const open = editorTabsOnShow().tabs.length > 0;
  if (editorDocked() && dock) {
    drawer.hideFromDrawer(view.el);
    if (view.el.parentElement !== dock.body) dock.body.replaceChildren(view.el);
    view.setFullScreenButton(dock.fullScreen);
    return;
  }
  view.setFullScreenButton(null);
  if (store.get().editorDrawer && open) {
    const opening = !view.el.isConnected;
    drawer.showInDrawer(view.el, () => store.set({ editorDrawer: false }));
    // Opening the drawer takes the keys, as opening the history does.
    if (opening) view.focus();
  } else drawer.hideFromDrawer(view.el);
}
