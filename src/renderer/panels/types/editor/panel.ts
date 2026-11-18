import { DEFAULT_DIFF_PICKS, type DiffPicks } from '../../../../shared/diff/types';
import { closed, changeEditorTabs, editorSetKey, editorTabsOnShow, keyOf, kept, picked, reordered, stepped, updated, type EditorTabs, type FileRef } from '../../../state/editor-tabs';
import { store } from '../../../state/app';
import { element } from '../../../ui/dom';
import type { MountedPanel, PanelHost, PanelTab } from '../../contract';
import type { PanelSlot } from '../../layout';
import { FileDoc } from './file/doc';
import './panel.css';

/** The Editor's width from which Fit draws a diff split, as the diff panel's did. */
const WIDE_PX = 600;

/**
 * The Editor on screen: the files open for the tab on show as tabs in its header, the one on show below them, and nothing at all while none is open, so its group takes no room (`setVacant`).
 * What is open lives in the store, one set per session tab, so a remount, a layout change or a switch of session tabs draws it again from there; each open file's tab is a `FileDoc`, kept while its tab stays in the set on show.
 * How a diff is drawn (the view, whitespace, changes only) is the Editor's own pick, kept in its panel data.
 */
export class EditorPanel implements MountedPanel {
  readonly el = element('div', 'panel-body editor-panel');
  private readonly docs = new Map<string, FileDoc>();
  private readonly stopWatching: () => void;
  private picks: DiffPicks = DEFAULT_DIFF_PICKS;
  private wide = false;
  /** A pick was made since the mount. */
  private pickedHere = false;
  private disposed = false;
  /** The set last drawn, so a store change that leaves it alone draws nothing. */
  private drawn: { key: string; set: EditorTabs } | null = null;

  constructor(
    private readonly slot: PanelSlot,
    private readonly host: PanelHost,
  ) {
    store.set({ editorOn: true });
    this.stopWatching = store.watch(['editorTabs', 'tabs', 'activeTab'], () => this.draw());
    new ResizeObserver(() => this.measure()).observe(this.el);
    void this.loadPicks();
    this.draw();
  }

  refresh(): void {}
  contextChanged(): void {}
  setVisible(): void {}
  recheck(): void {}

  unmount(): void {
    this.disposed = true;
    this.stopWatching();
    for (const doc of this.docs.values()) doc.release();
    this.docs.clear();
    store.set({ editorOn: false });
  }

  /** The picks kept for the Editor, once its data has been read, unless one was made meanwhile, which is newer and already kept. */
  private async loadPicks(): Promise<void> {
    const kept = (await window.claudeUi.getPanelData(this.slot.key)).diff;
    if (!kept || this.disposed || this.pickedHere) return;
    this.picks = kept;
    this.redrawDocs();
  }

  private pick(change: Partial<DiffPicks>): void {
    this.pickedHere = true;
    const reload = change.ignoreWs !== undefined && change.ignoreWs !== this.picks.ignoreWs;
    this.picks = { ...this.picks, ...change };
    void window.claudeUi.setDiffPicks(this.slot.key, this.picks);
    for (const doc of this.docs.values()) {
      if (reload) doc.view.reload();
      else doc.view.redraw();
    }
  }

  private redrawDocs(): void {
    for (const doc of this.docs.values()) doc.view.redraw();
  }

  private measure(): void {
    const wide = this.el.clientWidth >= WIDE_PX;
    if (wide === this.wide) return;
    this.wide = wide;
    if (this.picks.view === 'fit') this.redrawDocs();
  }

  /** Draw the set of the tab on show: its tabs in the header, the one on show below, the docs of tabs that left it let go. */
  private draw(): void {
    const key = editorSetKey();
    const set = editorTabsOnShow();
    if (this.drawn?.key === key && this.drawn.set === set) return;
    this.drawn = { key, set };
    for (const [docKey, doc] of this.docs) {
      if (set.tabs.some((tab) => tab.key === docKey)) continue;
      doc.release();
      this.docs.delete(docKey);
    }
    this.host.setVacant(set.tabs.length === 0);
    this.host.setTabs(set.tabs.length === 0 ? null : this.tabsOf(set));
    const active = set.tabs.find((tab) => tab.key === set.active);
    if (!active) {
      this.el.replaceChildren();
      return;
    }
    const doc = this.docOf(active.key, active.ref);
    if (this.el.firstChild !== doc.view.el) this.el.replaceChildren(doc.view.el);
  }

  private docOf(key: string, ref: FileRef): FileDoc {
    const found = this.docs.get(key);
    if (found) {
      void found.showRef(ref);
      return found;
    }
    const doc = new FileDoc(ref, {
      picks: () => this.picks,
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
      refreshed: (ref) => {
        const now = this.keyOfDoc(doc);
        if (now !== undefined) changeEditorTabs((set) => updated(set, now, ref));
      },
    });
    this.docs.set(key, doc);
    return doc;
  }

  private keyOfDoc(doc: FileDoc): string | undefined {
    return [...this.docs].find(([, each]) => each === doc)?.[0];
  }

  private tabsOf(set: EditorTabs): Parameters<PanelHost['setTabs']>[0] {
    return {
      tabs: set.tabs.map(
        (tab): PanelTab => ({
          id: tab.key,
          text: tab.ref.file.path.slice(tab.ref.file.path.lastIndexOf('/') + 1),
          tooltip: `${tab.ref.root}/${tab.ref.file.path}${tab.preview ? '\nA preview: the next file opened takes its place. Double-click to keep it.' : ''}`,
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
      menu: () => null,
      // A double-click on a tab keeps it, as on a preview in an editor.
      rename: (id) => changeEditorTabs((each) => kept(each, id)),
      reorder: (ids) => changeEditorTabs((each) => reordered(each, ids)),
      showCluster: () => {},
      folded: false,
      fold: () => {},
    };
  }
}
