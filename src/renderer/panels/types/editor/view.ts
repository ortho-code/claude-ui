import type { EditorUi } from '../../../../shared/types';
import { allTabs, changeEditorGroup, changeEditorTabs, editorSetKey, editorTabsOnShow, keyOf, NO_GROUP, NO_TABS, shownTab, steppedIn, updated, type EditorTabs, type FileRef } from '../../../state/editor-tabs';
import { store } from '../../../state/app';
import { element } from '../../../ui/dom';
import { closeIcon } from '../../../ui/svg';
import { setTooltip } from '../../../ui/tooltip';
import { drawDockButton } from '../../headers';
import { FileDoc, type Doc, type DocHost } from './file/doc';
import { SessionDoc } from './file/session-doc';
import { EditorGroupView } from './group';
import './view.css';

/** The Editor's width from which Fit draws a diff split. */
const WIDE_PX = 600;
/** The head's close button's label and tooltip. */
const CLOSE_ALL = 'Close all files';

/**
 * THE EDITOR'S VIEW, one for the window: the files open for the tab on show, drawn by group (group.ts), each with its tabs in a head of its own and the one on show below them; the Editor's own buttons sit at the end of a group's head.
 * Built apart from the layout, so it can be shown in the drawer over the terminal area or docked in the Editor panel (controller.ts places it); it reads the same wherever it is.
 * What is open lives in the store, one set per session, so a switch of session tabs, a move between drawer and dock, or a layout change draws it again from there; each open file is a `Doc`, kept while its tab stays in the set on show.
 * How a diff is drawn (the view, whitespace, Changes only) is the window's `editorUi`, kept for the next launch.
 */
export class EditorView {
  readonly el = element('div', 'editor-view');
  private readonly group = new EditorGroupView();
  /** Docks the Editor beside the terminal, or puts it back in the drawer, its icon saying which, as the full-screen button's does; there only while the layout has an Editor panel to dock in. */
  private readonly dockButton = element('button', 'icon-btn compact editor-dock');
  /** Closes every file of the tab on show at once, docked or in the drawer, where Esc and a press on claude only close the drawer and keep them. */
  private readonly closeButton = element('button', 'icon-btn compact editor-close');
  /** The docked Editor panel's full-screen button, placed before Close all files while it is docked; null otherwise. */
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
    this.group.holdControls([this.dockButton, this.closeButton]);
    this.el.append(this.group.el);
    // Esc closes the drawer it is in, as it closes the history; docked, there is nothing to close.
    this.el.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey || this.picks().docked) return;
      event.preventDefault();
      store.set({ editorDrawer: false });
    });
    store.watch(['editorTabs', 'tabs', 'activeTab', 'editorReveal'], () => {
      this.draw();
      this.reveal();
    });
    store.watch(['editorUi', 'editorDock'], (view, before) => {
      if (view.editorUi.ignoreWs !== before.editorUi.ignoreWs) for (const doc of this.docs.values()) doc.view.reload();
      else for (const doc of this.docs.values()) doc.view.redraw();
      this.drawHead();
    });
    new ResizeObserver(() => this.measure()).observe(this.el);
    this.draw();
  }

  /** Place the docked Editor panel's full-screen button before Close all files, or take it out with null. */
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
    const shown = shownTab(editorTabsOnShow());
    if (shown) this.docs.get(shown.key)?.view.focus();
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

  /** Draw the set of the tab on show: its group's tabs, the one on show below them, the docs of tabs that left it let go. */
  private draw(): void {
    this.drawHead();
    const key = editorSetKey();
    const set = editorTabsOnShow();
    if (this.drawn?.key === key && this.drawn.set === set) return;
    this.drawn = { key, set };
    for (const [docKey, doc] of this.docs) {
      if (allTabs(set).some((tab) => tab.key === docKey)) continue;
      doc.release();
      this.docs.delete(docKey);
    }
    const group = set.groups[0] ?? NO_GROUP;
    const active = group.tabs.find((tab) => tab.key === group.active);
    this.group.draw(group, active ? this.docOf(active.key, active.ref).view.el : null);
  }

  /** Hand a line asked to be brought into sight to the tab on show, when it is the tab it was asked for, and clear the ask, so it is taken once. */
  private reveal(): void {
    const asked = store.get().editorReveal;
    if (!asked) return;
    if (shownTab(editorTabsOnShow())?.key === asked.key) this.docs.get(asked.key)?.view.revealLine(asked.line);
    store.set({ editorReveal: null });
  }

  /** The doc of the tab `key`, made for `ref`'s kind: the one it has, showing `ref`, unless the same file is opened again as the other kind, as after git started or stopped ignoring it, or after its checkout could not be read. */
  private docOf(key: string, ref: FileRef): Doc {
    const found = this.docs.get(key);
    if (found?.kind === ref.kind) {
      void found.showRef(ref);
      return found;
    }
    found?.release();
    const host = this.docHost((): Doc => doc);
    const doc: Doc = ref.kind === 'checkout' ? new FileDoc(ref, host) : new SessionDoc(ref, host);
    this.docs.set(key, doc);
    return doc;
  }

  /** What a tab asks of the Editor; `doc` is the tab asking, once it is made. */
  private docHost(doc: () => Doc): DocHost {
    return {
      picks: () => this.picks(),
      wide: () => this.wide,
      pick: (change) => this.pick(change),
      step: (next) => {
        const now = this.keyOfDoc(doc());
        if (now === undefined) return;
        this.docs.delete(now);
        // A file with a tab of its own already is put on show in that tab, and this one goes (`stepped`); else this doc moves to the new file's key, so the draw that follows finds it there, showing that file already.
        if (this.docs.has(keyOf(next))) doc().release();
        else this.docs.set(keyOf(next), doc());
        changeEditorTabs((set) => steppedIn(set, now, next));
      },
      refreshed: (next) => {
        const now = this.keyOfDoc(doc());
        if (now !== undefined) changeEditorGroup(now, (group) => updated(group, now, next));
      },
    };
  }

  private keyOfDoc(doc: Doc): string | undefined {
    return [...this.docs].find(([, each]) => each === doc)?.[0];
  }
}
