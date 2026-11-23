import type { EditorUi } from '../../../../shared/types';
import { changeEditorTabs, closed, closedOthers, editorSetKey, editorTabsOnShow, keyOf, kept, NO_TABS, picked, reordered, stepped, updated, type EditorTabs, type FileRef } from '../../../state/editor-tabs';
import { store } from '../../../state/app';
import { element } from '../../../ui/dom';
import type { MenuItem } from '../../../ui/menu';
import { closeIcon } from '../../../ui/svg';
import { copyText } from '../../../ui/toast';
import { setTooltip } from '../../../ui/tooltip';
import type { PanelTab, PanelTabs } from '../../contract';
import { drawDockButton, tabsHeader } from '../../headers';
import { HeaderTabs } from '../../tabs';
import { FileDoc, type Doc } from './file/doc';
import './view.css';

/** The Editor's width from which Fit draws a diff split. */
const WIDE_PX = 600;
/** The head's close button's label and tooltip. */
const CLOSE_ALL = 'Close all files';

/**
 * THE EDITOR'S VIEW, one for the window: the files open for the tab on show as tabs in its own head, the one on show below them.
 * Built apart from the layout, so it can be shown in the drawer over the terminal area or docked in the Editor panel (controller.ts places it); its head is its own in both, drawn with the tabs a panel's header draws (`HeaderTabs`), so it reads the same wherever it is.
 * What is open lives in the store, one set per session, so a switch of session tabs, a move between drawer and dock, or a layout change draws it again from there; each open file is a `Doc`, kept while its tab stays in the set on show.
 * How a diff is drawn (the view, whitespace, Changes only) is the window's `editorUi`, kept for the next launch.
 */
export class EditorView {
  readonly el = element('div', 'editor-view');
  private readonly body = element('div', 'editor-body');
  private readonly tabs = new HeaderTabs();
  /** Docks the Editor beside the terminal, or puts it back in the drawer, its icon saying which, as the full-screen button's does; there only while the layout has an Editor panel to dock in. */
  private readonly dockButton = element('button', 'icon-btn compact editor-dock');
  /** Closes every file of the tab on show at once, docked or in the drawer, where Esc and a press on claude only close the drawer and keep them. */
  private readonly closeButton = element('button', 'icon-btn compact editor-close');
  /** Its head: the header a panel with tabs has, the same in the drawer and docked. */
  private readonly head = tabsHeader(this.tabs, [this.dockButton, this.closeButton]);
  /** The docked Editor panel's full-screen button, placed in the head before Close all files while it is docked; null otherwise. */
  private fullScreen: HTMLButtonElement | null = null;
  private readonly docs = new Map<string, Doc>();
  private wide = false;
  /** The set last drawn, so a store change that leaves it alone draws nothing. */
  private drawn: { key: string; set: EditorTabs } | null = null;

