import { store } from '../../../state/app';
import { allTabs, editorDocked, editorTabsOnShow } from '../../../state/editor-tabs';
import type { Asks, DrawerEntry } from '../../contract';
import { hostOf } from '../builtin';
import { EditorView } from './view';

/**
 * Where the Editor's one view is: docked in the Editor panel while it is docked and the layout has one to dock in, else held in the drawer over the terminal area while the tab on show has files open, and shown there while it is open.
 * Started with the window (renderer.ts), so the drawer works whatever the layout places; the Editor panel only lends its body to dock in (`dockIn`).
 */

type DrawerAsks = Pick<Asks, 'holdInDrawer' | 'showInDrawer' | 'hideFromDrawer' | 'releaseFromDrawer'>;

let view: EditorView | null = null;
/** What the Editor panel lends while one is mounted to dock in: its body, its full-screen button, and its way to bring itself into view. */
interface Dock {
  body: HTMLElement;
  fullScreen: HTMLButtonElement;
  bringIntoView(): void;
}

let dock: Dock | null = null;
let drawer: DrawerAsks | null = null;
/** Whether the drawer shows the view, as `place` last put it. */
let inDrawer = false;

/** The view on the drawer's rail: Files, with how many tabs the tab on show has open. */
const entry: DrawerEntry = {
  icon: 'file',
  label: 'Files',
  count: () => allTabs(editorTabsOnShow()).length,
  open: () => store.set({ editorDrawer: true }),
  close: () => store.set({ editorDrawer: false }),
};

/** Build the view and keep it where the store says, asking the terminal area for its drawer. */
export function startEditor(asks: DrawerAsks): void {
  drawer = asks;
  // Docked, the Editor panel is brought into view; in the drawer, opening a file opens the drawer itself (`editorDrawer`), and the terminal area it stands in is brought into view.
  view = new EditorView(() => {
    if (editorDocked()) dock?.bringIntoView();
    else hostOf('claude').bringIntoView();
  });
  store.watch(['editorDrawer', 'editorUi', 'editorDock', 'editorTabs', 'tabs', 'activeTab'], place);
  // Any change of the tab on show, a switch, a close, a new one, closes the drawer, so it never opens on its own on a tab whose files were left closed.
  store.watch(['activeTab'], () => store.set({ editorDrawer: false }));
  place();
}

/** The Editor panel lends its body to dock in, with its full-screen button for the view's head; null when it unmounts. */
export function dockIn(lent: Dock | null): void {
  dock = lent;
  place();
}

/** The Editor panel is on screen, as the layout says after each of its draws. */
export function dockShown(): void {
  view?.shown();
}

function place(): void {
  if (!view || !drawer) return;
  const open = editorTabsOnShow().groups.length > 0;
  const docked = editorDocked() ? dock : null;
  // Off the drawer's rail while docked, or with nothing to show.
  if (docked !== null || !open) {
    inDrawer = false;
    drawer.releaseFromDrawer(view.el);
  } else drawer.holdInDrawer(view.el, entry);
  if (docked) {
    if (view.el.parentElement !== docked.body) docked.body.replaceChildren(view.el);
    view.setFullScreenButton(docked.fullScreen);
    return;
  }
  view.setFullScreenButton(null);
  if (!open) return;
  if (store.get().editorDrawer) {
    drawer.showInDrawer(view.el);
    // Opening the drawer takes the keys, as opening the history does.
    if (!inDrawer) {
      view.focus();
      view.shown();
    }
    inDrawer = true;
  } else {
    drawer.hideFromDrawer(view.el);
    inDrawer = false;
  }
}