  constructor() {
    this.dockButton.type = 'button';
    this.dockButton.addEventListener('click', () => this.toggleDock());
    this.closeButton.type = 'button';
    this.closeButton.innerHTML = closeIcon(14);
    this.closeButton.setAttribute('aria-label', CLOSE_ALL);
    setTooltip(this.closeButton, CLOSE_ALL);
    this.closeButton.addEventListener('click', () => changeEditorTabs(() => NO_TABS));
    this.el.append(this.head, this.body);
    // Esc closes the drawer it is in, as it closes the history; docked, there is nothing to close.
    this.el.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey || this.picks().docked) return;
      event.preventDefault();
      store.set({ editorDrawer: false });
    });
    store.watch(['editorTabs', 'tabs', 'activeTab'], () => this.draw());
    store.watch(['editorUi', 'editorDock'], (view, before) => {
      if (view.editorUi.ignoreWs !== before.editorUi.ignoreWs) for (const doc of this.docs.values()) doc.view.reload();
      else for (const doc of this.docs.values()) doc.view.redraw();
      this.drawHead();
    });
    new ResizeObserver(() => this.measure()).observe(this.el);
    this.draw();
  }

  /** Place the docked Editor panel's full-screen button in the head before Close all files, or take it out with null. */
  setFullScreenButton(button: HTMLButtonElement | null): void {
    this.fullScreen?.remove();
    this.fullScreen = button;
    // Before Close all files, which stays the last of the head's own buttons.
    if (button) this.closeButton.before(button);
  }

  private picks(): EditorUi {
    return store.get().editorUi;
  }

  private pick(change: Partial<EditorUi>): void {
    store.set({ editorUi: { ...this.picks(), ...change } });
  }

  /** Dock it, or put it back in the drawer, which it then opens in; docked, the drawer is closed, so it does not open on its own if the panel it docks in goes. */
  private toggleDock(): void {
    const docked = !this.picks().docked;
    store.set({ editorUi: { ...this.picks(), docked }, editorDrawer: !docked });
  }

  /** Give the keys to the file on show, so `j` and `k` step through it at once. */
  focus(): void {
    const set = editorTabsOnShow();
    if (set.active) this.docs.get(set.active)?.view.focus();
  }

  private drawHead(): void {
    const { editorDock, editorUi } = store.get();
    this.dockButton.hidden = !editorDock;
    drawDockButton(this.dockButton, editorUi.docked);
  }

  private measure(): void {
    const wide = this.el.clientWidth >= WIDE_PX;
    if (wide === this.wide) return;
    this.wide = wide;
    if (this.picks().view === 'fit') for (const doc of this.docs.values()) doc.view.redraw();
  }

  /** Draw the set of the tab on show: its tabs in the head, the one on show below, the docs of tabs that left it let go. */
  private draw(): void {
    this.drawHead();
    const key = editorSetKey();
    const set = editorTabsOnShow();
    if (this.drawn?.key === key && this.drawn.set === set) return;
    this.drawn = { key, set };
    for (const [docKey, doc] of this.docs) {
      if (set.tabs.some((tab) => tab.key === docKey)) continue;
      doc.release();
      this.docs.delete(docKey);
    }
    this.tabs.draw(this.tabsOf(set));
    const active = set.tabs.find((tab) => tab.key === set.active);
    if (!active) {
      this.body.replaceChildren();
      return;
    }
    const doc = this.docOf(active.key, active.ref);
    if (this.body.firstChild !== doc.view.el) this.body.replaceChildren(doc.view.el);
  }

  private docOf(key: string, ref: FileRef): Doc {
    const found = this.docs.get(key);
    if (found) {
      void found.showRef(ref);
      return found;
    }
    const doc = new FileDoc(ref, {
      picks: () => this.picks(),
      wide: () => this.wide,
      pick: (change) => this.pick(change),
      step: (next) => {
        const now = this.keyOfDoc(doc);
        if (now === undefined) return;
        this.docs.delete(now);
        // A file with a tab of its own already is put on show in that tab, and this one goes (`stepped`); else this doc moves to the new file's key, so the draw that follows finds it there, showing that file already.
        if (this.docs.has(keyOf(next))) doc.release();
        else this.docs.set(keyOf(next), doc);
        changeEditorTabs((set) => stepped(set, now, next));
      },
      refreshed: (next) => {
        const now = this.keyOfDoc(doc);
        if (now !== undefined) changeEditorTabs((set) => updated(set, now, next));
      },
    });
    this.docs.set(key, doc);
    return doc;
  }

  private keyOfDoc(doc: Doc): string | undefined {
    return [...this.docs].find(([, each]) => each === doc)?.[0];
  }

  private tabsOf(set: EditorTabs): PanelTabs {
    return {
      tabs: set.tabs.map(
        (tab): PanelTab => ({
          id: tab.key,
          text: tab.ref.file.path.slice(tab.ref.file.path.lastIndexOf('/') + 1),
          tooltip: `${tab.ref.root}/${tab.ref.file.path}${tab.preview ? '\nA preview: the next file opened takes its place. Pin it, or double-click it, to keep it.' : ''}`,
          shown: tab.key === set.active,
          cold: false,
          preview: tab.preview,
          button: { mark: 'close', tooltip: 'Close' },
          cluster: null,
        }),
      ),
      add: null,
      kebabLabel: 'File options',
      select: (id) => changeEditorTabs((each) => picked(each, id)),
      press: (id) => changeEditorTabs((each) => closed(each, id)),
      menu: (id) => this.menu(set, id),
      // A double-click on a tab keeps it, as on a preview in an editor.
      rename: (id) => changeEditorTabs((each) => kept(each, id)),
      reorder: (ids) => changeEditorTabs((each) => reordered(each, ids)),
      showCluster: () => {},
      folded: false,
      fold: () => {},
    };
  }

  /** A tab's menu: Pin while it is a preview, Copy path, Close other tabs while there are others, Close, and Close all while there are others. */
  private menu(set: EditorTabs, id: string): MenuItem[] | null {
    const tab = set.tabs.find((each) => each.key === id);
    if (!tab) return null;
    const path = `${tab.ref.root}/${tab.ref.file.path}`;
    return [
      ...(tab.preview ? [{ label: 'Pin', onSelect: () => changeEditorTabs((each) => kept(each, id)) }] : []),
      { label: 'Copy path', onSelect: () => void copyText(path, 'Path copied.') },
      ...(set.tabs.length > 1 ? [{ label: 'Close other tabs', onSelect: () => changeEditorTabs((each) => closedOthers(each, id)) }] : []),
      { label: 'Close', onSelect: () => changeEditorTabs((each) => closed(each, id)) },
      ...(set.tabs.length > 1 ? [{ label: 'Close all', onSelect: () => changeEditorTabs(() => NO_TABS) }] : []),
    ];
  }
}
